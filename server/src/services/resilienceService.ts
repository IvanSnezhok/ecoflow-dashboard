import { ecoflowApi } from './ecoflowApi.js'
import {
  getGridEpisodeStart,
  getGridMinutes,
  getLastGridMinute,
  getLoadBuckets,
  getOutageScheduleDays,
  getResilienceSettings,
  insertLog,
  upsertGridMinute,
  upsertOutageScheduleDay,
  type OutageScheduleDayRow,
  type ResilienceSettingsRow,
} from '../db/database.js'
import { sendSlackRichMessage } from './slackService.js'
import {
  decideAcAction,
  detectAlerts,
  initialAlertState,
  type AcAction,
  type AlertState,
  type FinishedOutage,
} from './resilienceDecisions.js'
import {
  buildHistoricalProfile,
  calculateRuntimeForecast,
  emptyHistoricalProfile,
  estimateEnergyWh,
  PROFILE_SLOT_MINUTES,
  type HistoricalProfile,
  type LoadModel,
} from './loadForecast.js'
import { buildPowerDay, detectGridPresence, GridTracker, type GridObserveResult, type ScheduleWindow } from './powerTimeline.js'
import { addDays, kyivDateAtMinutes, kyivDateKey, kyivWeekday } from '../lib/kyivTime.js'
import type {
  GridStatus,
  LoadPeriod,
  OutageEvent,
  PowerDay,
  ResilienceSettings,
  ResilienceStatus,
  ScheduleSource,
} from '../types/resilience.js'

// Kept for callers that imported the forecast from here before it moved.
export { calculateRuntimeForecast, loadAt } from './loadForecast.js'

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
    notifySlack: (row?.notify_slack ?? 1) === 1,
    regionId: row?.region_id ?? undefined,
    dsoId: row?.dso_id ?? undefined,
    outageGroup: row?.outage_group ?? undefined,
    warningLeadMinutes: row?.warning_lead_minutes ?? 60,
    recoveryDelayMinutes: row?.recovery_delay_minutes ?? 15,
    minSoc: row?.min_soc ?? 25,
    reserveSoc: row?.reserve_soc ?? 15,
    batteryCapacityWh: row?.battery_capacity_wh ?? 3600,
    inverterEfficiency: row?.inverter_efficiency ?? 0.85,
    acOffMaxWatts: row?.ac_off_max_watts ?? 50,
    loadProfile,
    updatedAt: row?.updated_at,
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

interface ScheduleDay {
  day: string
  source: ScheduleSource
  status?: string
  slots: Array<{ start: number; end: number }>
}

function outageSlots(rawSlots: unknown): Array<{ start: number; end: number }> {
  if (!Array.isArray(rawSlots)) return []
  return rawSlots.flatMap(slot => isObject(slot) && typeof slot.start === 'number' && typeof slot.end === 'number' && slot.type !== 'NotPlanned'
    ? [{ start: slot.start, end: slot.end }] : [])
}

function parsePlanned(payload: unknown, group: string): { events: OutageEvent[]; days: ScheduleDay[]; status?: string; updatedAt?: string } {
  if (!isObject(payload) || !isObject(payload[group])) return { events: [], days: [] }
  const groupData = payload[group] as JsonObject
  const events: OutageEvent[] = []
  const days: ScheduleDay[] = []
  let status: string | undefined
  for (const key of ['today', 'tomorrow']) {
    const day = groupData[key]
    if (!isObject(day)) continue
    const dayStatus = typeof day.status === 'string' ? day.status : undefined
    if (key === 'today') status = dayStatus
    const slots = outageSlots(day.slots)
    for (const slot of slots) {
      const event = eventFromSlot(slot, day.date, 'planned')
      if (event) events.push(event)
    }
    // "WaitingForSchedule" and friends say nothing about the day yet; keep the probable schedule for it.
    const known = dayStatus === 'ScheduleApplies' || dayStatus === 'EmergencyShutdowns' || slots.length > 0
    if (known && typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(day.date)) {
      days.push({ day: day.date.slice(0, 10), source: 'planned', status: dayStatus, slots })
    }
  }
  return { events, days, status, updatedAt: typeof groupData.updatedOn === 'string' ? groupData.updatedOn : undefined }
}

