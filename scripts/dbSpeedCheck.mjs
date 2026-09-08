#!/usr/bin/env node
/**
 * Benchmark the history range reads, so the raw_data migration can be measured
 * rather than assumed.
 *
 *   node scripts/dbSpeedCheck.mjs [--db server/data/ecoflow.db] [--device <id|serial>]
 *                                 [--anchor latest|now] [--limit 100000]
 *
 * Opens the database read-only and never writes. For each of a 1-day, 7-day and
 * 30-day window it times two reads:
 *
 *   history  the columns the /history endpoint actually selects — what the UI pays
 *   raw      the raw payload columns (raw_data and/or raw_data_z) — the bytes the
 *            zstd migration removes; run it before and after to see the win
 *
 * Windows end at the newest row by default (`--anchor now` uses the wall clock),
 * so this works unchanged against a small copy built by makeTestDb.
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { withMalformedRetry } from './lib/sqliteRetry.mjs'

const require = createRequire(path.join(process.cwd(), 'server/'))
const Database = require('better-sqlite3')

const WINDOWS = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
]

// Mirrors the 'none' aggregation branch of getDeviceHistory.
const HISTORY_COLUMNS = `
  timestamp, battery_soc, battery_watts, ac_input_watts, solar_input_watts,
  ac_output_watts, dc_output_watts, temperature, bms_master_vol,
  extra_battery1_soc, extra_battery1_temp, extra_battery1_vol,
  extra_battery2_soc, extra_battery2_temp, extra_battery2_vol
`

function parseArgs(argv) {
  const opts = { db: 'server/data/ecoflow.db', device: null, anchor: 'latest', limit: 100000 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') opts.db = argv[++i]
    else if (argv[i] === '--device') opts.device = argv[++i]
    else if (argv[i] === '--anchor') opts.anchor = argv[++i]
    else if (argv[i] === '--limit') opts.limit = Number(argv[++i])
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  if (opts.anchor !== 'latest' && opts.anchor !== 'now') {
    throw new Error(`--anchor must be "latest" or "now", got ${opts.anchor}`)
  }
  return opts
}

/** SQLite stores timestamps as `YYYY-MM-DD HH:MM:SS`. */
function toSqliteTimestamp(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
}

function pickDevice(db, wanted) {
  const devices = db.prepare('SELECT id, serial_number FROM devices ORDER BY id').all()
  if (devices.length === 0) throw new Error('No devices in this database')

  if (wanted !== null) {
    const match = devices.find(d => String(d.id) === wanted || d.serial_number === wanted)
    if (!match) throw new Error(`No device matches ${wanted} (have: ${devices.map(d => d.id).join(', ')})`)
    return match
  }
  // Default to whichever device has the newest telemetry — on the live database
  // that is the one the numbers in the README were measured against.
  const latest = db.prepare(
    'SELECT MAX(timestamp) AS ts FROM device_states WHERE device_id = ?'
  )
  let best = null
  for (const device of devices) {
    const ts = latest.get(device.id).ts
    if (ts && (best === null || ts > best.ts)) best = { ...device, ts }
  }
  if (!best) throw new Error('No device has any device_states rows')
  return best
}

function payloadBytes(rows, rawColumns) {
  if (rawColumns.length === 0) return Buffer.byteLength(JSON.stringify(rows))
  let bytes = 0
  for (const row of rows) {
    for (const column of rawColumns) {
      const value = row[column]
      if (typeof value === 'string') bytes += Buffer.byteLength(value, 'utf8')
      else if (value) bytes += value.length
    }
  }
  return bytes
}

function time(label, statement, args, rawColumns) {
  const startedAt = performance.now()
  const rows = withMalformedRetry(() => statement.all(...args), { label })
  const ms = performance.now() - startedAt
  return { rows: rows.length, ms, bytes: payloadBytes(rows, rawColumns) }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const dbPath = path.resolve(opts.db)
  const db = new Database(dbPath, { readonly: true })

  try {
    const columns = new Set(
      db.prepare('PRAGMA table_info(device_states)').all().map(c => c.name)
    )
    const rawColumns = ['raw_data', 'raw_data_z'].filter(c => columns.has(c))

    const device = pickDevice(db, opts.device)
    const anchorRow = db.prepare(
      'SELECT MAX(timestamp) AS ts FROM device_states WHERE device_id = ?'
    ).get(device.id)
    const anchor = opts.anchor === 'now' ? toSqliteTimestamp(new Date()) : anchorRow.ts
    if (!anchor) throw new Error(`Device ${device.id} has no device_states rows`)

    console.log(`Database: ${dbPath} (read-only)`)
    console.log(`Device:   ${device.id} (${device.serial_number})`)
    console.log(`Anchor:   ${anchor} (--anchor ${opts.anchor}), row limit ${opts.limit}`)
    console.log(`Raw payload columns present: ${rawColumns.join(', ') || '(none — --final has run)'}`)

    const rangeSql = where => `
      SELECT ${where}
      FROM device_states
      WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
      LIMIT ${opts.limit}
    `
    const historyStmt = db.prepare(rangeSql(HISTORY_COLUMNS))
    const rawStmt = rawColumns.length > 0
      ? db.prepare(rangeSql(['timestamp', ...rawColumns].join(', ')))
      : null

    // Step 3.2 of the perf work: this must say SEARCH ... USING INDEX
    // idx_device_states_device_timestamp, never SCAN.
    console.log('\nEXPLAIN QUERY PLAN (range read):')
    for (const step of db.prepare(`EXPLAIN QUERY PLAN ${rangeSql(HISTORY_COLUMNS)}`).all(device.id, anchor, anchor)) {
      console.log(`  ${step.detail}`)
    }

    const anchorMs = Date.parse(anchor.replace(' ', 'T') + 'Z')
    console.log('\nrange     query    rows      ms      MB   MB/s')
    for (const { label, days } of WINDOWS) {
      const from = toSqliteTimestamp(new Date(anchorMs - days * 86400_000))
      const args = [device.id, from, anchor]

      const measured = [['history', time(`history ${label}`, historyStmt, args, [])]]
      if (rawStmt) measured.push(['raw', time(`raw ${label}`, rawStmt, args, rawColumns)])

      for (const [query, result] of measured) {
        const mb = result.bytes / 1024 ** 2
        const capped = result.rows === opts.limit ? '  (hit --limit)' : ''
        console.log(
          `${label.padEnd(9)} ${query.padEnd(8)} ${String(result.rows).padStart(6)} ` +
            `${result.ms.toFixed(0).padStart(7)} ${mb.toFixed(1).padStart(7)} ` +
            `${(mb / (result.ms / 1000)).toFixed(0).padStart(6)}${capped}`
        )
      }
    }
  } finally {
    db.close()
  }
}

main()
