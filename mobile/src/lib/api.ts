import type {
  AuthSession,
  AuthStatus,
  ChartPeriod,
  DeviceTechnicalInfo,
  DeviceWithState,
  HistoryResponse,
} from '@panel/types/device';
import type { AutomationRule } from '@panel/types/automation';
import type { PowerDay, ResilienceSettings, ResilienceStatus } from '@panel/types/resilience';
import { direct, setBackfillUpload, type DirectSample } from './direct';
import type { DirectCredentials } from './direct/cloud';

setBackfillUpload((serialNumber, samples) => api.historyBackfill(serialNumber, samples));

/** What a phone wants to be notified about; mirrors server/src/lib/pushMessages.ts */
export interface PushPrefs {
  grid: boolean;
  lowBattery: boolean;
  offline: boolean;
  /** Battery level, in percent, at or below which "battery low" is sent */
  threshold: number;
}

/** A failed request, with the HTTP status when the panel answered (0 = no answer) */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Sign-in answers carry the session token for the app (server: routes/auth.ts) */
export type SignInAnswer = AuthStatus & { token?: string };

interface Connection {
  serverUrl: string;
  token: string | null;
}

let connection: Connection | null = null;
let onUnauthorized: (() => void) | null = null;

/** Called by the session store: where requests go and what they carry */
export function setConnection(next: Connection | null, unauthorized?: () => void): void {
  connection = next;
  if (unauthorized) onUnauthorized = unauthorized;
}

const TIMEOUT_MS = 15_000;