function parseProbable(payload: unknown, region: number, dso: number, group: string, now: Date): { events: OutageEvent[]; days: ScheduleDay[] } {
  if (!isObject(payload)) return { events: [], days: [] }
  const regionData = payload[String(region)]
  const dsoData = isObject(regionData) && isObject(regionData.dsos) ? regionData.dsos[String(dso)] : undefined
  const groupData = isObject(dsoData) && isObject(dsoData.groups) ? dsoData.groups[group] : undefined
  if (!isObject(groupData) || !isObject(groupData.slots)) return { events: [], days: [] }
  const events: OutageEvent[] = []
  const days: ScheduleDay[] = []
  // Weekly slots are keyed by Monday-based weekday of the Kyiv calendar date.
  const today = kyivDateKey(now)
  const todayWeekday = kyivWeekday(now)
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const day = addDays(today, dayOffset)
    const rawSlots = groupData.slots[String((todayWeekday + dayOffset) % 7)]
    if (!Array.isArray(rawSlots)) continue
    const slots = outageSlots(rawSlots)
    for (const slot of slots) {
      const event = eventFromSlot(slot, day, 'probable')
      if (event) events.push(event)
    }
    days.push({ day, source: 'probable', slots })
  }
  return { events, days }
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
let lowLoadSince: number | null = null
let alertState: AlertState = initialAlertState
let gridTracker = new GridTracker()
let gridDeviceId: number | undefined
let historyCache: { deviceId: number; at: number; profile: HistoricalProfile } | undefined
const HISTORY_DAYS = 14
const HISTORY_TTL_MS = 30 * 60_000

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

function isScheduleStale(): boolean {
  return !cachedStatus.checkedAt || Date.now() - +new Date(cachedStatus.checkedAt) > MAX_STALE_MS
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
    const events = [...planned.events, ...probable.events].sort((a, b) => +new Date(a.start) - +new Date(b.start))
    persistScheduleDays(settings.outageGroup, [...planned.days, ...probable.days])
    cachedStatus = {
      ...cachedStatus, ...assess(events, planned.status, new Date(), settings.warningLeadMinutes),
      events, scheduleStatus: planned.status, scheduleUpdatedAt: planned.updatedAt,
      checkedAt: new Date().toISOString(), error: undefined,
    }
    lastScheduleFetch = Date.now()
    lastScheduleKey = scheduleKey
  } catch (error) {
    cachedStatus = { ...cachedStatus, risk: isScheduleStale() ? 'stale' : cachedStatus.risk, error: error instanceof Error ? error.message : String(error) }
  }
}

