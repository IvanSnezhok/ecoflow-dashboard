#!/usr/bin/env node
/**
 * Retrain the zstd dictionary used for device_states.raw_data_z.
 *
 *   python3 -m pip install zstandard      # once; Node can use dictionaries but not train them
 *   node server/scripts/trainDictionary.mjs [--db server/data/ecoflow.db]
 *                                          [--out server/data/zstd.dict]
 *                                          [--rows 20000] [--from 1] [--size 112640]
 *
 * Retrain once a year, or after an EcoFlow firmware change alters the quota key
 * set. A stale dictionary keeps working — compression degrades roughly 2-3x, it
 * never fails — but rows already stored keep decoding only with the dictionary
 * they were written with, so replacing the file means re-running the migration
 * against a fresh column. Write a new dictionary only when the database has not
 * yet been migrated, or keep the old one.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'server/'))
const Database = require('better-sqlite3')

const SCAN_BATCH = 500

function parseArgs(argv) {
  const opts = {
    db: 'server/data/ecoflow.db',
    out: 'server/data/zstd.dict',
    rows: 20000,
    from: 1,
    size: 112640,
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') opts.db = argv[++i]
    else if (argv[i] === '--out') opts.out = argv[++i]
    else if (argv[i] === '--rows') opts.rows = Number(argv[++i])
    else if (argv[i] === '--from') opts.from = Number(argv[++i])
    else if (argv[i] === '--size') opts.size = Number(argv[++i])
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
const dbPath = path.resolve(opts.db)
const outPath = path.resolve(opts.out)
const helper = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'train_dictionary.py')

const db = new Database(dbPath, { readonly: true })

// Short primary-key-forward batches only: an index seek plus a sort over a table
// this size outlives the live writer's WAL snapshot and reports
// `database disk image is malformed`.
const scanBatch = db.prepare(`
  SELECT id, raw_data FROM device_states NOT INDEXED
  WHERE id > ? AND raw_data IS NOT NULL
  ORDER BY id ASC LIMIT ${SCAN_BATCH}
`)

const samplesPath = path.join(os.tmpdir(), `ecoflow-dict-samples-${process.pid}.bin`)
const out = fs.openSync(samplesPath, 'w')
let cursor = opts.from
let collected = 0
let bytes = 0

try {
  while (collected < opts.rows) {
    const chunk = scanBatch.all(cursor)
    if (chunk.length === 0) break
    cursor = chunk[chunk.length - 1].id
    for (const row of chunk) {
      if (collected >= opts.rows) break
      const payload = Buffer.from(row.raw_data, 'utf8')
      const header = Buffer.alloc(4)
      header.writeUInt32LE(payload.length, 0)
      fs.writeSync(out, header)
      fs.writeSync(out, payload)
      collected++
      bytes += payload.length
    }
  }
} finally {
  fs.closeSync(out)
  db.close()
}

if (collected === 0) {
  fs.rmSync(samplesPath, { force: true })
  throw new Error(`No rows with raw_data found after id ${opts.from} in ${dbPath}`)
}
console.log(`Sampled ${collected} rows (${(bytes / 1024 ** 2).toFixed(1)} MiB) up to id ${cursor}`)

const result = spawnSync('python3', [helper, samplesPath, outPath, String(opts.size)], { stdio: 'inherit' })
fs.rmSync(samplesPath, { force: true })

if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`train_dictionary.py exited with ${result.status} (is the zstandard package installed?)`)
}
