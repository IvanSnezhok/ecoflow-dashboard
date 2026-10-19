import { config } from "../config/env.js";
import { generateSignature } from "./signatureService.js";
import { getAllDevices, getDeviceBySn, getLatestRawData } from "../db/database.js";
import { getSupportedCommand, type DeviceAction } from "./deviceProfiles.js";
import { bleBridge, mergeQuotas, CLOUD_BASE_FRESH_MS } from "./bleBridge.js";
import { extraBatteries } from "./extraBatteries.js";
import { EcoflowApiError } from "../lib/ecoflowApiError.js";

interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
}

/** After a network failure, skip cloud reads this long while BLE carries the data. */
const CLOUD_RETRY_MS = 30_000;

interface DeviceListItem {
  sn: string;
  deviceName: string;
  /** 1 when data is available from the cloud or over BLE */
  online: number;
  productName: string;
  /** The cloud's own online flag (the device's Wi-Fi/cloud link) */
  cloudOnline?: number;
  bleOnline?: boolean;
}

export type DataSource = "cloud" | "ble" | "cloud+ble";

interface DeviceQuota {
  soc: number;
  wattsInSum: number;
  wattsOutSum: number;
  [key: string]: unknown;
}

/** device_states timestamps are UTC "YYYY-MM-DD HH:MM:SS" */
const storedAt = (timestamp: string): number => Date.parse(timestamp.replace(" ", "T") + "Z") || 0;

