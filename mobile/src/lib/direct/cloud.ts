// The EcoFlow Open API, spoken from the phone: the app's independent mode (lib/direct.ts).
// Mirrors server/src/services/signatureService.ts, ecoflowApi.ts and deviceProfiles.ts;
// free of React Native imports so it can be checked with plain Node.
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { DeviceState } from '@panel/types/device';

export interface DirectCredentials {
  accessKey: string;
  secretKey: string;
  endpoint: string;
}

export type DirectAction =
  | { type: 'setAcOutput'; enabled: boolean }
  | { type: 'setMaxChargeSoc'; value: number }
  | { type: 'setMinDischargeSoc'; value: number }
  | { type: 'setAcChargingPower'; value: number };

type Flat = [string, string | number | boolean][];

/** Nested values as dot-notation pairs, arrays as key[0]: what EcoFlow signs */
function flatten(value: Record<string, unknown>, prefix = ''): Flat {
  const out: Flat = [];
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item === null || item === undefined) continue;
    if (Array.isArray(item)) {
      item.forEach((entry, index) => {
        if (typeof entry === 'object' && entry !== null) out.push(...flatten(entry as Record<string, unknown>, `${name}[${index}]`));
        else out.push([`${name}[${index}]`, entry as string | number | boolean]);
      });
    } else if (typeof item === 'object') out.push(...flatten(item as Record<string, unknown>, name));
    else out.push([name, item as string | number | boolean]);
  }
  return out;
}

/** Request headers with the HMAC-SHA256 signature. GET parameters are not signed, a body is */
export function signHeaders(credentials: DirectCredentials, body: Record<string, unknown> | null, timestamp: number, nonce: string): Record<string, string> {
  const sorted = body
    ? flatten(body).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&')
    : '';
  const own = `accessKey=${credentials.accessKey}&nonce=${nonce}&timestamp=${timestamp}`;
  const sign = bytesToHex(hmac(sha256, utf8ToBytes(credentials.secretKey), utf8ToBytes(sorted ? `${sorted}&${own}` : own)));
  return { accessKey: credentials.accessKey, nonce, timestamp: String(timestamp), sign, 'Content-Type': 'application/json;charset=UTF-8' };
}

/** Commands are verified only for the original DELTA Pro, as on the panel */
export const isDeltaPro = (deviceType: string) => /DELTA[ _-]?PRO/i.test(deviceType) && !/PRO[ _-]?(3|ULTRA)/i.test(deviceType);

/** The legacy cmdSet 32 payload of a DELTA Pro command */
export function commandBody(serialNumber: string, action: DirectAction): Record<string, unknown> {
  const command = action.type === 'setAcOutput' ? { id: 66, enabled: action.enabled ? 1 : 0, xboost: 0 }
    : action.type === 'setMaxChargeSoc' ? { id: 49, maxChgSoc: action.value }
      : action.type === 'setMinDischargeSoc' ? { id: 51, minDsgSoc: action.value }
        : { id: 69, slowChgPower: action.value };
  return { sn: serialNumber, params: { cmdSet: 32, ...command } };
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** A DELTA Pro quota as the state the screens show; null when it is not that schema */
export function quotaToState(serialNumber: string, q: Record<string, unknown>, now: number): DeviceState | null {
  if (!('bmsMaster.soc' in q) || !('inv.outputWatts' in q)) return null;
  const cycles = num(q['bmsMaster.cycles']);
  const soh = num(q['bmsMaster.soh']);
  const vol = num(q['bmsMaster.vol']);
  return {
    serialNumber,
    batterySoc: num(q['pd.soc']) || num(q['bmsMaster.soc']),
    batteryWatts: num(q['pd.wattsInSum']) - num(q['pd.wattsOutSum']),
    acInputWatts: num(q['inv.inputWatts']),
    solarInputWatts: num(q['mppt.inWatts']) || (num(q['mppt.inAmp']) * num(q['mppt.inVol'])) / 1000,
    acOutputWatts: num(q['inv.outputWatts']),
    dcOutputWatts: num(q['mppt.outWatts']) || num(q['pd.carWatts']),
    temperature: num(q['inv.outTemp']) || num(q['bmsMaster.temp']),
    acOutEnabled: num(q['inv.cfgAcEnabled']) === 1 || num(q['inv.acOutState']) === 1,
    dcOutEnabled: num(q['mppt.carState']) === 1 || num(q['pd.carState']) === 1,
    timestamp: new Date(now).toISOString(),
    chgRemainTime: num(q['ems.chgRemainTime']) || undefined,
    dsgRemainTime: num(q['ems.dsgRemainTime']) || undefined,
    mainBattery: { cycles: cycles || undefined, soh: soh || undefined, vol: vol || undefined },
    maxChgSoc: num(q['ems.maxChargeSoc']) || undefined,
    minDsgSoc: num(q['ems.minDsgSoc']),
    acChargingPower: num(q['inv.cfgSlowChgWatts']) || undefined,
    fastChargingEnabled: num(q['inv.cfgFastChgWatts']) > 0,
  };
}

export class EcoflowCloud {
  constructor(private readonly credentials: DirectCredentials) {}

  private async request<T>(method: 'GET' | 'PUT', path: string, query: Record<string, string>, body: Record<string, unknown> | null): Promise<T> {
    const nonce = String(Math.floor(100000 + Math.random() * 900000));
    const search = Object.entries(query).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${this.credentials.endpoint.replace(/\/+$/, '')}${path}${search ? `?${search}` : ''}`, {
        method,
        headers: signHeaders(this.credentials, body, Date.now(), nonce),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`EcoFlow answered ${response.status}`);
      const answer = (await response.json()) as { code: string | number; message?: string; data?: T };
      if (String(answer.code) !== '0') throw new Error(`EcoFlow: ${answer.message ?? `code ${answer.code}`}`);
      return (answer.data ?? {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Serial numbers the cloud lists, with its online flag */
  async online(): Promise<Map<string, boolean>> {
    const list = await this.request<{ sn: string; online: number }[]>('GET', '/iot-open/sign/device/list', {}, null);
    return new Map((Array.isArray(list) ? list : []).map((item) => [item.sn, item.online === 1]));
  }

  quota(serialNumber: string): Promise<Record<string, unknown>> {
    return this.request('GET', '/iot-open/sign/device/quota/all', { sn: serialNumber }, null);
  }

  async command(serialNumber: string, action: DirectAction): Promise<void> {
    await this.request('PUT', '/iot-open/sign/device/quota', {}, commandBody(serialNumber, action));
  }
}
