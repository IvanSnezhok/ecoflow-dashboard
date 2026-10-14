import assert from 'node:assert/strict'
import {
  decideAcAction, detectAlerts, initialAlertState, LOW_LOAD_CONFIRM_MS,
  type AcDecisionInput, type AlertInput, type AlertState,
} from './resilienceDecisions.js'
import type { OutageEvent } from '../types/resilience.js'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const MIN = 60_000

// Defaults: grid present, no load on the AC sockets for a while already.
const base: AcDecisionInput = {
  autoAc: true, risk: 'none', gridOff: false, soc: 80, minSoc: 25, acEnabled: false,
  acOutputWatts: 0, acOffMaxWatts: 50, automationOwnsAc: false,
  recoveryDelayMinutes: 15, lastRiskAt: 0, lowLoadSince: NOW - 10 * 60_000, lastAcCommandAt: 0, nowMs: NOW,
}
const decide = (patch: Partial<AcDecisionInput>) => decideAcAction({ ...base, ...patch })
const brief = (patch: Partial<AcDecisionInput>) => {
  const { action, lastRiskAt } = decide(patch)
  return { action, lastRiskAt }
}

// ---- AC decisions

// Disabled or stale: never act, and do not move the recovery clock.
assert.deepEqual(brief({ autoAc: false, risk: 'active' }), { action: 'none', lastRiskAt: 0 })
assert.deepEqual(brief({ risk: 'stale', acEnabled: true, automationOwnsAc: true }), { action: 'none', lastRiskAt: 0 })

// Every risk that needs AC turns it on and stamps lastRiskAt.
for (const risk of ['imminent', 'active', 'emergency'] as const) {
  assert.deepEqual(brief({ risk }), { action: 'on', lastRiskAt: NOW }, risk)
}
// 'watch' alone is not enough.
assert.equal(decide({ risk: 'watch' }).action, 'none')
// Already on: nothing to do.
assert.equal(decide({ risk: 'active', acEnabled: true }).action, 'none')

// Low SOC blocks turning on, and is reported even when AC is already on.
assert.equal(decide({ risk: 'active', soc: 20 }).action, 'blocked-low-soc')
assert.equal(decide({ risk: 'active', soc: 20, acEnabled: true }).action, 'blocked-low-soc')
assert.equal(decide({ risk: 'active', soc: 25 }).action, 'on')

// Cooldown: a command less than a minute ago suppresses another one.
assert.equal(decide({ risk: 'active', lastAcCommandAt: NOW - 30_000 }).action, 'none')
assert.equal(decide({ risk: 'active', lastAcCommandAt: NOW - 61_000 }).action, 'on')
// ...but the recovery clock still advances during the cooldown.
assert.equal(decide({ risk: 'active', lastAcCommandAt: NOW - 30_000 }).lastRiskAt, NOW)

// Recovery delay keeps automation-owned AC on, then turns it off.
const owned = { risk: 'none' as const, acEnabled: true, automationOwnsAc: true }
assert.equal(decide({ ...owned, lastRiskAt: NOW - 10 * MIN }).action, 'none')
assert.equal(decide({ ...owned, lastRiskAt: NOW - 16 * MIN }).action, 'off')
assert.equal(decide({ ...owned, lastRiskAt: NOW - 1 * MIN, recoveryDelayMinutes: 0 }).action, 'off')
// AC that someone else turned on is never turned off.
assert.equal(decide({ ...owned, automationOwnsAc: false, lastRiskAt: NOW - 60 * MIN }).action, 'none')

// Load on the sockets: AC stays on until it drops below the threshold and stays there.
const recovered = { ...owned, lastRiskAt: NOW - 60 * MIN }
assert.deepEqual(decide({ ...recovered, acOutputWatts: 120, lowLoadSince: null }),
  { action: 'waiting-load', lastRiskAt: NOW - 60 * MIN, lowLoadSince: null })
