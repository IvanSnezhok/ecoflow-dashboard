export interface DeviceCapabilities {
  battery: boolean;
  acOutput: boolean;
  dcOutput: boolean;
  solarInput: boolean;
  extraBatteries: boolean;
  chargeLimits: boolean;
  chargingPower?: { min: number; max: number; step: number };
}

export interface Device {
  id: number;
  profileId?: string;
  category?: string;
  profileStatus?: "supported" | "read-only";
  capabilities?: DeviceCapabilities;
  serialNumber: string;
  deviceType:
    | "DELTA_PRO"
    | "DELTA_PRO_3"
    | "DELTA Pro"
    | "DELTA Max"
    | "RIVER"
    | "RIVER_MAX"
    | "RIVER_PRO"
    | "SMART_PLUG";
  name: string;
  online: boolean; // data available, from the cloud or over Bluetooth
  cloudOnline?: boolean; // the cloud's own flag: the device's Wi-Fi/cloud link
  dataSource?: DataSource | null;
  lastSeen: string | null;
}

// "mqtt": the REST quota is refused (code 1006, e.g. a shared device), read from MQTT pushes;
// "app": the same, read in full through the EcoFlow app channel
export type DataSource = "cloud" | "ble" | "cloud+ble" | "mqtt" | "app";

// Panel login (server/src/services/panelAuth.ts)
export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface AuthSetupStart {
  setupId: string;
  secret: string;
  otpauthUri: string;
  /** data: URL of the QR code for the authenticator app */
  qrCode: string;
}

