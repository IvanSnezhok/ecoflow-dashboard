import { config } from "../config/env.js";
import { generateSignature } from "./signatureService.js";
import { getDeviceBySn } from "../db/database.js";
import { getSupportedCommand, type DeviceAction } from "./deviceProfiles.js";

interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
}

interface DeviceListItem {
  sn: string;
  deviceName: string;
  online: number;
  productName: string;
}

interface DeviceQuota {
  soc: number;
  wattsInSum: number;
  wattsOutSum: number;
  [key: string]: unknown;
}

class EcoflowApiClient {
  private baseUrl: string;
  private accessKey: string;
  private secretKey: string;
  private readonly cacheTtlMs = 10_000;
  private deviceListCache: { value: DeviceListItem[]; timestamp: number } | null = null;
  private deviceListInFlight: Promise<DeviceListItem[]> | null = null;
  private quotaCache = new Map<string, { value: DeviceQuota; timestamp: number }>();
  private quotaInFlight = new Map<string, Promise<DeviceQuota>>();

  constructor() {
    this.baseUrl = config.ecoflow.apiEndpoint;
    this.accessKey = config.ecoflow.accessKey;
    this.secretKey = config.ecoflow.secretKey;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    params: Record<string, string | number | boolean> = {},
    body?: unknown,
  ): Promise<T> {
    // For PUT/POST requests, body params must be included in signature
    // For GET requests, params are passed in URL but NOT included in signature
    const signatureParams =
      (method === "PUT" || method === "POST") && body
        ? (body as Record<string, unknown>)
        : {};

    const { headers } = generateSignature({
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      params: signatureParams,
    });

    const url = new URL(path, this.baseUrl);
    if (method === "GET") {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    // Never log full quota payloads: they are large, sensitive diagnostic data and
    // logging them once per poll dominates disk I/O.
    console.debug(`[EcoflowAPI] ${method} ${path}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(
        `Ecoflow API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ApiResponse<T>;

    if (data.code !== "0") {
      throw new Error(`Ecoflow API error (code ${data.code}): ${data.message}`);
    }

    // For PUT/POST commands, empty data is acceptable (command was successful)
    if (data.data === undefined || data.data === null) {
      return {} as T;
    }

    return data.data;
  }

  async getDeviceList(): Promise<DeviceListItem[]> {
    if (this.deviceListCache && Date.now() - this.deviceListCache.timestamp < this.cacheTtlMs) {
      return this.deviceListCache.value;
    }
    if (!this.deviceListInFlight) {
      this.deviceListInFlight = this.request<DeviceListItem[]>("GET", "/iot-open/sign/device/list")
        .then((value) => {
          this.deviceListCache = { value, timestamp: Date.now() };
          return value;
        })
        .finally(() => { this.deviceListInFlight = null; });
    }
    return this.deviceListInFlight;
  }

  async getDeviceQuota(sn: string): Promise<DeviceQuota> {
    const cached = this.quotaCache.get(sn);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) return cached.value;
    let inFlight = this.quotaInFlight.get(sn);
    if (!inFlight) {
      inFlight = this.request<DeviceQuota>("GET", "/iot-open/sign/device/quota/all", { sn })
        .then((value) => {
          this.quotaCache.set(sn, { value, timestamp: Date.now() });
          return value;
        })
        .finally(() => { this.quotaInFlight.delete(sn); });
      this.quotaInFlight.set(sn, inFlight);
    }
    return inFlight;
  }

  private invalidateQuota(sn: string): void { this.quotaCache.delete(sn); }

  // Generic function for devices that use cmdCode (like PowerStream)
  async setDeviceFunction(
    sn: string,
    cmdCode: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.request(
      "PUT",
      "/iot-open/sign/device/quota",
      {},
      { sn, cmdCode, params },
    );
    this.invalidateQuota(sn);
  }

  // DELTA Pro specific commands use cmdSet: 32 with command IDs
  // Command IDs for DELTA Pro:
  // - AC output/X-Boost: id 66
  // - AC charging power: id 69
  // - Car charger (DC 12V): id 81
  // - Max charge SOC: id 49
  // - Min discharge SOC: id 51
  // - Car input current: id 71

  private async sendProfileCommand(sn: string, action: DeviceAction): Promise<void> {
    const device = getDeviceBySn(sn) as { device_type: string } | undefined;
    if (!device) throw new Error("Device must be discovered before it can be controlled");
    const command = getSupportedCommand(device.device_type, action);
    await this.request(
      "PUT",
      "/iot-open/sign/device/quota",
      {},
      { sn, params: { cmdSet: 32, id: command.id, ...command.params } },
    );
    this.invalidateQuota(sn);
  }

  async setAcOutput(sn: string, enabled: boolean): Promise<void> {
    await this.sendProfileCommand(sn, { type: "setAcOutput", enabled });
  }

  async setDcOutput(sn: string, enabled: boolean): Promise<void> {
    await this.sendProfileCommand(sn, { type: "setDcOutput", enabled });
  }

  async setChargeLimit(sn: string, maxSoc: number, minSoc: number): Promise<void> {
    await this.setMaxChargeSoc(sn, maxSoc);
    await this.setMinDischargeSoc(sn, minSoc);
  }

  async setMaxChargeSoc(sn: string, maxSoc: number): Promise<void> {
    await this.sendProfileCommand(sn, { type: "setMaxChargeSoc", value: maxSoc });
  }

  async setMinDischargeSoc(sn: string, minSoc: number): Promise<void> {
    await this.sendProfileCommand(sn, { type: "setMinDischargeSoc", value: minSoc });
  }

  async setAcChargingPower(sn: string, watts: number): Promise<void> {
    await this.sendProfileCommand(sn, { type: "setAcChargingPower", value: watts });
  }

  // Get MQTT credentials for real-time updates
  async getMqttCredentials(): Promise<{
    url: string;
    port: number;
    protocol: string;
    certificateAccount: string;
    certificatePassword: string;
  }> {
    return this.request("GET", "/iot-open/sign/certification");
  }
}

export const ecoflowApi = new EcoflowApiClient();
