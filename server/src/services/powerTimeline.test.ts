import assert from 'node:assert/strict'
import { buildPowerDay, detectGridPresence, GridTracker, type MinuteSample } from './powerTimeline.js'
import { kyivDateAtMinutes } from '../lib/kyivTime.js'

// ---- Grid detection

assert.equal(detectGridPresence({ 'inv.acInVol': 223212 }), true)
assert.equal(detectGridPresence({ 'inv.acInVol': 0, 'inv.inputWatts': 0 }), false)
assert.equal(detectGridPresence({ 'inv.acInVol': 230 }), true) // volts on some models
assert.equal(detectGridPresence({ 'inv.acInFreq': 50 }), true)
assert.equal(detectGridPresence({ 'inv.inputWatts': 600 }), true)
// Zero input watts alone cannot tell a full battery from a blackout.
assert.equal(detectGridPresence({ 'inv.inputWatts': 0 }), null)
assert.equal(detectGridPresence({}), null)

// ---- Tracker

const T = Date.parse('2026-10-14T09:00:00Z')
const S = 10_000
const tracker = new GridTracker()
assert.equal(tracker.observe({ nowMs: T, present: true, outputWatts: 0 }).minute?.gridOn, true)
assert.equal(tracker.state, 'on')
// A single dropout is not an outage.
assert.equal(tracker.observe({ nowMs: T + S, present: false, outputWatts: 0 }).changed, false)
assert.equal(tracker.observe({ nowMs: T + 2 * S, present: true, outputWatts: 0 }).changed, false)
// Two in a row is; the outage starts at the first one.
tracker.observe({ nowMs: T + 3 * S, present: false, outputWatts: 360 })
const lost = tracker.observe({ nowMs: T + 4 * S, present: false, outputWatts: 360 })
assert.equal(lost.changed, true)
assert.equal(lost.previous, 'on')
assert.equal(lost.finished?.state, 'on')
assert.equal(tracker.sinceMs, T + 3 * S)
assert.equal(lost.minute?.gridOn, false)
// 360 W for 10 s is 1 Wh, and counts as EcoFlow time once the grid is off.
assert.equal(Math.round(lost.minute!.loadWh * 10) / 10, 2)
assert.equal(lost.minute?.ecoflowSeconds, 10)
// Unknown readings neither change the state nor write a minute.
assert.equal(tracker.observe({ nowMs: T + 5 * S, present: null, outputWatts: 360 }).minute, undefined)
for (let i = 6; i < 6 + 360; i += 1) tracker.observe({ nowMs: T + i * S, present: false, outputWatts: 360 })
tracker.observe({ nowMs: T + 366 * S, present: true, outputWatts: 20 })
const back = tracker.observe({ nowMs: T + 367 * S, present: true, outputWatts: 20 })
assert.equal(back.changed, true)
assert.equal(back.finished?.state, 'off')
assert.equal(back.finished?.startMs, T + 3 * S)
assert.equal(back.finished?.endMs, T + 366 * S)
// ~1 h at 360 W, the reading right after the null gap included.
assert.ok(back.finished!.loadWh >= 355 && back.finished!.loadWh <= 365, String(back.finished!.loadWh))
assert.ok(back.finished!.ecoflowSeconds >= 3590 && back.finished!.ecoflowSeconds <= 3640)
// Long gaps (server down) are not integrated.
const gap = new GridTracker()
gap.observe({ nowMs: T, present: false, outputWatts: 500 })
assert.equal(gap.observe({ nowMs: T + 10 * 60_000, present: false, outputWatts: 500 }).minute?.loadWh, 0)

// ---- Day timeline

const day = '2026-10-14' // UTC+3
const dayStart = kyivDateAtMinutes(day, 0)!.getTime()
const dayEnd = kyivDateAtMinutes(day, 1440)!.getTime()
assert.equal(dayStart, Date.parse('2026-10-13T21:00:00Z'))
const minuteAt = (kyivMinute: number) => dayStart / 60_000 + kyivMinute
const samples: MinuteSample[] = []
// 00:00–08:00 on, 08:00–10:00 off (EcoFlow 60 W), 10:00–12:00 on, then no data until "now" at 13:00.
for (let m = 0; m < 720; m += 1) {
  const off = m >= 480 && m < 600
  samples.push({ minute: minuteAt(m), gridOn: !off, loadWh: off ? 1 : 0.5, ecoflowSeconds: off ? 60 : 0 })
}
const scheduled = [
  { startMs: kyivDateAtMinutes(day, 540)!.getTime(), endMs: kyivDateAtMinutes(day, 720)!.getTime() }, // 09:00–12:00
  { startMs: kyivDateAtMinutes(day, 1200)!.getTime(), endMs: kyivDateAtMinutes(day, 1440)!.getTime() }, // 20:00–24:00
]
const result = buildPowerDay({
  day, dayStartMs: dayStart, dayEndMs: dayEnd, nowMs: kyivDateAtMinutes(day, 780)!.getTime(),
  minutes: samples, scheduledOff: scheduled, scheduleSource: 'planned',
})
assert.deepEqual(result.segments.map(segment => segment.state), ['on', 'off', 'on', 'unknown'])
assert.equal(result.segments[1].start, new Date(kyivDateAtMinutes(day, 480)!).toISOString())
assert.equal(result.segments[3].end, new Date(kyivDateAtMinutes(day, 780)!).toISOString())
assert.deepEqual(result.stats, {
  onMinutes: 600, offMinutes: 120, unknownMinutes: 60,
  scheduledOffMinutes: 420, // whole day: 3 h + 4 h
  extraOnMinutes: 120, // 10:00–12:00 on despite the schedule
  unplannedOffMinutes: 60, // 08:00–09:00 off before the window
  ecoflowMinutes: 120, ecoflowWh: 120,
})
assert.equal(result.future, false)
assert.equal(result.scheduledOff.length, 2)

// Tomorrow: schedule only.
const tomorrow = buildPowerDay({
  day: '2026-10-15', dayStartMs: dayEnd, dayEndMs: dayEnd + 86_400_000, nowMs: dayStart + 3_600_000,
  minutes: [], scheduledOff: [{ startMs: dayEnd + 3_600_000, endMs: dayEnd + 4 * 3_600_000 }], scheduleSource: 'probable',
})
assert.equal(tomorrow.future, true)
assert.deepEqual(tomorrow.segments, [])
assert.equal(tomorrow.stats.scheduledOffMinutes, 180)

console.log('Power timeline fixtures passed')
