export interface LoadPeriod {
  start: string
  end: string
  watts: number
  label?: string
}

export interface ResilienceSettings {
  deviceId?: number
  enabled: boolean
  autoAc: boolean
  regionId?: number
  dsoId?: number
  outageGroup?: string
  warningLeadMinutes: number
  recoveryDelayMinutes: number
  minSoc: number
  reserveSoc: number
  batteryCapacityWh: number
  inverterEfficiency: number
  loadProfile: LoadPeriod[]
  updatedAt?: string
}

export interface OutageEvent {
  start: string
  end: string
  type: 'definite' | 'possible' | 'emergency'
  source: 'planned' | 'probable' | 'emergency'
}

export interface RuntimeForecast {
  batteryCount: number
  nominalWh: number
  usableWh: number
  averageLoadWatts: number
  hoursRemaining: number | null
  depletionAt: string | null
}

export interface ResilienceStatus {
  risk: 'none' | 'watch' | 'imminent' | 'active' | 'emergency' | 'stale'
  currentEvent?: OutageEvent
  nextEvent?: OutageEvent
  scheduleStatus?: string
  scheduleUpdatedAt?: string
  checkedAt?: string
  error?: string
  acAction?: 'on' | 'off' | 'blocked-low-soc' | 'none'
  forecast?: RuntimeForecast
  events: OutageEvent[]
}
