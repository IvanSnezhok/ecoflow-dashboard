import axios from "axios";
import type {
  DeviceWithState,
  ChartPeriod,
  DateRange,
  HistoryResponse,
  ErrorHistoryResponse,
  DeviceTechnicalInfo,
  BleOverview,
  DataAccessReport,
  AppChannelStatus,
  AppRegion,
  AuthStatus,
  AuthSetupStart,
  AuthSession,
  InviteDetails,
  MemberRole,
  PanelInviteCreated,
  PanelUsers,
} from "@/types/device";
import type {
  AutomationRule,
  AutomationLog,
  SlackSettings,
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
  UpdateSlackSettingsDto,
  RuleTestResult,
} from "@/types/automation";
import type { PowerDay, ResilienceSettings, ResilienceStatus, YasnoAddressOption, YasnoRegion } from '@/types/resilience'

export interface VersionInfo {
  current: string;
  currentCommit: string;
  latest: string | null;
  latestCommit: string | null;
  updateAvailable: boolean;
  error?: string;
}

export type UpdateStep =
  | 'idle'
  | 'fetching'
  | 'resetting'
  | 'installing_root'
  | 'installing_server'
  | 'building_frontend'
  | 'building_backend'
  | 'restarting'
  | 'completed'
  | 'failed';

