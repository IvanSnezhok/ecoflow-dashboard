import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Configuration is read at import time
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecoflow-resilience-'))
process.env.ECOFLOW_DB_PATH = path.join(dir, 'test.db')
process.env.ECOFLOW_ACCESS_KEY ??= 'test-access'
process.env.ECOFLOW_SECRET_KEY ??= 'test-secret'
delete process.env.ECOFLOW_BLE_BRIDGE_URL

const SN = 'DCABZ5ZE1234567'
const GROUP = '1.1'
const MIN = 60_000

const { kyivDateKey } = await import('../lib/kyivTime.js')
// Outage window covering the whole Kyiv day, or none at all.
let outageToday = true
const acCommands: number[] = []
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith('/planned-outages')) {
    return json({ [GROUP]: { today: {
      date: kyivDateKey(new Date()), status: 'ScheduleApplies',
      slots: outageToday ? [{ start: 0, end: 1440, type: 'Definite' }] : [],
    } } })
  }
  if (url.pathname.endsWith('/probable-outages')) return json({})
  if (url.pathname === '/iot-open/sign/device/quota' && init?.method === 'PUT') {
    acCommands.push((JSON.parse(String(init.body)) as { params: { enabled: number } }).params.enabled)
    return json({ code: '0', message: 'ok', data: null })
  }
  throw new Error(`unexpected request ${url}`)
}) as typeof fetch

const { initDatabase, db, insertLog, upsertResilienceSettings } = await import('../db/database.js')
initDatabase()
db.prepare("INSERT INTO devices (serial_number, device_type, name) VALUES (?, 'DELTA Pro', 'Delta')").run(SN)
const deviceId = (db.prepare('SELECT id FROM devices WHERE serial_number = ?').get(SN) as { id: number }).id
upsertResilienceSettings({
  device_id: deviceId, enabled: 1, auto_ac: 1, notify_slack: 0, region_id: 25, dso_id: 902, outage_group: GROUP,
  warning_lead_minutes: 60, recovery_delay_minutes: 0, min_soc: 25, reserve_soc: 15,
  battery_capacity_wh: 3600, inverter_efficiency: 0.85, load_profile: '[]', ac_off_max_watts: 50,
})

type Service = typeof import('./resilienceService.js')
let restarts = 0
/** A fresh copy of the service module: in-memory state is gone, the database stays. */
const start = async (): Promise<Service> =>
  import(new URL(`./resilienceService.js?restart=${restarts++}`, import.meta.url).href) as Promise<Service>
const metrics = { deviceId, serialNumber: SN, soc: 90, totalOutputWatts: 0 }
const quota = (acOn: boolean) => ({ 'bmsMaster.soc': 90, 'inv.cfgAcEnabled': acOn ? 1 : 0, 'inv.outputWatts': 0, 'inv.acInVol': 230_000 })

const realNow = Date.now
const later = (ms: number) => { Date.now = () => realNow() + ms }

// Outage window: the automation switches AC on.
let service = await start()
await service.processResilienceAutomation(metrics, quota(false))
assert.equal(service.getStatus().risk, 'active')
assert.equal(service.getStatus().acAction, 'on')
assert.deepEqual(acCommands, [1])

// The dashboard restarts during the outage, and the window ends while it is down.
outageToday = false
service = await start()
await service.processResilienceAutomation(metrics, quota(true))
assert.equal(service.getStatus().risk, 'none')
assert.equal(service.getStatus().acAction, 'waiting-load')
later(3 * MIN)
await service.processResilienceAutomation(metrics, quota(true))
assert.equal(service.getStatus().acAction, 'off')
assert.deepEqual(acCommands, [1, 0])
Date.now = realNow

// AC switched on by hand afterwards stays on.
service = await start()
await service.processResilienceAutomation(metrics, quota(true))
later(3 * MIN)
await service.processResilienceAutomation(metrics, quota(true))
assert.equal(service.getStatus().acAction, 'none')
Date.now = realNow

// Before the state was stored, ownership comes from the newest AC command in the log.
db.prepare('DELETE FROM resilience_ac_state').run()
insertLog(deviceId, 'COMMAND', 'resilienceAcOn', null, null, true, null)
service = await start()
await service.processResilienceAutomation(metrics, quota(true))
assert.equal(service.getStatus().acAction, 'waiting-load')
db.prepare('DELETE FROM resilience_ac_state').run()
insertLog(deviceId, 'COMMAND', 'setAcOutput', null, null, true, null)
service = await start()
await service.processResilienceAutomation(metrics, quota(true))
assert.equal(service.getStatus().acAction, 'none')
assert.deepEqual(acCommands, [1, 0])

db.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log('Resilience AC state tests passed')
