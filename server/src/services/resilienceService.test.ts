import assert from 'node:assert/strict'
import { calculateRuntimeForecast, loadAt } from './resilienceService.js'

const overnight = [{ start: '23:00', end: '07:00', watts: 200, label: 'night' }]
assert.equal(loadAt(overnight, new Date(2026, 0, 1, 1, 0), 500), 200)
assert.equal(loadAt(overnight, new Date(2026, 0, 1, 12, 0), 500), 500)

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

const protectedBattery = calculateRuntimeForecast({
  mainSoc: 10, extraBatterySocs: [], batteryCapacityWh: 3600, reserveSoc: 15,
  inverterEfficiency: 0.85, loadProfile: [], fallbackWatts: 300,
})
assert.equal(protectedBattery.usableWh, 0)
assert.equal(protectedBattery.hoursRemaining, 0)

console.log('Resilience forecast fixtures passed')
