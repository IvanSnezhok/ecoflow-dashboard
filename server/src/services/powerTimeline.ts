// Grid presence tracking and the per-day "light / no light" timeline compared
// with the outage schedule. Pure logic, no DB imports; resilienceService feeds
// it observations and persists the per-minute results.
import type { GridState, PowerDay, PowerSegment, ScheduleSource } from '../types/resilience.js'

/** Mains voltage below this is treated as no grid. */
const GRID_MIN_VOLTS = 150

/**
 * Whether the device sees mains on its AC input. `inv.acInVol` (mV on DELTA Pro)
 * is the reliable signal; input watts are only conclusive when positive, since a
 * full battery with nothing on bypass draws ~0 W while the grid is present.
 */
export function detectGridPresence(raw: Record<string, unknown>): boolean | null {
  const voltage = Number(raw['inv.acInVol'])
  if (raw['inv.acInVol'] !== undefined && Number.isFinite(voltage)) {
    return (voltage > 1000 ? voltage / 1000 : voltage) >= GRID_MIN_VOLTS
  }
  const frequency = Number(raw['inv.acInFreq'])
  if (raw['inv.acInFreq'] !== undefined && Number.isFinite(frequency)) return frequency >= 40
  const inputWatts = Number(raw['inv.inputWatts'])
  if (Number.isFinite(inputWatts) && inputWatts > 0) return true
  return null
}

export interface MinuteSample {
  /** Unix epoch minute (UTC). */
  minute: number
  gridOn: boolean
  /** Energy delivered by the device outputs during this minute. */
  loadWh: number
  /** Seconds the device fed consumers from battery (grid off, output > 0). */
  ecoflowSeconds: number
}

export interface GridEpisode {
  state: 'on' | 'off'
  startMs: number
  endMs: number
  loadWh: number
  ecoflowSeconds: number
}

export interface GridObservation {
  nowMs: number
  present: boolean | null
  outputWatts: number
}

export interface GridObserveResult {
  changed: boolean
  previous: GridState
  /** The episode that just ended, when the state changed from on/off. */
  finished?: GridEpisode
  /** Current minute totals to persist; absent while the state is unknown. */
  minute?: MinuteSample
}

/** Consecutive observations a new grid state needs before it is accepted. */
const CONFIRM_OBSERVATIONS = 2
/** Longer gaps between observations are not integrated into energy totals. */
const MAX_INTEGRATION_GAP_MS = 3 * 60_000

export class GridTracker {
  state: GridState = 'unknown'
  sinceMs?: number
  episodeWh = 0
  episodeEcoflowSeconds = 0
  private pending?: { present: boolean; count: number; firstMs: number }
  private lastObservationMs?: number
  private current?: MinuteSample

  /** Resume an episode that was in progress before a restart. */
  restore(state: 'on' | 'off', sinceMs: number, loadWh: number, ecoflowSeconds: number, minute?: MinuteSample): void {
    this.state = state
    this.sinceMs = sinceMs
    this.episodeWh = loadWh
    this.episodeEcoflowSeconds = ecoflowSeconds
    this.current = minute
  }

  observe(observation: GridObservation): GridObserveResult {
    const { nowMs, present } = observation
    const gapMs = this.lastObservationMs === undefined ? 0 : nowMs - this.lastObservationMs
    const dtMs = gapMs > 0 && gapMs <= MAX_INTEGRATION_GAP_MS ? gapMs : 0
    this.lastObservationMs = nowMs
    const previous = this.state
    const result: GridObserveResult = { changed: false, previous }
    if (present === null) return result

    const observed = present ? 'on' : 'off'
    if (this.state === 'unknown') {
      this.state = observed
      this.sinceMs = nowMs
      this.pending = undefined
    } else if (observed === this.state) {
      this.pending = undefined
    } else {
      this.pending = this.pending?.present === present
        ? { ...this.pending, count: this.pending.count + 1 }
        : { present, count: 1, firstMs: nowMs }
      if (this.pending.count >= CONFIRM_OBSERVATIONS) {
        result.finished = {
          state: this.state, startMs: this.sinceMs ?? this.pending.firstMs, endMs: this.pending.firstMs,
          loadWh: Math.round(this.episodeWh), ecoflowSeconds: Math.round(this.episodeEcoflowSeconds),
        }
        this.state = observed
        this.sinceMs = this.pending.firstMs
        this.episodeWh = 0
        this.episodeEcoflowSeconds = 0
        this.pending = undefined
        result.changed = true
      }
    }

    const outputWatts = Math.max(0, observation.outputWatts || 0)
    const wh = outputWatts * dtMs / 3_600_000
    const ecoflowSeconds = this.state === 'off' && outputWatts > 0 ? dtMs / 1000 : 0
    this.episodeWh += wh
    this.episodeEcoflowSeconds += ecoflowSeconds

    const minute = Math.floor(nowMs / 60_000)
    if (!this.current || this.current.minute !== minute) {
      this.current = { minute, gridOn: this.state === 'on', loadWh: 0, ecoflowSeconds: 0 }
    }
    this.current.gridOn = this.state === 'on'
    this.current.loadWh += wh
    this.current.ecoflowSeconds += ecoflowSeconds
    result.minute = { ...this.current }
    return result
  }
}