function persistScheduleDays(group: string, days: ScheduleDay[]): void {
  try {
    for (const day of days) {
      upsertOutageScheduleDay({ day: day.day, source: day.source, outage_group: group, status: day.status ?? null, slots: JSON.stringify(day.slots) })
    }
  } catch (error) {
    console.error('[Resilience] Failed to store outage schedule:', error)
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

function historicalProfile(deviceId: number, nowMs: number): HistoricalProfile {
  if (historyCache?.deviceId === deviceId && nowMs - historyCache.at < HISTORY_TTL_MS) return historyCache.profile
  let profile = emptyHistoricalProfile
  try {
    profile = buildHistoricalProfile(getLoadBuckets(deviceId, new Date(nowMs - HISTORY_DAYS * 86_400_000).toISOString()))
  } catch (error) {
    console.error('[Resilience] Failed to read load history:', error)
  }
  historyCache = { deviceId, at: nowMs, profile }
  return profile
}

/** Picks up an outage (or a powered stretch) that was in progress before a restart. */
function restoreGridTracker(deviceId: number, nowMs: number): void {
  try {
    const last = getLastGridMinute(deviceId)
    const nowMinute = Math.floor(nowMs / 60_000)
    if (!last || nowMinute - last.minute > 5) return
    const episode = getGridEpisodeStart(deviceId, last.grid_on, last.minute, HISTORY_DAYS * 1440)
    gridTracker.restore(last.grid_on ? 'on' : 'off', episode.startMinute * 60_000, episode.loadWh, episode.ecoflowSeconds,
      last.minute === nowMinute
        ? { minute: last.minute, gridOn: last.grid_on === 1, loadWh: last.load_wh, ecoflowSeconds: last.ecoflow_seconds }
        : undefined)
  } catch (error) {
    console.error('[Resilience] Failed to restore grid state:', error)
  }
}

function observeGrid(deviceId: number, rawData: Record<string, unknown>, fallbackOutputWatts: number, nowMs: number): GridObserveResult {
  if (gridDeviceId !== deviceId) {
    gridTracker = new GridTracker()
    gridDeviceId = deviceId
    restoreGridTracker(deviceId, nowMs)
  }
  // pd.wattsOutSum covers every port (AC, DC, USB); the metrics sum is the fallback.
  const outSum = Number(rawData['pd.wattsOutSum'])
  const result = gridTracker.observe({
    nowMs, present: detectGridPresence(rawData),
    outputWatts: Number.isFinite(outSum) && rawData['pd.wattsOutSum'] !== undefined ? outSum : fallbackOutputWatts,
  })
  if (result.minute) {
    try {
      upsertGridMinute(deviceId, {
        minute: result.minute.minute, grid_on: result.minute.gridOn ? 1 : 0,
        load_wh: result.minute.loadWh, ecoflow_seconds: result.minute.ecoflowSeconds,
      })
    } catch (error) {
      console.error('[Resilience] Failed to store grid minute:', error)
    }
  }
  return result
}

function finishedOutage(result: GridObserveResult): FinishedOutage | undefined {
  const episode = result.finished
  if (!result.changed || episode?.state !== 'off') return undefined
  return {
    minutes: Math.round((episode.endMs - episode.startMs) / 60_000),
    ecoflowMinutes: Math.round(episode.ecoflowSeconds / 60),
    wh: episode.loadWh,
  }
}

function currentGridStatus(): GridStatus {
  const state = gridTracker.state
  const scheduledOutage = Boolean(cachedStatus.currentEvent) || cachedStatus.risk === 'emergency'
  return {
    state,
    since: gridTracker.sinceMs ? new Date(gridTracker.sinceMs).toISOString() : undefined,
    unplanned: state === 'off' && !scheduledOutage,
    ...(state === 'off' ? {
      outageWh: Math.round(gridTracker.episodeWh),
      outageEcoflowMinutes: Math.round(gridTracker.episodeEcoflowSeconds / 60),
    } : {}),
  }
}

/** Expected consumption for the rest of the current window, or the whole next one. */
function windowDemand(model: LoadModel, now: Date): number | undefined {
  const window = cachedStatus.currentEvent ?? cachedStatus.nextEvent
  if (!window) return undefined
  const start = new Date(Math.max(now.getTime(), +new Date(window.start)))
  return estimateEnergyWh(model, start, new Date(window.end))
}

export async function processResilienceAutomation(
  metrics: { deviceId: number; serialNumber: string; soc: number; totalOutputWatts: number },
  rawData: Record<string, unknown>,
): Promise<void> {
  const settings = getSettings()
  if (settings.deviceId !== metrics.deviceId) return
  const now = new Date()
  // Grid presence is recorded whenever a device is selected, so the timeline has data
  // even while the automation itself is switched off.
  const grid = observeGrid(metrics.deviceId, rawData, metrics.totalOutputWatts, now.getTime())
  if (!settings.enabled) return
  await refreshSchedule(settings)
  cachedStatus = { ...cachedStatus, ...assess(cachedStatus.events, cachedStatus.scheduleStatus, now, settings.warningLeadMinutes) }
  // assess() never yields 'stale', so re-apply it here or AC automation would keep acting on old data.
  if (isScheduleStale()) cachedStatus.risk = 'stale'
  cachedStatus.grid = currentGridStatus()

  const extraSocs = ['bmsSlave1', 'bmsSlave2'].flatMap(prefix =>
    rawData[`${prefix}.soc`] !== undefined && (rawData[`${prefix}.fullCap`] || rawData[`${prefix}.vol`])
      ? [Number(rawData[`${prefix}.soc`])] : [],
  )
  const history = historicalProfile(metrics.deviceId, now.getTime())
  const model: LoadModel = { history, loadProfile: settings.loadProfile, fallbackWatts: Math.max(50, metrics.totalOutputWatts) }
  cachedStatus.forecast = {
    ...calculateRuntimeForecast({
      ...model, mainSoc: metrics.soc, extraBatterySocs: extraSocs, now,
      batteryCapacityWh: settings.batteryCapacityWh, reserveSoc: settings.reserveSoc,
      inverterEfficiency: settings.inverterEfficiency,
    }),
    windowDemandWh: windowDemand(model, now),
  }
  cachedStatus.loadHistory = { slotMinutes: PROFILE_SLOT_MINUTES, slots: history.slots, days: history.days }
  const acOutputWatts = Number(rawData['inv.outputWatts'] ?? 0) || 0
  cachedStatus.acAction = await runAcAutomation(settings, metrics, rawData, acOutputWatts)
  if (settings.notifySlack) await sendAlerts(metrics.soc, settings, acOutputWatts, finishedOutage(grid))
}

async function runAcAutomation(
  settings: ResilienceSettings,
  metrics: { deviceId: number; serialNumber: string; soc: number },
  rawData: Record<string, unknown>,
  acOutputWatts: number,
): Promise<AcAction> {
  const gridOff = cachedStatus.grid?.state === 'off'
  const decision = decideAcAction({
    autoAc: settings.autoAc, risk: cachedStatus.risk, gridOff, soc: metrics.soc, minSoc: settings.minSoc,
    acEnabled: Number(rawData['inv.cfgAcEnabled'] ?? rawData['inv.acOutState']) === 1,
    acOutputWatts, acOffMaxWatts: settings.acOffMaxWatts,
    automationOwnsAc, recoveryDelayMinutes: settings.recoveryDelayMinutes,
    lastRiskAt, lowLoadSince, lastAcCommandAt, nowMs: Date.now(),
  })
  lastRiskAt = decision.lastRiskAt
  lowLoadSince = decision.lowLoadSince
  if (decision.action !== 'on' && decision.action !== 'off') return decision.action

  const enable = decision.action === 'on'
  const command = enable ? 'resilienceAcOn' : 'resilienceAcOff'
  const reason = JSON.stringify({ risk: cachedStatus.risk, grid: cachedStatus.grid?.state, acOutputWatts })
  lastAcCommandAt = Date.now()
  try {
    await ecoflowApi.setAcOutput(metrics.serialNumber, enable)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    insertLog(metrics.deviceId, 'COMMAND', command, reason, null, false, message)
    return 'failed'
  }
  automationOwnsAc = enable
  insertLog(metrics.deviceId, 'COMMAND', command, reason, null, true, null)
  return decision.action
}

async function sendAlerts(soc: number, settings: ResilienceSettings, acOutputWatts: number, outage?: FinishedOutage): Promise<void> {
  const { alerts, state } = detectAlerts(alertState, {
    risk: cachedStatus.risk, currentEvent: cachedStatus.currentEvent, nextEvent: cachedStatus.nextEvent,
    forecast: cachedStatus.forecast, acAction: cachedStatus.acAction ?? 'none', soc, minSoc: settings.minSoc,
    grid: cachedStatus.grid, finishedOutage: outage, acOutputWatts, acOffMaxWatts: settings.acOffMaxWatts,
  })
  alertState = state
  for (const alert of alerts) {
    try {
      await sendSlackRichMessage({ title: alert.title, message: alert.message, color: alert.color })
    } catch (error) {
      console.error(`[Resilience] Failed to send ${alert.kind} alert:`, error)
    }
  }
}

function scheduleWindows(day: string, rows: OutageScheduleDayRow[]): { source: ScheduleSource | null; windows: ScheduleWindow[] } {
  const row = rows.find(r => r.day === day && r.source === 'planned') ?? rows.find(r => r.day === day && r.source === 'probable')
  if (!row) return { source: null, windows: [] }
  let slots: Array<{ start: number; end: number }> = []
  try { slots = JSON.parse(row.slots) as Array<{ start: number; end: number }> } catch { /* treat as empty */ }
  const windows = slots.flatMap(slot => {
    const start = kyivDateAtMinutes(day, slot.start)
    const end = kyivDateAtMinutes(day, slot.end)
    return start && end ? [{ startMs: start.getTime(), endMs: end.getTime() }] : []
  })
  return { source: row.source as ScheduleSource, windows }
}

/**
 * Light / no-light timeline for the last `days` Kyiv days (today first), plus
 * tomorrow when its schedule is already known.
 */
export function getPowerTimeline(days: number, now = new Date()): PowerDay[] {
  const settings = getSettings()
  if (!settings.deviceId) return []
  const today = kyivDateKey(now)
  const firstDay = addDays(today, -(days - 1))
  const tomorrow = addDays(today, 1)
  const schedule = settings.outageGroup ? getOutageScheduleDays(settings.outageGroup, firstDay, tomorrow) : []
  const rangeStart = kyivDateAtMinutes(firstDay, 0)
  if (!rangeStart) return []
  const minutes = getGridMinutes(settings.deviceId, Math.floor(rangeStart.getTime() / 60_000), Math.ceil(now.getTime() / 60_000) + 1)
    .map(row => ({ minute: row.minute, gridOn: row.grid_on === 1, loadWh: row.load_wh, ecoflowSeconds: row.ecoflow_seconds }))

  const result: PowerDay[] = []
  for (let offset = 1; offset > -days; offset -= 1) {
    const day = addDays(today, offset)
    const start = kyivDateAtMinutes(day, 0)
    const end = kyivDateAtMinutes(day, 1440)
    if (!start || !end) continue
    const { source, windows } = scheduleWindows(day, schedule)
    if (day === tomorrow && !source) continue
    const startMinute = start.getTime() / 60_000
    const endMinute = end.getTime() / 60_000
    result.push(buildPowerDay({
      day, dayStartMs: start.getTime(), dayEndMs: end.getTime(), nowMs: now.getTime(),
      minutes: minutes.filter(sample => sample.minute >= startMinute && sample.minute < endMinute),
      scheduledOff: windows, scheduleSource: source,
    }))
  }
  return result
}
