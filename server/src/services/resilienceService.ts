import { ecoflowApi } from './ecoflowApi.js'
import { getResilienceSettings, insertLog, type ResilienceSettingsRow } from '../db/database.js'
import type {
  LoadPeriod,
  OutageEvent,
  ResilienceSettings,
  ResilienceStatus,
  RuntimeForecast,
} from '../types/resilience.js'

const REGIONS_URL = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/addresses/v2/regions'
const PLANNED_URL = (region: number, dso: number) =>
  `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/${region}/dsos/${dso}/planned-outages`
const PROBABLE_URL = (region: number, dso: number) =>
  `https://app.yasno.ua/api/blackout-service/public/shutdowns/probable-outages?regionId=${region}&dsoId=${dso}`
const STREETS_URL = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/addresses/v2/streets'
const HOUSES_URL = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/addresses/v2/houses'
const ADDRESS_GROUP_URL = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/addresses/v2/group'
const SCHEDULE_TTL_MS = 5 * 60_000
const MAX_STALE_MS = 30 * 60_000

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function rowToSettings(row?: ResilienceSettingsRow): ResilienceSettings {
  let loadProfile: LoadPeriod[] = []
  try { loadProfile = row ? JSON.parse(row.load_profile) as LoadPeriod[] : [] } catch { /* default */ }
  return {
    deviceId: row?.device_id ?? undefined,
    enabled: row?.enabled === 1,
    autoAc: row?.auto_ac === 1,
    regionId: row?.region_id ?? undefined,
    dsoId: row?.dso_id ?? undefined,
    outageGroup: row?.outage_group ?? undefined,
    warningLeadMinutes: row?.warning_lead_minutes ?? 60,
    recoveryDelayMinutes: row?.recovery_delay_minutes ?? 15,
    minSoc: row?.min_soc ?? 25,
    reserveSoc: row?.reserve_soc ?? 15,
    batteryCapacityWh: row?.battery_capacity_wh ?? 3600,
    inverterEfficiency: row?.inverter_efficiency ?? 0.85,
    loadProfile,
    updatedAt: row?.updated_at,
  }
}

function minutes(date: Date): number { return date.getHours() * 60 + date.getMinutes() }
function timeToMinutes(value: string): number {
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}

function kyivDateAtMinutes(dateValue: string, minuteOfDay: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateValue)
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, 0, minuteOfDay)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(utcGuess))
  const values = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]))
  const representedAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second)
  return new Date(utcGuess - (representedAsUtc - utcGuess))
}

export function loadAt(profile: LoadPeriod[], at: Date, fallbackWatts: number): number {
  const point = minutes(at)
  const match = profile.find(period => {
    const start = timeToMinutes(period.start)
    const end = timeToMinutes(period.end)
    return start <= end ? point >= start && point < end : point >= start || point < end
  })
  return Math.max(0, match?.watts ?? fallbackWatts)
}

