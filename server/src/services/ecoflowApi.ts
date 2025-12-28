import { config } from "../config/env.js";
import { generateSignature } from "./signatureService.js";

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

    console.log(
      `[EcoflowAPI] ${method} ${path}`,
      body ? JSON.stringify(body) : "",
    );

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(
        `Ecoflow API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ApiResponse<T>;
    console.log(`[EcoflowAPI] Response:`, JSON.stringify(data));

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
    return this.request<DeviceListItem[]>("GET", "/iot-open/sign/device/list");
  }

  async getDeviceQuota(sn: string): Promise<DeviceQuota> {
    return this.request<DeviceQuota>("GET", "/iot-open/sign/device/quota/all", {
      sn,
    });
  }

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
      {
        sn,
        cmdCode,
        params,
      },
    );
  }

  // DELTA Pro specific commands use cmdSet: 32 with command IDs
  // Command IDs for DELTA Pro:
  // - AC output/X-Boost: id 66
  // - AC charging power: id 69
  // - Car charger (DC 12V): id 81
  // - Max charge SOC: id 49
  // - Min discharge SOC: id 51
  // - Car input current: id 71

  private async sendDeltaProCommand(
    sn: string,
    id: number,
    cmdParams: Record<string, unknown>,
  ): Promise<void> {
    await this.request(
      "PUT",
      "/iot-open/sign/device/quota",
      {},
      {
        sn,
        params: {
          cmdSet: 32,
          id,
          ...cmdParams,
        },
      },
    );
  }

  async setAcOutput(sn: string, enabled: boolean): Promise<void> {
    // id 66 controls both AC enabled and X-Boost
    await this.sendDeltaProCommand(sn, 66, {
      enabled: enabled ? 1 : 0,
      xboost: 0, // X-Boost off by default
    });
  }

  async setDcOutput(sn: string, enabled: boolean): Promise<void> {
    // id 81 is car charger switch (DC 12V output)
    await this.sendDeltaProCommand(sn, 81, { enabled: enabled ? 1 : 0 });
  }

  async setChargeLimit(
    sn: string,
    maxSoc: number,
    minSoc: number,
  ): Promise<void> {
    // Set max charge SOC (id 49)
    await this.sendDeltaProCommand(sn, 49, { maxChgSoc: maxSoc });
    // Set min discharge SOC (id 51)
    await this.sendDeltaProCommand(sn, 51, { minDsgSoc: minSoc });
  }

  async setMaxChargeSoc(sn: string, maxSoc: number): Promise<void> {
    // Set max charge SOC (id 49), range 50-100%
    await this.sendDeltaProCommand(sn, 49, { maxChgSoc: maxSoc });
  }

  async setMinDischargeSoc(sn: string, minSoc: number): Promise<void> {
    // Set min discharge SOC (id 51), range 0-30%
    await this.sendDeltaProCommand(sn, 51, { minDsgSoc: minSoc });
  }

  async setAcChargingPower(sn: string, watts: number): Promise<void> {
    // Set AC charging power (id 69), range 200-2900W
    await this.sendDeltaProCommand(sn, 69, { slowChgPower: watts });
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