assert.equal(decide({ ...recovered, acOutputWatts: 50, lowLoadSince: null }).action, 'waiting-load')
// Load just dropped: the clock starts, AC still waits for the confirmation period.
assert.deepEqual(decide({ ...recovered, acOutputWatts: 30, lowLoadSince: null }),
  { action: 'waiting-load', lastRiskAt: NOW - 60 * MIN, lowLoadSince: NOW })
assert.equal(decide({ ...recovered, acOutputWatts: 30, lowLoadSince: NOW - LOW_LOAD_CONFIRM_MS + 1000 }).action, 'waiting-load')
assert.equal(decide({ ...recovered, acOutputWatts: 30, lowLoadSince: NOW - LOW_LOAD_CONFIRM_MS }).action, 'off')
// A load spike resets the low-load clock.
assert.equal(decide({ ...recovered, acOutputWatts: 400, lowLoadSince: NOW - 30 * MIN }).lowLoadSince, null)
// Threshold is configurable.
assert.equal(decide({ ...recovered, acOutputWatts: 80, acOffMaxWatts: 100 }).action, 'off')

// The device losing grid turns AC on even when the schedule shows no risk...
assert.deepEqual(brief({ gridOff: true }), { action: 'on', lastRiskAt: NOW })
// ...and even when the schedule is stale.
assert.equal(decide({ gridOff: true, risk: 'stale' }).action, 'on')
// It keeps AC on and restarts the recovery clock while the grid is still off.
assert.equal(decide({ ...owned, gridOff: true, lastRiskAt: NOW - 60 * MIN }).action, 'none')
// Low SOC still wins.
assert.equal(decide({ gridOff: true, soc: 10 }).action, 'blocked-low-soc')

// ---- Alerts

const event = (startIso: string, endIso: string, type: OutageEvent['type'] = 'definite'): OutageEvent =>
  ({ start: startIso, end: endIso, type, source: type === 'definite' ? 'planned' : 'probable' })
const outage = event('2026-10-06T13:00:00Z', '2026-10-06T17:00:00Z')
const longForecast = {
  batteryCount: 1, nominalWh: 3600, usableWh: 2000, averageLoadWatts: 300, hoursRemaining: 18,
  depletionAt: '2026-10-07T06:00:00Z', loadSource: 'history' as const, historyDays: 14,
}
const shortForecast = { ...longForecast, hoursRemaining: 2, depletionAt: '2026-10-06T15:00:00Z' }

const alertBase: AlertInput = { risk: 'none', acAction: 'none', soc: 80, minSoc: 25, forecast: longForecast }

function run(steps: Array<Partial<AlertInput>>, start: AlertState = initialAlertState): string[][] {
  let state = start
  return steps.map(step => {
    const result = detectAlerts(state, { ...alertBase, ...step })
    state = result.state
    return result.alerts.map(alert => alert.kind)
  })
}

// First observation only records state: a restart mid-outage stays quiet.
assert.deepEqual(run([{ risk: 'active', currentEvent: outage }]), [[]])

// A normal outage day, step by step.
assert.deepEqual(run([
  { risk: 'none' },
  { risk: 'watch', nextEvent: outage },
  { risk: 'imminent', nextEvent: outage, acAction: 'on' },
  { risk: 'imminent', nextEvent: outage },
  { risk: 'active', currentEvent: outage },
  { risk: 'active', currentEvent: outage },
  { risk: 'none' },
  { risk: 'none', acAction: 'off' },
]), [[], [], ['outage-warning', 'ac-on'], [], ['outage-started'], [], ['outage-ended'], ['ac-off']])

// Warning fires once per window, again for the next window.
const later = event('2026-10-06T20:00:00Z', '2026-10-06T22:00:00Z')
assert.deepEqual(run([
  { risk: 'none' },
  { risk: 'imminent', nextEvent: outage },
  { risk: 'none' },
  { risk: 'imminent', nextEvent: outage },
  { risk: 'imminent', nextEvent: later },
]), [[], ['outage-warning'], [], [], ['outage-warning']])

// Emergency announces once; dropping to an active window after it stays quiet.
assert.deepEqual(run([
  { risk: 'none' },
  { risk: 'emergency' },
  { risk: 'active', currentEvent: outage },
  { risk: 'none' },
]), [[], ['emergency'], [], ['outage-ended']])

