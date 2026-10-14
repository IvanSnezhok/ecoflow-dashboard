// Client for the BLE bridge container (ble-bridge/), which holds a direct Bluetooth
// session to the station and serves its heartbeats as a cloud-style quota.
//
// ECOFLOW_BLE_MODE:
//   prefer   (default) BLE is the primary channel for data and commands; the cloud
//            fills fields BLE does not carry and takes over when BLE is down.
//   fallback the cloud stays primary; BLE is used only while the cloud fails.
//   off      ignore the bridge.

import type { DeviceAction } from "./deviceProfiles.js";

export type BleMode = "prefer" | "fallback" | "off";

/** An error answer from the bridge, with its HTTP status. */
export class BridgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface BleDeviceStatus {
  sn: string;
  name: string | null;
  address: string | null;
  rssi: number | null;
  advertisedAt: number | null;
  state: string;
  supported: boolean;
  authenticated: boolean;
  authenticatedSince: number | null;
  lastPacketAt: number | null;
  error: string | null;
  pausedUntil: number | null;
  sessionsStarted: number;
  quota: Record<string, unknown>;
  quotaUpdatedAt: number | null;
}

interface BridgeStatus {
  scanning: boolean;
  scannerError: string | null;
  userIdConfigured: boolean;
  userIdSource: "panel" | "env" | "login" | null;
  userIdHint: string | null;
  loginError: string | null;
  enabled?: boolean; // panel switch; absent on an older bridge
  mode?: "prefer" | "fallback" | null;
  now: number;
  devices: BleDeviceStatus[];
}

/** Bridge data older than this is not used as live state. */
export const BLE_FRESH_MS = 30_000;
const POLL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 20_000;

function parseMode(value: string | undefined): BleMode {
  return value === "fallback" || value === "off" ? value : "prefer";
}

class BleBridgeClient {
  readonly url = (process.env.ECOFLOW_BLE_BRIDGE_URL || "").replace(/\/+$/, "");
  /** ECOFLOW_BLE_MODE: "off" disables the bridge entirely; otherwise the default mode. */
  readonly envMode = parseMode(process.env.ECOFLOW_BLE_MODE);
  private status: BridgeStatus | null = null;
  private fetchedAt = 0;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  /** The bridge is configured for this deployment. */
  get enabled(): boolean {
    return this.url !== "" && this.envMode !== "off";
  }

  /** Turned on with the panel switch (default on). */
  get switchedOn(): boolean {
    return this.status?.enabled !== false;
  }

  /** Configured and switched on: BLE takes part in data and commands. */
  get active(): boolean {
    return this.enabled && this.switchedOn;
  }