export interface ScheduleWindow {
  startMs: number
  endMs: number
}

export interface PowerDayInput {
  day: string
  dayStartMs: number
  dayEndMs: number
  nowMs: number
  minutes: MinuteSample[]
  scheduledOff: ScheduleWindow[]
  scheduleSource: ScheduleSource | null
}

/**
 * One Kyiv day of the timeline: actual grid segments (gaps in tracking are
 * 'unknown') next to the scheduled outage windows, with minute-level totals.
 * Comparison totals cover only the elapsed part of the day.
 */
export function buildPowerDay(input: PowerDayInput): PowerDay {
  const byMinute = new Map(input.minutes.map(sample => [sample.minute, sample]))
  const firstMinute = Math.ceil(input.dayStartMs / 60_000)
  const endMinute = Math.floor(Math.min(input.dayEndMs, input.nowMs) / 60_000)
  const scheduledAt = (ms: number) => input.scheduledOff.some(window => ms >= window.startMs && ms < window.endMs)

  const segments: PowerSegment[] = []
  const stats = {
    onMinutes: 0, offMinutes: 0, unknownMinutes: 0, scheduledOffMinutes: 0,
    extraOnMinutes: 0, unplannedOffMinutes: 0, ecoflowMinutes: 0, ecoflowWh: 0,
  }
  let ecoflowSeconds = 0
  let ecoflowWh = 0

  for (let minute = firstMinute; minute < endMinute; minute += 1) {
    const sample = byMinute.get(minute)
    const state: GridState = sample ? (sample.gridOn ? 'on' : 'off') : 'unknown'
    const scheduled = scheduledAt(minute * 60_000)
    if (state === 'on') {
      stats.onMinutes += 1
      if (scheduled) stats.extraOnMinutes += 1
    } else if (state === 'off') {
      stats.offMinutes += 1
      if (!scheduled) stats.unplannedOffMinutes += 1
      ecoflowSeconds += sample?.ecoflowSeconds ?? 0
      ecoflowWh += sample?.loadWh ?? 0
    } else {
      stats.unknownMinutes += 1
    }
    const last = segments[segments.length - 1]
    if (last && last.state === state) last.end = new Date((minute + 1) * 60_000).toISOString()
    else segments.push({ state, start: new Date(minute * 60_000).toISOString(), end: new Date((minute + 1) * 60_000).toISOString() })
  }

  const windows = input.scheduledOff
    .map(window => ({ startMs: Math.max(window.startMs, input.dayStartMs), endMs: Math.min(window.endMs, input.dayEndMs) }))
    .filter(window => window.endMs > window.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  stats.scheduledOffMinutes = Math.round(windows.reduce((sum, window) => sum + window.endMs - window.startMs, 0) / 60_000)
  stats.ecoflowMinutes = Math.round(ecoflowSeconds / 60)
  stats.ecoflowWh = Math.round(ecoflowWh)

  return {
    day: input.day,
    start: new Date(input.dayStartMs).toISOString(),
    end: new Date(input.dayEndMs).toISOString(),
    scheduleSource: input.scheduleSource,
    future: input.dayStartMs > input.nowMs,
    segments,
    scheduledOff: windows.map(window => ({ start: new Date(window.startMs).toISOString(), end: new Date(window.endMs).toISOString() })),
    stats,
  }
}