// Stale schedule and recovery.
assert.deepEqual(run([{ risk: 'none' }, { risk: 'stale' }, { risk: 'stale' }, { risk: 'none' }]),
  [[], ['schedule-stale'], [], ['schedule-restored']])

// Low-SOC block is announced once per risk episode.
assert.deepEqual(run([
  { risk: 'none' },
  { risk: 'active', currentEvent: outage, acAction: 'blocked-low-soc', soc: 20 },
  { risk: 'active', currentEvent: outage, acAction: 'blocked-low-soc', soc: 19 },
  { risk: 'none' },
  { risk: 'imminent', nextEvent: later, acAction: 'blocked-low-soc', soc: 18 },
]), [[], ['outage-started', 'ac-blocked-low-soc'], [], ['outage-ended'], ['outage-warning', 'ac-blocked-low-soc']])

// Low reserve: forecast runs out before the window ends, once per window.
assert.deepEqual(run([
  { risk: 'none' },
  { risk: 'imminent', nextEvent: outage, forecast: shortForecast },
  { risk: 'active', currentEvent: outage, forecast: shortForecast },
]), [[], ['outage-warning', 'low-reserve'], ['outage-started']])
// Enough reserve: no low-reserve alert.
assert.deepEqual(run([{ risk: 'none' }, { risk: 'active', currentEvent: outage }]), [[], ['outage-started']])

// Failed AC command is reported.
assert.deepEqual(run([{ risk: 'none' }, { risk: 'imminent', nextEvent: outage, acAction: 'failed' }]),
  [[], ['outage-warning', 'ac-failed']])

// Message text carries Kyiv local times.
const warning = detectAlerts({ ...initialAlertState, risk: 'none' }, { ...alertBase, risk: 'imminent', nextEvent: outage })
assert.match(warning.alerts[0].message, /16:00–20:00/)

// Grid loss and return reported by the device.
assert.deepEqual(run([
  { grid: { state: 'on', unplanned: false } },
  { grid: { state: 'off', unplanned: true } },
  { grid: { state: 'off', unplanned: true } },
  { grid: { state: 'unknown', unplanned: false } },
  { grid: { state: 'on', unplanned: false }, finishedOutage: { minutes: 125, ecoflowMinutes: 120, wh: 830 } },
]), [[], ['grid-lost'], [], [], ['grid-restored']])
const unplanned = detectAlerts({ ...initialAlertState, risk: 'none', grid: 'on' }, { ...alertBase, grid: { state: 'off', unplanned: true } })
assert.equal(unplanned.alerts[0].title, 'Позапланове відключення світла')
const scheduled = detectAlerts({ ...initialAlertState, risk: 'active', grid: 'on' }, { ...alertBase, risk: 'active', currentEvent: outage, grid: { state: 'off', unplanned: false } })
assert.equal(scheduled.alerts[0].title, 'Світло зникло')
const restored = detectAlerts({ ...initialAlertState, risk: 'none', grid: 'off' },
  { ...alertBase, grid: { state: 'on', unplanned: false }, finishedOutage: { minutes: 125, ecoflowMinutes: 120, wh: 830 } })
assert.match(restored.alerts[0].message, /2 год 5 хв/)
assert.match(restored.alerts[0].message, /0\.83 кВт·год/)
// A restart during an outage records the grid state silently.
assert.deepEqual(run([{ grid: { state: 'off', unplanned: true } }]), [[]])

// Deferred switch-off is announced once, and only for real load.
assert.deepEqual(run([
  { risk: 'none' },
  { acAction: 'waiting-load', acOutputWatts: 20, acOffMaxWatts: 50 },
  { acAction: 'waiting-load', acOutputWatts: 300, acOffMaxWatts: 50 },
  { acAction: 'waiting-load', acOutputWatts: 280, acOffMaxWatts: 50 },
  { acAction: 'off' },
]), [[], [], ['ac-off-deferred'], [], ['ac-off']])

console.log('Resilience decision fixtures passed')