class EcoflowApiClient {
  private baseUrl: string;
  private accessKey: string;
  private secretKey: string;
  private readonly cacheTtlMs = 10_000;
  private deviceListCache: { value: DeviceListItem[]; timestamp: number } | null = null;
  private deviceListInFlight: Promise<DeviceListItem[]> | null = null;
  private quotaCache = new Map<string, { value: DeviceQuota; timestamp: number }>();
  private quotaInFlight = new Map<string, Promise<DeviceQuota>>();
  // Last good cloud answers, used when the cloud fails and BLE carries the data
  private lastCloudList: DeviceListItem[] | null = null;
  private lastCloudQuota = new Map<string, { value: DeviceQuota; timestamp: number }>();
  private dataSources = new Map<string, DataSource>();
  private cloudRefreshInFlight = new Set<string>();
  private cloudRefreshAttemptAt = new Map<string, number>();
  private cloudDownUntil = 0;
  private listFallbackReason: string | null = null;

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
    } catch (error) {
      // No route to the cloud (internet down, DNS, timeout) rather than an API error
      this.cloudDownUntil = Date.now() + CLOUD_RETRY_MS;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    this.cloudDownUntil = 0;

    if (!response.ok) {
      throw new Error(
        `Ecoflow API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ApiResponse<T>;

    if (data.code !== "0") {
      throw new EcoflowApiError(String(data.code), data.message);
    }

    // For PUT/POST commands, empty data is acceptable (command was successful)
    if (data.data === undefined || data.data === null) {
      return {} as T;
    }

    return data.data;
  }

  /**
   * Device list from the cloud, with devices reachable over BLE marked online. When
   * the cloud cannot be reached and BLE is enabled, the last known list (or the
   * database) stands in so BLE-connected devices keep working offline.
   */
  async getDeviceList(): Promise<DeviceListItem[]> {
    let cloud: DeviceListItem[];
    try {
      if (bleBridge.active && this.cloudDown) throw new Error("cloud unreachable, retrying shortly");
      cloud = await this.getCloudDeviceList();
      this.lastCloudList = cloud;
      this.listFallbackReason = null;
    } catch (error) {
      if (!bleBridge.active) throw error;
      const known = this.lastCloudList ?? (getAllDevices() as Array<{ serial_number: string; device_type: string; name: string | null }>)
        .map((d) => ({ sn: d.serial_number, productName: d.device_type, deviceName: d.name ?? d.serial_number, online: 0 }));
      if (known.length === 0) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      if (reason !== this.listFallbackReason) console.warn(`[EcoflowAPI] Device list unavailable, using last known list: ${reason}`);
      this.listFallbackReason = reason;
      cloud = known.map((d) => ({ ...d, online: 0 }));
    }

    return cloud.map((device) => {
      const bleOnline = bleBridge.freshQuota(device.sn) !== null;
      return { ...device, cloudOnline: device.online, bleOnline, online: device.online === 1 || bleOnline ? 1 : 0 };
    });
  }

  private get cloudDown(): boolean {
    return Date.now() < this.cloudDownUntil;
  }

  /** Which channel the latest quota for this device came from. */
  getDataSource(sn: string): DataSource | null {
    return this.dataSources.get(sn) ?? null;
  }

  private async getCloudDeviceList(): Promise<DeviceListItem[]> {
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

  /**
   * Quota for one device, from the cloud, BLE or both depending on ECOFLOW_BLE_MODE
   * (see bleBridge.ts). BLE values replace cloud ones key by key. Extra batteries
   * the answer happens to omit are filled in from memory (see extraBatteries.ts).
   */
  async getDeviceQuota(sn: string): Promise<DeviceQuota> {
    const quota = await this.readQuota(sn);
    if (!extraBatteries.knows(sn)) {
      // After a restart the database holds the last snapshot with both packs
      const device = getDeviceBySn(sn) as { id: number } | undefined;
      const stored = device ? getLatestRawData(device.id) : null;
      extraBatteries.seed(sn, stored?.data ?? null, stored ? storedAt(stored.timestamp) : 0);
    }
    return extraBatteries.fill(sn, quota) as DeviceQuota;
  }

  private async readQuota(sn: string): Promise<DeviceQuota> {
    const ble = bleBridge.freshQuota(sn);
    if (!ble) {
      const quota = await this.getCloudQuota(sn);
      this.dataSources.set(sn, "cloud");
      return quota;
    }

    if (bleBridge.mode === "prefer") {
      // BLE is live; do not wait on the cloud, just keep its copy reasonably fresh
      // for the fields BLE lacks.
      this.refreshCloudInBackground(sn);
      return this.withBle(sn, ble);
    }

    try {
      if (this.cloudDown) throw new Error("cloud unreachable, retrying shortly");
      const quota = await this.getCloudQuota(sn);
      this.dataSources.set(sn, "cloud");
      return quota;
    } catch (error) {
      console.warn(`[EcoflowAPI] Cloud quota for ${sn} failed, using BLE: ${error instanceof Error ? error.message : error}`);
      return this.withBle(sn, ble);
    }
  }

  private withBle(sn: string, ble: Record<string, unknown>): DeviceQuota {
    let cloud = this.lastCloudQuota.get(sn);
    if (!cloud) {
      // After a restart without internet the database holds the last cloud snapshot
      const device = getDeviceBySn(sn) as { id: number } | undefined;
      const stored = device ? getLatestRawData(device.id) : null;
      if (stored) {
        cloud = { value: stored.data as DeviceQuota, timestamp: storedAt(stored.timestamp) };
        this.lastCloudQuota.set(sn, cloud);
      }
    }
    const cloudAge = cloud ? Date.now() - cloud.timestamp : Infinity;
    this.dataSources.set(sn, cloudAge <= CLOUD_BASE_FRESH_MS ? "cloud+ble" : "ble");
    return mergeQuotas(cloud?.value ?? null, cloudAge, ble) as DeviceQuota;
  }

  private refreshCloudInBackground(sn: string): void {
    // At most one attempt a minute, also while the cloud keeps failing
    const lastAttempt = this.cloudRefreshAttemptAt.get(sn) ?? 0;
    if (this.cloudRefreshInFlight.has(sn) || Date.now() - lastAttempt < 60_000) return;
    this.cloudRefreshAttemptAt.set(sn, Date.now());
    this.cloudRefreshInFlight.add(sn);
    this.getCloudQuota(sn)
      .catch(() => { /* BLE carries the data; the cloud may well be down */ })
      .finally(() => this.cloudRefreshInFlight.delete(sn));
  }

  private async getCloudQuota(sn: string): Promise<DeviceQuota> {
    const cached = this.quotaCache.get(sn);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) return cached.value;
    let inFlight = this.quotaInFlight.get(sn);
    if (!inFlight) {
      inFlight = this.request<DeviceQuota>("GET", "/iot-open/sign/device/quota/all", { sn })
        .then((value) => {
          this.quotaCache.set(sn, { value, timestamp: Date.now() });
          this.lastCloudQuota.set(sn, { value, timestamp: Date.now() });
          return value;
        })
        .finally(() => { this.quotaInFlight.delete(sn); });
      this.quotaInFlight.set(sn, inFlight);
    }
    return inFlight;
  }

  private invalidateQuota(sn: string): void { this.quotaCache.delete(sn); }

  /** One uncached cloud read of the full quota, for the data access check. */
  async probeQuotaAll(sn: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/iot-open/sign/device/quota/all", { sn });
  }

  /** The cloud's other read: only the named quota fields. */
  async getQuotaFields(sn: string, quotas: string[]): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/iot-open/sign/device/quota", {}, { sn, params: { quotas } });
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

  /**
   * Send a control command over the preferred channel, falling back to the other
   * one when it fails: BLE first in "prefer" mode, the cloud first otherwise.
   */
  private async sendProfileCommand(sn: string, action: DeviceAction): Promise<void> {
    const device = getDeviceBySn(sn) as { device_type: string } | undefined;
    if (!device) throw new Error("Device must be discovered before it can be controlled");
    const command = getSupportedCommand(device.device_type, action);

    const viaCloud = () => this.request(
      "PUT",
      "/iot-open/sign/device/quota",
      {},
      { sn, params: { cmdSet: 32, id: command.id, ...command.params } },
    );
    const viaBle = () => bleBridge.sendCommand(sn, action);

    const channels: Array<[string, () => Promise<unknown>]> = [];
    const bleUsable = bleBridge.active && bleBridge.canCommand(sn);
    if (bleUsable && bleBridge.mode === "prefer") channels.push(["BLE", viaBle]);
    channels.push(["cloud", viaCloud]);
    if (bleUsable && bleBridge.mode !== "prefer") channels.push(["BLE", viaBle]);

    const errors: string[] = [];
    for (const [name, send] of channels) {
      try {
        await send();
        if (errors.length) console.warn(`[EcoflowAPI] ${action.type} for ${sn} sent via ${name} after: ${errors.join("; ")}`);
        this.invalidateQuota(sn);
        return;
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(errors.length === 1 ? errors[0].replace(/^cloud: /, "") : errors.join("; "));
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
