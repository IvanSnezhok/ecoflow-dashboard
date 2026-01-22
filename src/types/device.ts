export interface Device {
  id: number;
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
  online: boolean;
  lastSeen: string | null;
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
}

export interface DeviceErrorCodes {
  bmsMasterErrCode: number; // Main BMS error code
  invErrCode: number; // Inverter error code
  mpptFaultCode: number; // MPPT/Solar controller fault code
  overloadState: number; // Overload state (0 = normal)
  emsIsNormal: boolean; // EMS normal operation flag
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
