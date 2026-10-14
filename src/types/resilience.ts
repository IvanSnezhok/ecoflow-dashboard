export interface LoadPeriod { start: string; end: string; watts: number; label?: string }
export interface ResilienceSettings {
  deviceId?: number; enabled: boolean; autoAc: boolean; notifySlack: boolean; regionId?: number; dsoId?: number; outageGroup?: string
  warningLeadMinutes: number; recoveryDelayMinutes: number; minSoc: number; reserveSoc: number
  batteryCapacityWh: number; inverterEfficiency: number; acOffMaxWatts: number; loadProfile: LoadPeriod[]; updatedAt?: string
}
export interface OutageEvent { start: string; end: string; type: 'definite' | 'possible' | 'emergency'; source: 'planned' | 'probable' | 'emergency' }
export type LoadSource = 'history' | 'profile' | 'current' | 'mixed'
export interface RuntimeForecast {
  batteryCount: number; nominalWh: number; usableWh: number; averageLoadWatts: number; hoursRemaining: number | null; depletionAt: string | null
  loadSource: LoadSource; historyDays: number; windowDemandWh?: number
}
export type GridState = 'on' | 'off' | 'unknown'
export interface GridStatus { state: GridState; since?: string; unplanned: boolean; outageWh?: number; outageEcoflowMinutes?: number }
export interface LoadProfileStatus { slotMinutes: number; slots: Array<number | null>; days: number }
export type AcAction = 'on' | 'off' | 'waiting-load' | 'blocked-low-soc' | 'failed' | 'none'
export interface ResilienceStatus {
  risk: 'none' | 'watch' | 'imminent' | 'active' | 'emergency' | 'stale'; currentEvent?: OutageEvent; nextEvent?: OutageEvent
  scheduleStatus?: string; scheduleUpdatedAt?: string; checkedAt?: string; error?: string
  acAction?: AcAction; forecast?: RuntimeForecast; grid?: GridStatus; loadHistory?: LoadProfileStatus; events: OutageEvent[]
}
export interface PowerSegment { state: GridState; start: string; end: string }
export interface PowerDayStats {
  onMinutes: number; offMinutes: number; unknownMinutes: number; scheduledOffMinutes: number
  extraOnMinutes: number; unplannedOffMinutes: number; ecoflowMinutes: number; ecoflowWh: number
}
export interface PowerDay {
  day: string; start: string; end: string; scheduleSource: 'planned' | 'probable' | null; future: boolean
  segments: PowerSegment[]; scheduledOff: Array<{ start: string; end: string }>; stats: PowerDayStats
}
export interface YasnoDso { id: number; name: string }
export interface YasnoRegion { id: number; name?: string; value?: string; dsos?: YasnoDso[] }
export interface YasnoAddressOption { id: number; name?: string; value?: string; label?: string }
