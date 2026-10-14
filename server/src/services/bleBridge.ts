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
  readonly mode = parseMode(process.env.ECOFLOW_BLE_MODE);
  private status: BridgeStatus | null = null;
  private fetchedAt = 0;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  get enabled(): boolean {
    return this.url !== "" && this.mode !== "off";
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    console.log(`[BLE] Bridge ${this.url}, mode ${this.mode}`);
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
      mode: this.mode,
      reachable: this.reachable,
      error: this.reachable ? null : this.lastError,
      scanning: this.status?.scanning ?? false,
      scannerError: this.status?.scannerError ?? null,
      userIdConfigured: this.status?.userIdConfigured ?? false,
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
    const device = this.device(sn);
    if (!device?.authenticated || this.dataAgeMs(device) > BLE_FRESH_MS) return null;
    return device.quota;
  }

  canCommand(sn: string): boolean {
    return this.device(sn)?.authenticated === true;
  }

  private async post(path: string, body: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const res = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(payload.error ?? `bridge HTTP ${res.status}`);
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
