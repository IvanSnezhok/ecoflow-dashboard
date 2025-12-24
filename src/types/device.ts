export interface Device {
  serialNumber: string
  deviceType: 'DELTA_PRO' | 'DELTA_PRO_3' | 'RIVER' | 'RIVER_MAX' | 'RIVER_PRO' | 'SMART_PLUG'
  name: string
  online: boolean
  lastSeen: string | null
}

export interface ExtraBatteryState {
  soc: number                 // State of charge (0-100)
  temp: number                // Temperature in Celsius
  vol: number                 // Voltage in mV
  inputWatts: number          // Input power
  outputWatts: number         // Output power
  cycles: number              // Charge cycles
  soh: number                 // State of health (0-100)
  fullCap: number             // Full capacity in mAh
  remainCap: number           // Remaining capacity in mAh
  connected: boolean          // Whether the battery is connected
}

export interface DeviceState {
  serialNumber: string
  batterySoc: number          // State of charge (0-100)
  batteryWatts: number        // Positive = charging, negative = discharging
  acInputWatts: number
  solarInputWatts: number
  acOutputWatts: number
  dcOutputWatts: number
  temperature: number
  acOutEnabled: boolean
  dcOutEnabled: boolean
  timestamp: string
  // ETA in minutes
  chgRemainTime?: number      // Charging remaining time in minutes
  dsgRemainTime?: number      // Discharging remaining time in minutes
  // Extra batteries (for Delta Pro)
  extraBattery1?: ExtraBatteryState
  extraBattery2?: ExtraBatteryState
}

export interface DeviceWithState extends Device {
  state: DeviceState | null
}

// Chart types
export type ChartPeriod = '10m' | '1h' | '24h' | '7d' | '30d'

export interface HistoryDataPoint {
  timestamp: string
  batterySoc: number
  batteryWatts: number
  acInputWatts: number
  solarInputWatts: number
  acOutputWatts: number
  dcOutputWatts: number
  temperature: number
}

export interface HistoryResponse {
  deviceSn: string
  period: ChartPeriod
  from: string
  to: string
  aggregation: string
  dataPoints: HistoryDataPoint[]
}