export function calculateRuntimeForecast(args: {
  mainSoc: number
  extraBatterySocs: number[]
  batteryCapacityWh: number
  reserveSoc: number
  inverterEfficiency: number
  loadProfile: LoadPeriod[]
  fallbackWatts: number
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
  const stepHours = 5 / 60
  const maxSteps = 14 * 24 * 12

  for (let step = 0; step < maxSteps && remaining > 0; step += 1) {
    const watts = loadAt(args.loadProfile, cursor, args.fallbackWatts)
    weightedLoad += watts * stepHours
    elapsedHours += stepHours
    if (watts > 0) remaining -= watts * stepHours
    cursor = new Date(cursor.getTime() + 5 * 60_000)
  }

  const depleted = remaining <= 0
  return {
    batteryCount: socs.length,
    nominalWh: Math.round(nominalWh),
    usableWh: Math.round(usableWh),
    averageLoadWatts: elapsedHours > 0 ? Math.round(weightedLoad / elapsedHours) : 0,
    hoursRemaining: depleted ? Math.round(elapsedHours * 10) / 10 : null,
    depletionAt: depleted ? cursor.toISOString() : null,
  }
}

function eventFromSlot(slot: unknown, dateValue: unknown, source: OutageEvent['source']): OutageEvent | null {
  if (!isObject(slot) || typeof slot.start !== 'number' || typeof slot.end !== 'number' || typeof dateValue !== 'string') return null
  const start = kyivDateAtMinutes(dateValue, slot.start)
  const end = kyivDateAtMinutes(dateValue, slot.end)
  if (!start || !end) return null
  return {
    start: start.toISOString(), end: end.toISOString(),
    type: source === 'planned' ? 'definite' : 'possible', source,
  }
}

function parsePlanned(payload: unknown, group: string): { events: OutageEvent[]; status?: string; updatedAt?: string } {
  if (!isObject(payload) || !isObject(payload[group])) return { events: [] }
  const groupData = payload[group] as JsonObject
  const events: OutageEvent[] = []
  let status: string | undefined
  for (const key of ['today', 'tomorrow']) {
    const day = groupData[key]
    if (!isObject(day)) continue
    if (key === 'today' && typeof day.status === 'string') status = day.status
    const slots = Array.isArray(day.slots) ? day.slots : []
    for (const slot of slots) {
      const event = eventFromSlot(slot, day.date, 'planned')
      if (event && isObject(slot) && slot.type !== 'NotPlanned') events.push(event)
    }
  }
  return { events, status, updatedAt: typeof groupData.updatedOn === 'string' ? groupData.updatedOn : undefined }
}

function parseProbable(payload: unknown, region: number, dso: number, group: string, now: Date): OutageEvent[] {
  if (!isObject(payload)) return []
  const regionData = payload[String(region)]
  const dsoData = isObject(regionData) && isObject(regionData.dsos) ? regionData.dsos[String(dso)] : undefined
  const groupData = isObject(dsoData) && isObject(dsoData.groups) ? dsoData.groups[group] : undefined
  if (!isObject(groupData) || !isObject(groupData.slots)) return []
  const events: OutageEvent[] = []
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const day = new Date(now); day.setDate(day.getDate() + dayOffset)
    const rawSlots = groupData.slots[String((day.getDay() + 6) % 7)]
    if (!Array.isArray(rawSlots)) continue
    for (const slot of rawSlots) {
      const event = eventFromSlot(slot, day.toISOString(), 'probable')
      if (event && isObject(slot) && slot.type !== 'NotPlanned') events.push(event)
    }
  }
  return events
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`YASNO returned HTTP ${response.status}`)
  return response.json()
}

function withQuery(url: string, values: Record<string, string | number>): string {
  const query = new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]))
  return `${url}?${query.toString()}`
}

let cachedStatus: ResilienceStatus = { risk: 'none', events: [] }
let lastScheduleFetch = 0
let lastScheduleKey = ''
let automationOwnsAc = false
let lastAcCommandAt = 0
let lastRiskAt = 0

function assess(events: OutageEvent[], status: string | undefined, now: Date, leadMinutes: number): Pick<ResilienceStatus, 'risk' | 'currentEvent' | 'nextEvent'> {
  const sorted = events.filter(event => new Date(event.end) > now).sort((a, b) => +new Date(a.start) - +new Date(b.start))
  const current = sorted.find(event => new Date(event.start) <= now && new Date(event.end) > now)
  const next = sorted.find(event => new Date(event.start) > now)
  if (status === 'EmergencyShutdowns') return { risk: 'emergency', currentEvent: current, nextEvent: next }
  if (current) return { risk: 'active', currentEvent: current, nextEvent: next }
  if (next) {
    const until = (+new Date(next.start) - +now) / 60_000
    if (until <= leadMinutes) return { risk: 'imminent', nextEvent: next }
    if (next.type === 'possible') return { risk: 'watch', nextEvent: next }
  }
  return { risk: 'none', nextEvent: next }
}

