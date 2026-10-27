export interface LoadPeriod {
  start: string
  end: string
  watts: number
  label?: string
}

/**
 * hybrid: the YASNO schedule and the device's own grid reading both switch AC on.
 * grid: only the device losing mains does; no YASNO address is needed or used.
 */
export type ResilienceMode = 'hybrid' | 'grid'

export interface ResilienceSettings {
  deviceId?: number
  enabled: boolean
  mode: ResilienceMode
  autoAc: boolean
  notifySlack: boolean
  regionId?: number
  dsoId?: number
  outageGroup?: string
  warningLeadMinutes: number
  recoveryDelayMinutes: number
  minSoc: number
  reserveSoc: number
  batteryCapacityWh: number
  inverterEfficiency: number
  /** AC is switched off only once the output load stays below this. */
  acOffMaxWatts: number
  loadProfile: LoadPeriod[]
  updatedAt?: string
}

export interface OutageEvent {
  start: string
  end: string
  type: 'definite' | 'possible' | 'emergency'
  source: 'planned' | 'probable' | 'emergency'
}

/** Where the forecast load came from: measured history, the manual profile, the current load, or a mix. */
export type LoadSource = 'history' | 'profile' | 'current' | 'mixed'

export interface RuntimeForecast {
  batteryCount: number
  nominalWh: number
  usableWh: number
  averageLoadWatts: number
  hoursRemaining: number | null
  depletionAt: string | null
  loadSource: LoadSource
  historyDays: number
  /** Expected consumption for the rest of the current window, or the whole next one. */
  windowDemandWh?: number
}

export type GridState = 'on' | 'off' | 'unknown'

export interface GridStatus {
  state: GridState
  since?: string
  /** Grid is off although the schedule has no outage window now. */
  unplanned: boolean
  /** Energy and battery time of the current outage so far. */
  outageWh?: number
  outageEcoflowMinutes?: number
}

export type ScheduleSource = 'planned' | 'probable'

export interface PowerSegment {
  state: GridState
  start: string
  end: string
}

export interface PowerDayStats {
  onMinutes: number
  offMinutes: number
  unknownMinutes: number
  /** Whole-day total of the scheduled outage windows. */
  scheduledOffMinutes: number
  /** Grid was on although the schedule said it should be off. */
  extraOnMinutes: number
  /** Grid was off although the schedule said it should be on. */
  unplannedOffMinutes: number
  /** Minutes the EcoFlow fed consumers while the grid was off. */
  ecoflowMinutes: number
  ecoflowWh: number
}

export interface PowerDay {
  day: string
  /** Kyiv midnight to midnight; 23 or 25 hours on DST days. */
  start: string
  end: string
  scheduleSource: ScheduleSource | null
  future: boolean
  segments: PowerSegment[]
  scheduledOff: Array<{ start: string; end: string }>
  stats: PowerDayStats
}

export interface LoadProfileStatus {
  slotMinutes: number
  slots: Array<number | null>
  days: number
}

export interface ResilienceStatus {
  /** Saved mode; in 'grid' the schedule fields stay empty and risk stays 'none'. */
  mode?: ResilienceMode
  risk: 'none' | 'watch' | 'imminent' | 'active' | 'emergency' | 'stale'
  currentEvent?: OutageEvent
  nextEvent?: OutageEvent
  scheduleStatus?: string
  scheduleUpdatedAt?: string
  checkedAt?: string
  error?: string
  acAction?: 'on' | 'off' | 'waiting-load' | 'blocked-low-soc' | 'failed' | 'none'
  forecast?: RuntimeForecast
  grid?: GridStatus
  loadHistory?: LoadProfileStatus
  events: OutageEvent[]
}