export interface UpdateStatus {
  step: UpdateStep;
  progress: number;
  message: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

const client = axios.create({
  baseURL: "/api",
  timeout: 10000,
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    // An expired or revoked session: the login screen takes over (components/auth)
    if (error.response?.status === 401 && !String(error.config?.url ?? "").startsWith("/auth/")) {
      window.dispatchEvent(new Event("auth:required"));
    }
    if (error.response) {
      const message = error.response.data?.error || error.response.data?.message || "An error occurred";
      return Promise.reject(new Error(message));
    }
    if (error.request) {
      return Promise.reject(
        new Error("No response from server. Is the backend running?"),
      );
    }
    return Promise.reject(error);
  },
);

export const api = {
  getAuthStatus: () => client.get<AuthStatus>("/auth/status"),

  authLogin: (username: string, password: string, otp: string, remember: boolean) =>
    client.post<AuthStatus>("/auth/login", { username, password, otp, remember }),

  authLogout: () => client.post<AuthStatus>("/auth/logout"),

  authSetupStart: (setupSecret: string, username: string, password: string) =>
    client.post<AuthSetupStart>("/auth/setup/start", { setupSecret, username, password }),

  authSetupFinish: (setupId: string, otp: string, remember: boolean) =>
    client.post<AuthStatus>("/auth/setup/finish", { setupId, otp, remember }),

  authChangeStart: (current: { password: string; otp: string }, username: string, password: string) =>
    client.post<AuthSetupStart>("/auth/change/start", { currentPassword: current.password, currentOtp: current.otp, username, password }),

  authChangeFinish: (setupId: string, otp: string) =>
    client.post<AuthStatus>("/auth/change/finish", { setupId, otp }),

  getAuthSessions: () => client.get<AuthSession[]>("/auth/sessions"),

  revokeOtherSessions: () => client.post<AuthSession[]>("/auth/sessions/revoke-others"),

  // Invitations: the token from the link goes in the body, never the URL
  checkInvite: (token: string) => client.post<InviteDetails>("/auth/invite/check", { token }),

  inviteStart: (token: string, username: string, password: string) =>
    client.post<AuthSetupStart>("/auth/invite/start", { token, username, password }),

  inviteFinish: (setupId: string, otp: string, remember: boolean) =>
    client.post<AuthStatus>("/auth/invite/finish", { setupId, otp, remember }),

  // Invited users (owner only)
  getPanelUsers: () => client.get<PanelUsers>("/users"),

  createInvite: (role: MemberRole, devices: string[] | null) =>
    client.post<PanelInviteCreated>("/users/invites", { role, devices }),

  revokeInvite: (id: string) => client.delete<PanelUsers>(`/users/invites/${encodeURIComponent(id)}`),

  updatePanelUser: (id: string, changes: { role?: MemberRole; devices?: string[] | null }) =>
    client.patch<PanelUsers>(`/users/${encodeURIComponent(id)}`, changes),

  signOutPanelUser: (id: string) => client.post<PanelUsers>(`/users/${encodeURIComponent(id)}/sign-out`),

  removePanelUser: (id: string) => client.delete<PanelUsers>(`/users/${encodeURIComponent(id)}`),

  getDevices: () => client.get<DeviceWithState[]>("/devices"),

  setAcOutput: (serialNumber: string, enabled: boolean) =>
    client.post(`/devices/${serialNumber}/ac-output`, { enabled }),

  setMaxChargeSoc: (serialNumber: string, maxSoc: number) =>
    client.post(`/devices/${serialNumber}/max-charge-soc`, { maxSoc }),

  setMinDischargeSoc: (serialNumber: string, minSoc: number) =>
    client.post(`/devices/${serialNumber}/min-discharge-soc`, { minSoc }),

  setChargingPower: (serialNumber: string, watts: number) =>
    client.post(`/devices/${serialNumber}/charging-power`, { watts }),

  getLogs: (params?: { deviceId?: string; type?: string; limit?: number }) =>
    client.get("/logs", { params }),

  getDeviceHistory: (
    serialNumber: string,
    period: ChartPeriod,
    customRange?: DateRange
  ) =>
    client.get<HistoryResponse>(`/devices/${serialNumber}/history`, {
      params: {
        period,
        ...(customRange && { from: customRange.from, to: customRange.to }),
      },
    }),

  getDeviceInfo: (serialNumber: string) =>
    client.get<DeviceTechnicalInfo>(`/devices/${serialNumber}/info`),

  // Listens on MQTT for ~45 s, hence the long timeout
  probeDataAccess: (serialNumber: string) =>
    client.post<DataAccessReport>(`/devices/${serialNumber}/probe`, undefined, { timeout: 120_000 }),

  pauseBle: (serialNumber: string, minutes: number) =>
    client.post(`/devices/${serialNumber}/ble/pause`, { minutes }),

  resumeBle: (serialNumber: string) =>
    client.post(`/devices/${serialNumber}/ble/resume`),

  getBleStatus: () => client.get<BleOverview>("/ble/status"),

  bleLogin: (email: string, password: string, region: string) =>
    client.post<BleOverview>("/ble/login", { email, password, region }),

  bleUpdateSettings: (settings: { enabled?: boolean; mode?: "prefer" | "fallback" }) =>
    client.post<BleOverview>("/ble/settings", settings),

  bleSetUserId: (userId: string) => client.post<BleOverview>("/ble/user-id", { userId }),

  bleForgetUserId: () => client.delete<BleOverview>("/ble/account"),

  getAppAccountStatus: () => client.get<AppChannelStatus>("/app-account/status"),

  appLogin: (email: string, password: string, region: AppRegion) =>
    client.post<AppChannelStatus>("/app-account/login", { email, password, region }, { timeout: 45_000 }),

  appLogout: () => client.delete<AppChannelStatus>("/app-account/account"),

  getDeviceErrors: (serialNumber: string, limit?: number) =>
    client.get<ErrorHistoryResponse>(`/devices/${serialNumber}/errors`, {
      params: { limit },
    }),

  // Automation API
  getAutomationRules: () =>
    client.get<{ success: boolean; data: AutomationRule[] }>("/automation/rules"),

  getAutomationRule: (id: number) =>
    client.get<{ success: boolean; data: AutomationRule }>(`/automation/rules/${id}`),

  createAutomationRule: (dto: CreateAutomationRuleDto) =>
    client.post<{ success: boolean; data: AutomationRule }>("/automation/rules", dto),

  updateAutomationRule: (id: number, dto: UpdateAutomationRuleDto) =>
    client.put<{ success: boolean; data: AutomationRule }>(`/automation/rules/${id}`, dto),

  deleteAutomationRule: (id: number) =>
    client.delete<{ success: boolean }>(`/automation/rules/${id}`),

  toggleAutomationRule: (id: number, enabled: boolean) =>
    client.post<{ success: boolean; data: AutomationRule }>(`/automation/rules/${id}/toggle`, { enabled }),

  testAutomationRule: (id: number, serialNumber: string) =>
    client.post<{ success: boolean; data: RuleTestResult }>(`/automation/rules/${id}/test`, { serialNumber }),

  clearRuleCooldown: (id: number) =>
    client.post<{ success: boolean }>(`/automation/rules/${id}/clear-cooldown`),

  getAutomationLogs: (params?: { ruleId?: number; deviceId?: number; limit?: number; offset?: number }) =>
    client.get<{ success: boolean; data: AutomationLog[] }>("/automation/logs", { params }),

  getSlackSettings: () =>
    client.get<{ success: boolean; data: SlackSettings }>("/automation/slack"),

  updateSlackSettings: (dto: UpdateSlackSettingsDto) =>
    client.put<{ success: boolean; data: SlackSettings }>("/automation/slack", dto),

  testSlackConnection: () =>
    client.post<{ success: boolean; error?: string }>("/automation/slack/test"),

  getResilienceSettings: () => client.get<{ success: boolean; data: ResilienceSettings }>('/resilience/settings'),
  updateResilienceSettings: (settings: ResilienceSettings) =>
    client.put<{ success: boolean; data: ResilienceSettings }>('/resilience/settings', settings),
  getResilienceStatus: () => client.get<{ success: boolean; data: ResilienceStatus }>('/resilience/status'),
  getResilienceTimeline: (days: number) =>
    client.get<{ success: boolean; data: PowerDay[] }>('/resilience/timeline', { params: { days } }),
  refreshResilience: () => client.post<{ success: boolean; data: ResilienceStatus }>('/resilience/refresh'),
  getResilienceCatalog: () => client.get<{ success: boolean; data: YasnoRegion[] }>('/resilience/catalog'),
  getResilienceGroups: (regionId: number, dsoId: number) =>
    client.get<{ success: boolean; data: string[] }>('/resilience/groups', { params: { regionId, dsoId } }),
  searchResilienceStreets: (regionId: number, dsoId: number, query: string) =>
    client.get<{ success: boolean; data: YasnoAddressOption[] }>('/resilience/address/streets', { params: { regionId, dsoId, query } }),
  searchResilienceHouses: (regionId: number, dsoId: number, streetId: number, query: string) =>
    client.get<{ success: boolean; data: YasnoAddressOption[] }>('/resilience/address/houses', { params: { regionId, dsoId, streetId, query } }),
  resolveResilienceGroup: (regionId: number, dsoId: number, streetId: number, houseId: number) =>
    client.get<{ success: boolean; data: { group: string } }>('/resilience/address/group', { params: { regionId, dsoId, streetId, houseId } }),

  // System API
  getSystemVersion: () =>
    client.get<{ success: boolean; data: VersionInfo; error?: string }>("/system/version"),

  startSystemUpdate: () =>
    client.post<{ success: boolean; message: string; error?: string }>("/system/update"),

  getUpdateStatus: () =>
    client.get<{ success: boolean; data: UpdateStatus }>("/system/update/status"),
};