async function refreshSchedule(settings: ResilienceSettings, force = false): Promise<void> {
  if (!settings.regionId || !settings.dsoId || !settings.outageGroup) return
  const scheduleKey = `${settings.regionId}:${settings.dsoId}:${settings.outageGroup}`
  if (!force && scheduleKey === lastScheduleKey && Date.now() - lastScheduleFetch < SCHEDULE_TTL_MS) return
  try {
    const [plannedPayload, probablePayload] = await Promise.all([
      fetchJson(PLANNED_URL(settings.regionId, settings.dsoId)),
      fetchJson(PROBABLE_URL(settings.regionId, settings.dsoId)),
    ])
    const planned = parsePlanned(plannedPayload, settings.outageGroup)
    const probable = parseProbable(probablePayload, settings.regionId, settings.dsoId, settings.outageGroup, new Date())
    const events = [...planned.events, ...probable].sort((a, b) => +new Date(a.start) - +new Date(b.start))
    cachedStatus = {
      ...cachedStatus, ...assess(events, planned.status, new Date(), settings.warningLeadMinutes),
      events, scheduleStatus: planned.status, scheduleUpdatedAt: planned.updatedAt,
      checkedAt: new Date().toISOString(), error: undefined,
    }
    lastScheduleFetch = Date.now()
    lastScheduleKey = scheduleKey
  } catch (error) {
    const stale = !cachedStatus.checkedAt || Date.now() - +new Date(cachedStatus.checkedAt) > MAX_STALE_MS
    cachedStatus = { ...cachedStatus, risk: stale ? 'stale' : cachedStatus.risk, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function getResilienceCatalog(): Promise<unknown> { return fetchJson(REGIONS_URL) }
export async function getResilienceGroups(regionId: number, dsoId: number): Promise<string[]> {
  const payload = await fetchJson(PLANNED_URL(regionId, dsoId))
  return isObject(payload) ? Object.keys(payload).sort() : []
}
export async function searchResilienceStreets(regionId: number, dsoId: number, query: string): Promise<unknown> {
  return fetchJson(withQuery(STREETS_URL, { regionId, dsoId, query }))
}
export async function searchResilienceHouses(regionId: number, dsoId: number, streetId: number, query: string): Promise<unknown> {
  return fetchJson(withQuery(HOUSES_URL, { regionId, dsoId, streetId, query }))
}
export async function resolveResilienceGroup(regionId: number, dsoId: number, streetId: number, houseId: number): Promise<string> {
  const payload = await fetchJson(withQuery(ADDRESS_GROUP_URL, { regionId, dsoId, streetId, houseId }))
  if (!isObject(payload) || payload.group === undefined || payload.subgroup === undefined) {
    throw new Error('YASNO did not return an outage group for this address')
  }
  return `${payload.group}.${payload.subgroup}`
}
export function getSettings(): ResilienceSettings { return rowToSettings(getResilienceSettings()) }
export async function forceRefresh(): Promise<ResilienceStatus> {
  const settings = getSettings(); lastScheduleFetch = 0
  await refreshSchedule(settings, true)
  return cachedStatus
}
export function getStatus(): ResilienceStatus { return cachedStatus }

export async function processResilienceAutomation(
  metrics: { deviceId: number; serialNumber: string; soc: number; totalOutputWatts: number },
  rawData: Record<string, unknown>,
): Promise<void> {
  const settings = getSettings()
  if (!settings.enabled || settings.deviceId !== metrics.deviceId) return
  await refreshSchedule(settings)
  cachedStatus = { ...cachedStatus, ...assess(cachedStatus.events, cachedStatus.scheduleStatus, new Date(), settings.warningLeadMinutes) }

  const extraSocs = ['bmsSlave1', 'bmsSlave2'].flatMap(prefix =>
    rawData[`${prefix}.soc`] !== undefined && (rawData[`${prefix}.fullCap`] || rawData[`${prefix}.vol`])
      ? [Number(rawData[`${prefix}.soc`])] : [],
  )
  cachedStatus.forecast = calculateRuntimeForecast({
    mainSoc: metrics.soc, extraBatterySocs: extraSocs,
    batteryCapacityWh: settings.batteryCapacityWh, reserveSoc: settings.reserveSoc,
    inverterEfficiency: settings.inverterEfficiency, loadProfile: settings.loadProfile,
    fallbackWatts: Math.max(50, metrics.totalOutputWatts),
  })
  cachedStatus.acAction = 'none'
  if (!settings.autoAc || cachedStatus.risk === 'stale') return

  const riskRequiresAc = ['imminent', 'active', 'emergency'].includes(cachedStatus.risk)
  if (riskRequiresAc) lastRiskAt = Date.now()
  const inRecoveryDelay = automationOwnsAc && Date.now() - lastRiskAt < settings.recoveryDelayMinutes * 60_000
  const shouldBeOn = riskRequiresAc || inRecoveryDelay
  const acEnabled = Number(rawData['inv.cfgAcEnabled'] ?? rawData['inv.acOutState']) === 1
  if (Date.now() - lastAcCommandAt < 60_000) return
  if (shouldBeOn && metrics.soc < settings.minSoc) {
    cachedStatus.acAction = 'blocked-low-soc'; return
  }
  if (shouldBeOn && !acEnabled) {
    await ecoflowApi.setAcOutput(metrics.serialNumber, true)
    automationOwnsAc = true; lastAcCommandAt = Date.now(); cachedStatus.acAction = 'on'
    insertLog(metrics.deviceId, 'COMMAND', 'resilienceAcOn', JSON.stringify({ risk: cachedStatus.risk }), null, true, null)
  } else if (!shouldBeOn && acEnabled && automationOwnsAc) {
    await ecoflowApi.setAcOutput(metrics.serialNumber, false)
    automationOwnsAc = false; lastAcCommandAt = Date.now(); cachedStatus.acAction = 'off'
    insertLog(metrics.deviceId, 'COMMAND', 'resilienceAcOff', JSON.stringify({ risk: cachedStatus.risk }), null, true, null)
  }
}