export interface AuthSession {
  id: string;
  current: boolean;
  remember: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

// GET /api/app-account/status — mirrors server/src/services/appChannel.ts
export type AppRegion = "api-e" | "api" | "api-a" | "api-j" | "api-r";

export interface AppChannelStatus {
  signedIn: boolean;
  source: "panel" | "env" | null;
  emailHint: string | null;
  userIdHint: string | null;
  region: AppRegion | null;
  defaultRegion: AppRegion;
  connected: boolean;
  lastError: string | null;
  devices: string[];
  envConfigured: boolean;
}

export interface ExtraBatteryState {
  soc: number; // State of charge (0-100)
  temp: number; // Temperature in Celsius
  vol: number; // Voltage in mV
  inputWatts: number; // Input power
  outputWatts: number; // Output power
  cycles: number; // Charge cycles
  soh: number; // State of health (0-100)
  fullCap: number; // Full capacity in mAh
  remainCap: number; // Remaining capacity in mAh
  connected: boolean; // Whether the battery is connected
  errCode?: number; // Error code (0 = no error)
  held?: boolean; // Missing from the latest quota; values are from its last report
  lastUpdated?: string; // ISO time the device last reported this pack
}

export interface DeviceErrorCodes {
  bmsMasterErrCode: number; // Main BMS error code
  invErrCode: number; // Inverter error code
  mpptFaultCode: number; // MPPT/Solar controller fault code
  overloadState: number; // Overload state (0 = normal)
  emsIsNormal: boolean; // EMS flag: false = sleep mode (not an error)
  bmsFault?: number; // bmsMaster.bmsFault: permanent BMS fault (0 = none)
  bmsWarningState?: number; // ems.bmsWarningState bits: 0 hi-temp, 1 low-temp, 2 overload
}

// Last known errors for offline devices
export interface LastKnownErrors extends DeviceErrorCodes {
  bmsSlave1ErrCode?: number; // Extra battery 1 error code
  bmsSlave2ErrCode?: number; // Extra battery 2 error code
  timestamp: string; // When these errors were last recorded
}

export interface DeviceState {
  serialNumber: string;
  batterySoc: number; // State of charge (0-100)
  batteryWatts: number; // Positive = charging, negative = discharging
  acInputWatts: number;
  solarInputWatts: number;
  acOutputWatts: number;
  dcOutputWatts: number;
  temperature: number;
  acOutEnabled: boolean;
  dcOutEnabled: boolean;
  timestamp: string;
  // ETA in minutes
  chgRemainTime?: number; // Charging remaining time in minutes
  dsgRemainTime?: number; // Discharging remaining time in minutes
  // Extra batteries (for Delta Pro)
  extraBattery1?: ExtraBatteryState;
  extraBattery2?: ExtraBatteryState;
  // Charge settings
  maxChgSoc?: number; // Max charge SOC (50-100%)
  minDsgSoc?: number; // Min discharge SOC (0-30%)
  acChargingPower?: number; // AC charging power in watts (200-2900W)
  fastChargingEnabled?: boolean; // Fast charging mode (power limit not available)
  // Error codes
  errorCodes?: DeviceErrorCodes;
}

export interface DeviceWithState extends Device {
  state: DeviceState | null;
  quotaError?: string | null; // why an online device has no state, e.g. "code 1006: ..."
  lastKnownErrors?: LastKnownErrors | null; // Errors from when device was last online
}

// Chart types
export type ChartPeriod = "10m" | "1h" | "24h" | "7d" | "30d" | "custom";

export interface DateRange {
  from: string;  // ISO date string
  to: string;    // ISO date string
}

export interface HistoryDataPoint {
  timestamp: string;
  batterySoc: number | null;
  batteryWatts: number | null;
  acInputWatts: number | null;
  solarInputWatts: number | null;
  acOutputWatts: number | null;
  dcOutputWatts: number | null;
  temperature: number | null;
  // New fields for detailed charts
  bmsMasterVol: number | null;
  extraBattery1Soc: number | null;
  extraBattery1Temp: number | null;
  extraBattery1Vol: number | null;
  extraBattery2Soc: number | null;
  extraBattery2Temp: number | null;
  extraBattery2Vol: number | null;
}

export interface HistoryResponse {
  deviceSn: string;
  period: ChartPeriod;
  from: string;
  to: string;
  aggregation: string;
  dataPoints: HistoryDataPoint[];
}

// Error history types
export type ErrorType = 'bms' | 'inv' | 'mppt' | 'overload' | 'ems' | 'extraBattery1' | 'extraBattery2';

export interface ErrorHistoryEntry {
  timestamp: string;
  errorType: ErrorType;
  errorCode: number;
}

export interface ErrorHistoryResponse {
  deviceSn: string;
  errors: ErrorHistoryEntry[];
}

// Technical details (GET /devices/:sn/info). The EcoFlow Open API does not report
// MAC address or SSID for most models, so those are usually null.
export interface DeviceTechnicalInfo {
  serialNumber: string;
  productName: string;
  model: number | null;
  firmware: { module: string; version: string }[];
  batteryPacks: { label: string; serialNumber: string | null; firmware: string | null }[];
  wifi: {
    rssi: number | null; // dBm
    ssid: string | null;
    macAddress: string | null;
    firmware: string | null;
  };
  recordedAt: string | null; // null = live data, otherwise last stored snapshot
  connection: ConnectionSummary;
  ble: BleStatus;
  dataSource: DataSource | null;
}

// Direct Bluetooth session through the ble-bridge container
export interface BleStatus {
  enabled: boolean; // the bridge is configured for this deployment
  switchedOn: boolean; // the panel switch
  mode: "prefer" | "fallback" | "off"; // active mode (panel choice, else .env)
  defaultMode: "prefer" | "fallback" | "off"; // ECOFLOW_BLE_MODE
  reachable: boolean; // the bridge answers
  error: string | null;
  scanning: boolean;
  scannerError: string | null;
  userIdConfigured: boolean;
  userIdSource: "panel" | "env" | "login" | null;
  userIdHint: string | null; // last digits only
  loginError: string | null;
  device: {
    state: string;
    authenticated: boolean;
    live: boolean; // fresh data is flowing
    rssi: number | null; // dBm, from the last advertisement
    address: string | null;
    authenticatedSince: number | null; // epoch ms
    lastPacketAt: number | null;
    error: string | null;
    pausedUntil: number | null;
    sessionsStarted: number;
  } | null;
}

// How long the Wi-Fi/cloud connection holds, from the online flag the backend polls
export interface ConnectionSummary {
  online: boolean | null; // null = not tracked yet
  since: string | null; // ISO start of the current online/offline streak
  sinceExact: boolean; // false = started before tracking or while the dashboard was down
  unobservedMs: number; // part of the streak the dashboard was not watching
  lastOutage: { start: string; end: string | null; durationMs: number; exact: boolean } | null;
  disconnects24h: number;
  disconnects7d: number;
  trackingSince: string | null;
}

// GET /api/ble/status
export interface BleOverview extends Omit<BleStatus, "device"> {
  devices: Array<{ sn: string; state: string; live: boolean; error: string | null; rssi: number | null }>;
}

// POST /api/devices/:sn/probe — mirrors server/src/services/dataAccess.ts
export interface ProbeRead {
  ok: boolean;
  code?: string;
  message?: string;
  fieldCount?: number;
  sample?: Record<string, unknown>;
}

export interface ProbeTopic {
  subscribed: boolean;
  error?: string;
  messages: number;
  keys: string[];
  maxFields: number;
}

export interface ProbeGet {
  variant: string;
  sent: number;
  replies: number;
  fieldCount: number;
  code?: string;
  message?: string;
}

export interface ProbeMqtt {
  quota: ProbeTopic;
  status: ProbeTopic;
  getReply: ProbeTopic;
  gets: ProbeGet[];
  otherTopics: Record<string, number>;
}

export interface DeviceProbe {
  serialNumber: string;
  name: string | null;
  productName: string | null;
  inList: boolean;
  cloudOnline: boolean;
  quotaAll: ProbeRead;
  quotaFields: ProbeRead;
  mqtt: ProbeMqtt | null;
}

export type ProbeVerdict = "data-available" | "mqtt-only" | "refused" | "keys-failing" | "offline" | "not-listed";

export interface DataAccessReport {
  checkedAt: string;
  listenSeconds: number;
  mqttError: string | null;
  mqttSubscription: "wildcard" | "topics" | null;
  target: DeviceProbe;
  comparison: DeviceProbe | null;
  verdict: ProbeVerdict;
}
