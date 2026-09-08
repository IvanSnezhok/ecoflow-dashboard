#!/usr/bin/env node
/**
 * Build a small standalone copy of ecoflow.db for testing the raw_data migration
 * and the history endpoints, without touching the live database.
 *
 *   node scripts/makeTestDb.mjs [--source server/data/ecoflow.db] [--out /tmp/eco_test.db] [--rows 5000]
 *
 * The source is opened read-only and only ever queried with short, bounded,
 * primary-key-forward statements. Long scans driven by
 * idx_device_states_device_timestamp outlive the live writer's WAL snapshot and
 * fail with `database disk image is malformed`; `ORDER BY id DESC` does the same.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'server/'))
const Database = require('better-sqlite3')

const PROBE_COUNT = 256
const SCAN_BATCH = 500
const SCAN_BATCH_BUDGET = 200

function parseArgs(argv) {
  const opts = { source: 'server/data/ecoflow.db', out: '/tmp/eco_test.db', rows: 5000 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') opts.source = argv[++i]
    else if (argv[i] === '--out') opts.out = argv[++i]
    else if (argv[i] === '--rows') opts.rows = Number(argv[++i])
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  return opts
}

const { source, out, rows } = parseArgs(process.argv.slice(2))
const sourcePath = path.resolve(source)
const outPath = path.resolve(out)

for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(outPath + suffix, { force: true })
}

const src = new Database(sourcePath, { readonly: true })
const dst = new Database(outPath)
dst.pragma('journal_mode = WAL')

// Reuse the real DDL so column order, types and indexes match the live database.
for (const { sql } of src.prepare(
  "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
).all()) {
  dst.exec(sql)
}

const deviceColumns = src.prepare('PRAGMA table_info(devices)').all().map(c => c.name)
const devices = src.prepare('SELECT * FROM devices ORDER BY id').all()
const insertDevice = dst.prepare(
  `INSERT INTO devices (${deviceColumns.join(', ')}) VALUES (${deviceColumns.map(() => '?').join(', ')})`
)
for (const device of devices) insertDevice.run(deviceColumns.map(c => device[c]))
console.log(`Copied ${devices.length} devices: ${devices.map(d => `${d.id}=${d.serial_number}`).join(', ')}`)

const { minId, maxId } = src.prepare('SELECT MIN(id) AS minId, MAX(id) AS maxId FROM device_states').get()
if (minId === null) throw new Error('Source device_states is empty')

// Each device occupies its own stretch of the id space (rows are only appended).
// Sample the range with primary-key point lookups to find where each one starts.
const probeRow = src.prepare('SELECT id, device_id FROM device_states WHERE id >= ? ORDER BY id ASC LIMIT 1')
const firstIdByDevice = new Map()
for (let i = 0; i < PROBE_COUNT; i++) {
  const probe = minId + Math.floor(((maxId - minId) * i) / (PROBE_COUNT - 1))
  const row = probeRow.get(probe)
  if (row && !firstIdByDevice.has(row.device_id)) firstIdByDevice.set(row.device_id, row.id)
}

const stateColumns = src.prepare('PRAGMA table_info(device_states)').all().map(c => c.name)
const insertState = dst.prepare(
  `INSERT INTO device_states (${stateColumns.join(', ')}) VALUES (${stateColumns.map(() => '?').join(', ')})`
)
const copyStates = dst.transaction(batch => {
  for (const row of batch) insertState.run(stateColumns.map(c => row[c]))
})

// NOT INDEXED keeps the planner on the primary key: a device_id index seek plus a
// sort would outlive the writer's WAL snapshot on a table this size.
const scanBatch = src.prepare(`
  SELECT * FROM device_states NOT INDEXED
  WHERE id > ? ORDER BY id ASC LIMIT ${SCAN_BATCH}
`)

const perDevice = Math.max(1, Math.floor(rows / Math.max(1, firstIdByDevice.size)))
let copied = 0
for (const [deviceId, startId] of [...firstIdByDevice].sort((a, b) => a[0] - b[0])) {
  const wanted = []
  let cursor = startId - 1
  for (let batch = 0; batch < SCAN_BATCH_BUDGET && wanted.length < perDevice; batch++) {
    const chunk = scanBatch.all(cursor)
    if (chunk.length === 0) break
    cursor = chunk[chunk.length - 1].id
    for (const row of chunk) {
      if (row.device_id === deviceId && row.raw_data !== null && wanted.length < perDevice) wanted.push(row)
    }
  }
  copyStates(wanted)
  copied += wanted.length
  console.log(`  device ${deviceId}: ${wanted.length} states from id ${startId}`)
}

dst.pragma('wal_checkpoint(TRUNCATE)')
const withRaw = dst.prepare('SELECT COUNT(raw_data) AS n FROM device_states').get().n
const size = fs.statSync(outPath).size
console.log(`Wrote ${outPath}: ${copied} states (${withRaw} with raw_data), ${(size / 1024 ** 2).toFixed(1)} MiB`)

src.close()
dst.close()
