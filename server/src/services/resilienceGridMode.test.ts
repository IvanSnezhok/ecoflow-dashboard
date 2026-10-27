import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Configuration is read at import time
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecoflow-resilience-grid-'))
process.env.ECOFLOW_DB_PATH = path.join(dir, 'test.db')
process.env.ECOFLOW_ACCESS_KEY ??= 'test-access'
process.env.ECOFLOW_SECRET_KEY ??= 'test-secret'
delete process.env.ECOFLOW_BLE_BRIDGE_URL

const SN = 'DCABZ5ZE7654321'
const MIN = 60_000

const acCommands: number[] = []
const yasnoRequests: string[] = []
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input))
  if (url.hostname === 'app.yasno.ua') {
    yasnoRequests.push(url.pathname)
    throw new Error('the grid-only mode must not ask YASNO')
  }
  if (url.pathname === '/iot-open/sign/device/quota' && init?.method === 'PUT') {
    acCommands.push((JSON.parse(String(init.body)) as { params: { enabled: number } }).params.enabled)
    return json({ code: '0', message: 'ok', data: null })
  }
  throw new Error(`unexpected request ${url}`)
}) as typeof fetch

const { initDatabase, db, upsertOutageScheduleDay, upsertResilienceSettings } = await import('../db/database.js')
const { kyivDateKey } = await import('../lib/kyivTime.js')
initDatabase()
db.prepare("INSERT INTO devices (serial_number, device_type, name) VALUES (?, 'DELTA Pro', 'Delta')").run(SN)
const deviceId = (db.prepare('SELECT id FROM devices WHERE serial_number = ?').get(SN) as { id: number }).id
const settings = {
  device_id: deviceId, enabled: 1, mode: 'grid', auto_ac: 1, notify_slack: 0, region_id: null, dso_id: null, outage_group: null,
  warning_lead_minutes: 60, recovery_delay_minutes: 0, min_soc: 25, reserve_soc: 15,
  battery_capacity_wh: 3600, inverter_efficiency: 0.85, load_profile: '[]', ac_off_max_watts: 50,
}
upsertResilienceSettings(settings)

const service = await import('./resilienceService.js')
const metrics = { deviceId, serialNumber: SN, soc: 90, totalOutputWatts: 0 }
const quota = (acOn: boolean, gridOn: boolean) =>
  ({ 'bmsMaster.soc': 90, 'inv.cfgAcEnabled': acOn ? 1 : 0, 'inv.outputWatts': 0, 'inv.acInVol': gridOn ? 230_000 : 0 })

const realNow = Date.now
const later = (ms: number) => { Date.now = () => realNow() + ms }

// No address and no schedule: the status is not stale and AC is left alone while the grid is there.
assert.equal(service.getSettings().mode, 'grid')
await service.processResilienceAutomation(metrics, quota(false, true))
let status = service.getStatus()
assert.equal(status.mode, 'grid')
assert.equal(status.risk, 'none')
assert.deepEqual(status.events, [])
assert.equal(status.grid?.state, 'on')
assert.equal(status.acAction, 'none')

// The grid goes: a single reading is not enough, the second one switches AC on.
await service.processResilienceAutomation(metrics, quota(false, false))
assert.equal(service.getStatus().grid?.state, 'on')
assert.deepEqual(acCommands, [])
await service.processResilienceAutomation(metrics, quota(false, false))
status = service.getStatus()
assert.equal(status.grid?.state, 'off')
// Without a schedule an outage is never "outside the schedule"
assert.equal(status.grid?.unplanned, false)
assert.equal(status.acAction, 'on')
assert.deepEqual(acCommands, [1])

// The grid comes back: after the recovery delay and the low-load wait, the automation's AC goes off.
later(3 * MIN)
await service.processResilienceAutomation(metrics, quota(true, true))
assert.equal(service.getStatus().acAction, 'none')
await service.processResilienceAutomation(metrics, quota(true, true))
status = service.getStatus()
assert.equal(status.grid?.state, 'on')
assert.equal(status.acAction, 'off')
assert.deepEqual(acCommands, [1, 0])
Date.now = realNow

// An address kept from the hybrid mode is not used: no YASNO request, no schedule on the timeline.
upsertResilienceSettings({ ...settings, region_id: 25, dso_id: 902, outage_group: '1.1' })
upsertOutageScheduleDay({ day: kyivDateKey(new Date()), source: 'planned', outage_group: '1.1', status: 'ScheduleApplies', slots: '[{"start":0,"end":1440}]' })
await service.processResilienceAutomation(metrics, quota(false, true))
assert.equal((await service.forceRefresh()).risk, 'none')
const today = service.getPowerTimeline(1)[0]
assert.equal(today.scheduleSource, null)
assert.deepEqual(today.scheduledOff, [])
assert.deepEqual(yasnoRequests, [])

db.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log('Resilience grid-only mode tests passed')
