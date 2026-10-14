// Load model behind the runtime forecast. The primary source is the measured
// consumption history; the hand-written load profile only fills slots for
// which there is not enough history yet. Pure functions, no DB imports.
import { kyivDateKey, kyivMinuteOfDay } from '../lib/kyivTime.js'
import type { LoadPeriod, LoadSource, RuntimeForecast } from '../types/resilience.js'

export const PROFILE_SLOT_MINUTES = 30
export const PROFILE_SLOTS = 1440 / PROFILE_SLOT_MINUTES
/** Roughly ten minutes of 10-second samples before a slot average is trusted. */
export const MIN_SLOT_SAMPLES = 60

/** Pre-aggregated consumption samples; buckets must not straddle a 30-minute Kyiv slot. */
export interface LoadBucket {
  bucketStartMs: number
  wattsSum: number
  samples: number
}

export interface HistoricalProfile {
  /** Average output watts per 30-minute Kyiv slot, null when history is too thin. */
  slots: Array<number | null>
  /** Distinct Kyiv days that contributed samples. */
  days: number
}

export const emptyHistoricalProfile: HistoricalProfile = { slots: new Array(PROFILE_SLOTS).fill(null), days: 0 }

export function buildHistoricalProfile(buckets: LoadBucket[]): HistoricalProfile {
  const sums = new Array<number>(PROFILE_SLOTS).fill(0)
  const counts = new Array<number>(PROFILE_SLOTS).fill(0)
  const days = new Set<string>()
  for (const bucket of buckets) {
    if (bucket.samples <= 0) continue
    const at = new Date(bucket.bucketStartMs)
    const slot = Math.floor(kyivMinuteOfDay(at) / PROFILE_SLOT_MINUTES)
    sums[slot] += bucket.wattsSum
    counts[slot] += bucket.samples
    days.add(kyivDateKey(at))
  }
  return {
    slots: counts.map((count, slot) => count >= MIN_SLOT_SAMPLES ? Math.round(sums[slot] / count) : null),
    days: days.size,
  }
}

function timeToMinutes(value: string): number {
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}

function profileMatch(profile: LoadPeriod[], minuteOfDay: number): LoadPeriod | undefined {
  return profile.find(period => {
    const start = timeToMinutes(period.start)
    const end = timeToMinutes(period.end)
    return start <= end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end
  })
}

/** Watts from the hand-written profile at a Kyiv time, or the fallback. */
export function loadAt(profile: LoadPeriod[], at: Date, fallbackWatts: number): number {
  return Math.max(0, profileMatch(profile, kyivMinuteOfDay(at))?.watts ?? fallbackWatts)
}

export interface LoadModel {
  history?: HistoricalProfile
  loadProfile: LoadPeriod[]
  fallbackWatts: number
}

type StepSource = 'history' | 'profile' | 'current'

function resolveLoad(model: LoadModel, at: Date): { watts: number; source: StepSource } {
  const minute = kyivMinuteOfDay(at)
  const historical = model.history?.slots[Math.floor(minute / PROFILE_SLOT_MINUTES)]
  if (historical !== null && historical !== undefined) return { watts: historical, source: 'history' }
  const period = profileMatch(model.loadProfile, minute)
  if (period) return { watts: Math.max(0, period.watts), source: 'profile' }
  return { watts: Math.max(0, model.fallbackWatts), source: 'current' }
}

const STEP_MINUTES = 5

/** Expected energy drawn by consumers between two instants, in Wh. */
export function estimateEnergyWh(model: LoadModel, from: Date, to: Date): number {
  let total = 0
  for (let cursor = from.getTime(); cursor < to.getTime(); cursor += STEP_MINUTES * 60_000) {
    const stepMs = Math.min(STEP_MINUTES * 60_000, to.getTime() - cursor)
    total += resolveLoad(model, new Date(cursor)).watts * stepMs / 3_600_000
  }
  return Math.round(total)
}

export function calculateRuntimeForecast(args: LoadModel & {
  mainSoc: number
  extraBatterySocs: number[]
  batteryCapacityWh: number
  reserveSoc: number
  inverterEfficiency: number
  now?: Date
}): RuntimeForecast {
  const now = args.now ?? new Date()
  const socs = [args.mainSoc, ...args.extraBatterySocs]
  const nominalWh = socs.length * args.batteryCapacityWh
  const dcUsableWh = socs.reduce(
    (sum, soc) => sum + args.batteryCapacityWh * Math.max(0, soc - args.reserveSoc) / 100,
    0,
  )
  const usableWh = dcUsableWh * args.inverterEfficiency
  let remaining = usableWh
  let cursor = new Date(now)
  let weightedLoad = 0
  let elapsedHours = 0
  const stepHours = STEP_MINUTES / 60
  const maxSteps = 14 * 24 * (60 / STEP_MINUTES)
  const sources = new Set<StepSource>()

  for (let step = 0; step < maxSteps && remaining > 0; step += 1) {
    const { watts, source } = resolveLoad(args, cursor)
    sources.add(source)
    weightedLoad += watts * stepHours
    elapsedHours += stepHours
    if (watts > 0) remaining -= watts * stepHours
    cursor = new Date(cursor.getTime() + STEP_MINUTES * 60_000)
  }
  // An empty battery never enters the loop; describe the load it would face.
  if (sources.size === 0) sources.add(resolveLoad(args, now).source)

  const depleted = remaining <= 0
  const loadSource: LoadSource = sources.size > 1 ? 'mixed' : [...sources][0]
  return {
    batteryCount: socs.length,
    nominalWh: Math.round(nominalWh),
    usableWh: Math.round(usableWh),
    averageLoadWatts: elapsedHours > 0 ? Math.round(weightedLoad / elapsedHours) : 0,
    hoursRemaining: depleted ? Math.round(elapsedHours * 10) / 10 : null,
    depletionAt: depleted ? cursor.toISOString() : null,
    loadSource,
    historyDays: args.history?.days ?? 0,
  }
}