  /** Active mode: the panel's choice, else ECOFLOW_BLE_MODE. */
  get mode(): BleMode {
    if (!this.enabled) return "off";
    return this.status?.mode ?? this.envMode;
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    console.log(`[BLE] Bridge ${this.url}, default mode ${this.envMode}`);
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
    this.timer.unref();
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch(`${this.url}/status`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
      this.status = (await res.json()) as BridgeStatus;
      this.fetchedAt = Date.now();
      if (this.lastError) console.log("[BLE] Bridge reachable again");
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastError) console.warn(`[BLE] Bridge unavailable: ${message}`);
      this.lastError = message;
    }
  }

  /** The bridge has answered recently. */
  get reachable(): boolean {
    return this.status !== null && Date.now() - this.fetchedAt < BLE_FRESH_MS;
  }

  overview() {
    return {
      enabled: this.enabled,
      switchedOn: this.switchedOn,
      mode: this.mode,
      defaultMode: this.envMode,
      reachable: this.reachable,
      error: this.reachable ? null : this.lastError,
      scanning: this.status?.scanning ?? false,
      scannerError: this.status?.scannerError ?? null,
      userIdConfigured: this.status?.userIdConfigured ?? false,
      userIdSource: this.status?.userIdSource ?? null,
      userIdHint: this.status?.userIdHint ?? null,
      loginError: this.status?.loginError ?? null,
    };
  }

  device(sn: string): BleDeviceStatus | undefined {
    if (!this.enabled || !this.reachable) return undefined;
    return this.status?.devices.find((d) => d.sn.toUpperCase() === sn.toUpperCase());
  }

  /** Age of the device's BLE data in ms, measured on the bridge's own clock. */
  private dataAgeMs(device: BleDeviceStatus): number {
    if (!device.quotaUpdatedAt || !this.status) return Infinity;
    return this.status.now - device.quotaUpdatedAt + (Date.now() - this.fetchedAt);
  }

  /** Live BLE quota, or null when there is no authenticated, recently updated session. */
  freshQuota(sn: string): Record<string, unknown> | null {
    if (!this.switchedOn) return null;
    const device = this.device(sn);
    if (!device?.authenticated || this.dataAgeMs(device) > BLE_FRESH_MS) return null;
    return device.quota;
  }

  canCommand(sn: string): boolean {
    return this.switchedOn && this.device(sn)?.authenticated === true;
  }

  private async post(path: string, body: unknown, timeoutMs = REQUEST_TIMEOUT_MS, method = "POST"): Promise<unknown> {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new BridgeError(payload.error ?? `bridge HTTP ${res.status}`, res.status);
    // Pick up the new state on the next poll instead of waiting for it
    void this.refresh();
    return payload;
  }

  async sendCommand(sn: string, action: DeviceAction): Promise<void> {
    await this.post(`/devices/${encodeURIComponent(sn)}/command`, action, COMMAND_TIMEOUT_MS);
  }

  async pause(sn: string, minutes: number): Promise<void> {
    await this.post(`/devices/${encodeURIComponent(sn)}/pause`, { minutes });
  }

  async resume(sn: string): Promise<void> {
    await this.post(`/devices/${encodeURIComponent(sn)}/resume`, {});
  }

  /** Exchange the EcoFlow account login for its user ID on the bridge; the password is not stored. */
  async login(email: string, password: string, region: string): Promise<void> {
    await this.post("/account/login", { email, password, region }, 30_000);
  }

  async setUserId(userId: string): Promise<void> {
    await this.post("/account/user-id", { userId });
  }

  /** Panel switch and mode; stored by the bridge so they survive restarts. */
  async updateSettings(settings: { enabled?: boolean; mode?: "prefer" | "fallback" }): Promise<void> {
    await this.post("/settings", settings);
  }

  async forgetUserId(): Promise<void> {
    await this.post("/account", {}, REQUEST_TIMEOUT_MS, "DELETE");
  }

  /** Session summaries without the raw quota. */
  devices() {
    if (!this.reachable) return [];
    return (this.status?.devices ?? []).map(({ quota: _quota, ...rest }) => ({ ...rest, live: this.freshQuota(rest.sn) !== null }));
  }
}

export const bleBridge = new BleBridgeClient();

// Extra-battery fields that do not change minute to minute. BLE only reports the
// extra batteries' SOC, so these are carried over from the last cloud quota; live
// values (watts, voltage, error codes) are not, once that quota is old.
const STATIC_SLAVE_FIELDS = new Set([
  "fullCap", "designCap", "cycles", "soh", "cycleSoh", "sysVer", "packSn", "temp", "minCellTemp", "maxCellTemp",
]);
/** A cloud quota younger than this is merged whole under the BLE values. */
export const CLOUD_BASE_FRESH_MS = 2 * 60_000;

/**
 * Cloud quota under BLE values. BLE wins every key it carries; the cloud supplies
 * the rest (extra-battery details), limited to slow-changing fields when it is stale.
 */
export function mergeQuotas(
  cloud: Record<string, unknown> | null,
  cloudAgeMs: number,
  ble: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (cloud) {
    const fresh = cloudAgeMs <= CLOUD_BASE_FRESH_MS;
    for (const [key, value] of Object.entries(cloud)) {
      const slave = /^bmsSlave[12]\.(.+)$/.exec(key);
      if (slave && !fresh && !STATIC_SLAVE_FIELDS.has(slave[1])) continue;
      base[key] = value;
    }
  }
  return { ...base, ...ble };
}
