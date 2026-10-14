import assert from 'node:assert/strict'
import { buildHistoricalProfile, calculateRuntimeForecast, estimateEnergyWh, loadAt, MIN_SLOT_SAMPLES } from './loadForecast.js'

// Profile times are Kyiv wall-clock time regardless of the server TZ (UTC+2 in January).
const overnight = [{ start: '23:00', end: '07:00', watts: 200, label: 'night' }]
assert.equal(loadAt(overnight, new Date('2026-01-01T00:00:00Z'), 500), 200) // 02:00 Kyiv
assert.equal(loadAt(overnight, new Date('2026-01-01T10:00:00Z'), 500), 500) // 12:00 Kyiv
assert.equal(loadAt(overnight, new Date('2026-01-01T04:59:00Z'), 500), 200) // 06:59 Kyiv
assert.equal(loadAt(overnight, new Date('2026-01-01T05:00:00Z'), 500), 500) // 07:00 Kyiv

const forecast = calculateRuntimeForecast({
  mainSoc: 50,
  extraBatterySocs: [100],
  batteryCapacityWh: 3600,
  reserveSoc: 10,
  inverterEfficiency: 0.85,
  loadProfile: [],
  fallbackWatts: 500,
  now: new Date('2026-01-01T00:00:00Z'),
})
assert.equal(forecast.batteryCount, 2)
assert.equal(forecast.nominalWh, 7200)
assert.equal(forecast.usableWh, 3978)
assert.ok(forecast.hoursRemaining !== null && forecast.hoursRemaining >= 7.9 && forecast.hoursRemaining <= 8.1)
assert.ok(forecast.depletionAt)
assert.equal(forecast.loadSource, 'current')

const protectedBattery = calculateRuntimeForecast({
  mainSoc: 10, extraBatterySocs: [], batteryCapacityWh: 3600, reserveSoc: 15,
  inverterEfficiency: 0.85, loadProfile: [], fallbackWatts: 300,
})
assert.equal(protectedBattery.usableWh, 0)
assert.equal(protectedBattery.hoursRemaining, 0)

// ---- Historical load profile

// 15-minute buckets at 10:00 and 10:15 UTC (12:00 and 12:15 Kyiv) on two days fall into slot 24.
const DAY = 86_400_000
const t0 = Date.parse('2026-01-05T10:00:00Z')
const history = buildHistoricalProfile([
  { bucketStartMs: t0, wattsSum: 300 * 90, samples: 90 },
  { bucketStartMs: t0 + 15 * 60_000, wattsSum: 500 * 90, samples: 90 },
  { bucketStartMs: t0 + DAY, wattsSum: 400 * 90, samples: 90 },
  // Too few samples for 03:00 Kyiv: the slot stays empty.
  { bucketStartMs: Date.parse('2026-01-05T01:00:00Z'), wattsSum: 900 * 10, samples: MIN_SLOT_SAMPLES - 50 },
])
assert.equal(history.slots.length, 48)
assert.equal(history.slots[24], 400)
assert.equal(history.slots[6], null)
assert.equal(history.days, 2)

// History wins over the manual profile; the profile fills the gaps.
const profile = [{ start: '12:00', end: '00:00', watts: 100 }]
const flatHistory = { slots: new Array(48).fill(null).map((_, slot) => (slot < 24 ? 1000 : null)), days: 7 }
const mixed = calculateRuntimeForecast({
  mainSoc: 100, extraBatterySocs: [], batteryCapacityWh: 3600, reserveSoc: 0, inverterEfficiency: 1,
  loadProfile: profile, history: flatHistory, fallbackWatts: 50, now: new Date('2026-01-05T22:00:00Z'), // 00:00 Kyiv
})
// 00:00–12:00 Kyiv at 1000 W burns 3600 Wh in 3.6 h, counted in whole 5-minute steps.
assert.equal(mixed.hoursRemaining, 3.7)
assert.equal(mixed.loadSource, 'history')
assert.equal(mixed.historyDays, 7)
const afternoon = calculateRuntimeForecast({
  mainSoc: 100, extraBatterySocs: [], batteryCapacityWh: 3600, reserveSoc: 0, inverterEfficiency: 1,
  loadProfile: profile, history: flatHistory, fallbackWatts: 50, now: new Date('2026-01-05T20:00:00Z'), // 22:00 Kyiv
})
// 22:00–00:00 at the profile's 100 W, then history's 1000 W.
assert.equal(afternoon.loadSource, 'mixed')
assert.equal(afternoon.hoursRemaining, 5.4)

// Window demand for 4 hours from 00:00 Kyiv on the history alone.
assert.equal(estimateEnergyWh({ history: flatHistory, loadProfile: [], fallbackWatts: 0 },
  new Date('2026-01-05T22:00:00Z'), new Date('2026-01-06T02:00:00Z')), 4000)

console.log('Resilience forecast fixtures passed')