export async function request<T>(
  serverUrl: string,
  path: string,
  options: { method?: string; body?: unknown; token?: string | null; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const query = Object.entries(options.query ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api${path}${query ? `?${query}` : ''}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      // The token is the session; a cookie left in the app's cookie jar must not travel
      credentials: 'omit',
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(controller.signal.aborted ? 'The panel did not answer in time' : 'Cannot reach the panel', 0);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the address is not a panel, or the gateway's placeholder answered
  }
  if (!response.ok) {
    const body = data as { error?: string; message?: string; updating?: boolean } | null;
    const message = body?.error || body?.message
      || (response.status === 503 ? 'The panel is restarting; try again in a minute' : `The panel answered ${response.status}`);
    throw new ApiError(message, response.status);
  }
  if (data === null) throw new ApiError('This address did not answer like an EcoFlow panel', response.status);
  return data as T;
}

/** A request of the signed-in session; a 401 signs the app out */
async function call<T>(path: string, options: Parameters<typeof request>[2] = {}): Promise<T> {
  if (!connection) throw new ApiError('Not signed in', 401);
  const { serverUrl, token } = connection;
  try {
    return await request<T>(serverUrl, path, { ...options, token });
  } catch (error) {
    // Only when the session that failed is still the current one
    if (error instanceof ApiError && error.status === 401 && connection?.token === token) onUnauthorized?.();
    throw error;
  }
}

type Wrapped<T> = { success: boolean; data: T; error?: string };
const unwrap = async <T>(answer: Promise<Wrapped<T>>): Promise<T> => (await answer).data;
const sn = (serialNumber: string) => encodeURIComponent(serialNumber);

export const api = {
  authStatus: (serverUrl: string, token?: string | null) => request<AuthStatus>(serverUrl, '/auth/status', { token }),

  signIn: (serverUrl: string, username: string, password: string, otp: string) =>
    request<SignInAnswer>(serverUrl, '/auth/login', {
      method: 'POST',
      body: { username, password, otp, remember: true, client: 'app' },
    }),

  signOut: () => call<AuthStatus>('/auth/logout', { method: 'POST' }),

  sessions: () => call<AuthSession[]>('/auth/sessions'),

  devices: () => call<DeviceWithState[]>('/devices'),

  history: (serialNumber: string, period: ChartPeriod) =>
    call<HistoryResponse>(`/devices/${sn(serialNumber)}/history`, { query: { period } }),

  deviceInfo: (serialNumber: string) => call<DeviceTechnicalInfo>(`/devices/${sn(serialNumber)}/info`),

  setAcOutput: (serialNumber: string, enabled: boolean) =>
    direct.command(serialNumber, { type: 'setAcOutput', enabled }) ?? call<unknown>(`/devices/${sn(serialNumber)}/ac-output`, { method: 'POST', body: { enabled } }),

  setMaxChargeSoc: (serialNumber: string, maxSoc: number) =>
    direct.command(serialNumber, { type: 'setMaxChargeSoc', value: maxSoc }) ?? call<unknown>(`/devices/${sn(serialNumber)}/max-charge-soc`, { method: 'POST', body: { maxSoc } }),

  setMinDischargeSoc: (serialNumber: string, minSoc: number) =>
    direct.command(serialNumber, { type: 'setMinDischargeSoc', value: minSoc }) ?? call<unknown>(`/devices/${sn(serialNumber)}/min-discharge-soc`, { method: 'POST', body: { minSoc } }),

  setChargingPower: (serialNumber: string, watts: number) =>
    direct.command(serialNumber, { type: 'setAcChargingPower', value: watts }) ?? call<unknown>(`/devices/${sn(serialNumber)}/charging-power`, { method: 'POST', body: { watts } }),

  /** A custom window; the panel picks the bucket size (1 h up to 120 days, then 6 h) */
  historyRange: (serialNumber: string, from: string, to: string) =>
    call<HistoryResponse>(`/devices/${sn(serialNumber)}/history`, { query: { period: 'custom', from, to } }),

  resilienceSettings: () => unwrap(call<Wrapped<ResilienceSettings | null>>('/resilience/settings')),

  // Automation rules (owner only)
  rules: () => unwrap(call<Wrapped<AutomationRule[]>>('/automation/rules')),

  toggleRule: (id: number, enabled: boolean) =>
    unwrap(call<Wrapped<AutomationRule>>(`/automation/rules/${id}/toggle`, { method: 'POST', body: { enabled } })),

  /** Carries out the rule's actions once, now */
  runRule: async (id: number, serialNumber?: string) => {
    const answer = await call<{ success: boolean; error?: string }>(`/automation/rules/${id}/run`, { method: 'POST', body: { serialNumber } });
    if (!answer.success) throw new ApiError(answer.error ?? 'An action failed', 200);
  },

  /** Independent mode: the EcoFlow API keys for this phone, after the owner's password */
  directAccess: (password: string) => call<DirectCredentials>('/app-direct', { method: 'POST', body: { password } }),

  historyBackfill: (serialNumber: string, samples: DirectSample[]) =>
    call<{ received: number; stored: number }>(`/devices/${sn(serialNumber)}/history/backfill`, { method: 'POST', body: { samples } }),

  // Push notifications (server: routes/push.ts)
  pushRegister: (token: string, platform: string, language: 'uk' | 'en', prefs: PushPrefs) =>
    call<{ registered: boolean }>('/push/register', { method: 'POST', body: { token, platform, language, prefs } }),

  pushUnregister: (token: string) => call<{ registered: boolean }>('/push/unregister', { method: 'POST', body: { token } }),

  /** iPhone: the tokens that let the panel start and refresh the outage Live Activity */
  pushLiveActivity: (token: string, tokens: { startToken?: string | null; activityToken?: string | null }) =>
    call<{ saved: boolean; ready: boolean }>('/push/live-activity', { method: 'POST', body: { token, ...tokens } }),

  pushTest: (token: string) => call<{ sent: boolean }>('/push/test', { method: 'POST', body: { token } }),

  resilienceStatus: () => unwrap(call<Wrapped<ResilienceStatus>>('/resilience/status')),

  resilienceTimeline: (days: number) => unwrap(call<Wrapped<PowerDay[]>>('/resilience/timeline', { query: { days } })),
};

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');
