#!/usr/bin/env node
/**
 * Check which EcoFlow Open API channels give data for a device. Meant for a device
 * that is in the device list but whose quota is refused (code 1006, e.g. one shared
 * from another account). Pass a working device too to compare against.
 *
 *   node scripts/probeDevice.mjs <serial> [<serial>...] [--wait 90]
 *
 * In the running container, where the keys and node_modules already are:
 *
 *   docker exec -i ecoflow-dashboard node --input-type=module - <serial> < scripts/probeDevice.mjs
 *
 * Read-only: it sends no commands. For each serial it tries
 *
 *   list    the device list: is the serial there, and online
 *   all     GET  /iot-open/sign/device/quota/all (what the panel reads)
 *   fields  POST /iot-open/sign/device/quota for a few named fields
 *   mqtt    subscribes to the quota and status topics and counts messages
 *
 * It prints codes, field names and a few battery values, never the keys or the MQTT
 * password.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'server/'))
// Outside the container the keys come from .env in the project root
if (fs.existsSync('.env')) require('dotenv').config({ path: path.resolve('.env') })
const mqtt = require('mqtt')

const args = process.argv.slice(2).filter((arg) => arg !== '-')
const waitIndex = args.indexOf('--wait')
const waitSeconds = waitIndex >= 0 ? Number(args.splice(waitIndex, 2)[1]) : 90
const serials = args
if (serials.length === 0 || !Number.isFinite(waitSeconds)) {
  console.error('Usage: node scripts/probeDevice.mjs <serial> [<serial>...] [--wait 90]')
  process.exit(2)
}

const accessKey = process.env.ECOFLOW_ACCESS_KEY
const secretKey = process.env.ECOFLOW_SECRET_KEY
const endpoint = process.env.ECOFLOW_API_ENDPOINT || 'https://api-e.ecoflow.com'
if (!accessKey || !secretKey) {
  console.error('ECOFLOW_ACCESS_KEY and ECOFLOW_SECRET_KEY are not set')
  process.exit(2)
}

const FIELDS = ['pd.soc', 'bmsMaster.soc', 'inv.inputWatts', 'inv.outputWatts', 'mppt.inWatts', 'bmsSlave1.soc', 'bmsSlave2.soc']

function flatten(value, prefix, out = []) {
  if (value === null || value === undefined) return out
  if (Array.isArray(value)) value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out))
  else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, out)
  } else out.push([prefix, value])
  return out
}

/** Signed like ecoflowApi.ts: the body is signed, GET query params are not. */
async function call(method, apiPath, { query, body } = {}) {
  const nonce = String(100000 + crypto.randomInt(900000))
  const timestamp = String(Date.now())
  const signed = flatten(body ?? {}, '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
  const base = [...signed, `accessKey=${accessKey}`, `nonce=${nonce}`, `timestamp=${timestamp}`].join('&')
  const sign = crypto.createHmac('sha256', secretKey).update(base).digest('hex')
  const url = new URL(apiPath, endpoint)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.append(key, String(value))
  try {
    const response = await fetch(url, {
      method,
      headers: { accessKey, nonce, timestamp, sign, 'Content-Type': 'application/json;charset=UTF-8' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { code: `HTTP ${response.status}`, message: response.statusText }
    const json = await response.json()
    return { code: String(json.code), message: json.message, data: json.data }
  } catch (error) {
    return { code: 'network', message: error instanceof Error ? error.message : String(error) }
  }
}

const outcome = (result) => (result.code === '0' ? 'ok' : `code ${result.code}: ${result.message}`)
const sample = (quota) => FIELDS.filter((key) => key in quota).map((key) => `${key}=${quota[key]}`).join(' ')

const summary = new Map(serials.map((sn) => [sn, {}]))

console.log(`Endpoint ${endpoint}\n`)
const list = await call('GET', '/iot-open/sign/device/list')
if (list.code !== '0') {
  console.log(`Device list failed (${outcome(list)}), so the keys or endpoint are wrong`)
  process.exit(1)
}

for (const sn of serials) {
  const row = summary.get(sn)
  const device = list.data.find((item) => item.sn === sn)
  row.list = device ? `${device.productName}, ${device.online === 1 ? 'online' : 'offline'}` : 'not in the list'
  console.log(`${sn}`)
  console.log(`  list    ${row.list}`)

  const all = await call('GET', '/iot-open/sign/device/quota/all', { query: { sn } })
  row.all = outcome(all)
  console.log(`  all     ${row.all}`)
  if (all.code === '0' && all.data) console.log(`          ${Object.keys(all.data).length} fields; ${sample(all.data)}`)

  const fields = await call('POST', '/iot-open/sign/device/quota', { body: { sn, params: { quotas: FIELDS } } })
  row.fields = outcome(fields)
  console.log(`  fields  ${row.fields}`)
  if (fields.code === '0' && fields.data) console.log(`          ${sample(fields.data) || JSON.stringify(fields.data).slice(0, 200)}`)
  console.log()
}

const cert = await call('GET', '/iot-open/sign/certification')
if (cert.code !== '0') {
  console.log(`MQTT certificate failed (${outcome(cert)})`)
  process.exit(1)
}
const { url, port, certificateAccount, certificatePassword } = cert.data
const topicsFor = (sn) => [`/open/${certificateAccount}/${sn}/quota`, `/open/${certificateAccount}/${sn}/status`]
const shortTopic = (topic) => topic.replace(certificateAccount, '<account>')

console.log(`MQTT ${url}:${port}, listening ${waitSeconds}s (opening the device in the EcoFlow app makes it report more often)`)
const client = mqtt.connect(`mqtts://${url}:${port}`, {
  clientId: `ecoflow_probe_${Date.now()}`,
  username: certificateAccount,
  password: certificatePassword,
  rejectUnauthorized: false, // same as mqttService.ts
  reconnectPeriod: 0,
  connectTimeout: 20_000,
})
const received = new Map()
let connected = false

await new Promise((resolve) => {
  const finish = () => { client.end(true); resolve() }
  client.on('error', (error) => { console.log(`  connection error: ${error.message}`); finish() })
  client.on('message', (topic, payload) => {
    const entry = received.get(topic) ?? { count: 0, keys: new Set() }
    entry.count++
    try {
      const message = JSON.parse(payload.toString())
      for (const key of Object.keys(message.params ?? message)) entry.keys.add(key)
    } catch { /* not JSON; still counted */ }
    received.set(topic, entry)
  })
  client.on('connect', async () => {
    connected = true
    // One topic per request: a refusal fails the whole SUBACK, so this tells which one
    for (const topic of serials.flatMap(topicsFor)) {
      const error = await new Promise((done) => client.subscribe(topic, { qos: 1 }, done))
      console.log(`  ${shortTopic(topic)}: ${error ? `refused (${error.message})` : 'subscribed'}`)
    }
    setTimeout(finish, waitSeconds * 1000)
  })
  setTimeout(() => { if (!connected) { console.log('  could not connect within 20s'); finish() } }, 20_000)
  // Also when the broker never answers the subscription
  setTimeout(finish, (waitSeconds + 30) * 1000)
})

for (const sn of serials) {
  const [quotaTopic, statusTopic] = topicsFor(sn)
  const quota = received.get(quotaTopic)
  const status = received.get(statusTopic)
  summary.get(sn).mqtt = connected
    ? `${quota?.count ?? 0} quota, ${status?.count ?? 0} status messages`
    : 'not connected'
  if (quota) console.log(`  ${sn} quota keys: ${[...quota.keys].slice(0, 25).join(', ')}`)
}

console.log('\nSummary')
for (const [sn, row] of summary) {
  console.log(`${sn}  list: ${row.list} | all: ${row.all} | fields: ${row.fields} | mqtt: ${row.mqtt}`)
}
process.exit(0)
