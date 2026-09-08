#!/usr/bin/env node
/**
 * Fold the WAL back into the main database file so a plain `cp` captures a
 * complete backup. Run this with the writer stopped.
 *
 *   node scripts/checkpointDb.mjs [server/data/ecoflow.db]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'server/'))
const Database = require('better-sqlite3')

const dbPath = path.resolve(process.argv[2] ?? 'server/data/ecoflow.db')
if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`)

const walBefore = fs.existsSync(`${dbPath}-wal`) ? fs.statSync(`${dbPath}-wal`).size : 0
const db = new Database(dbPath)
const [busy, walPages, checkpointed] = db.pragma('wal_checkpoint(TRUNCATE)', { simple: false })
  .flatMap(row => [row.busy, row.log, row.checkpointed])
db.close()

const walAfter = fs.existsSync(`${dbPath}-wal`) ? fs.statSync(`${dbPath}-wal`).size : 0
console.log(
  `wal_checkpoint(TRUNCATE) busy=${busy} wal_pages=${walPages} checkpointed=${checkpointed} ` +
  `wal_bytes ${walBefore} -> ${walAfter}`
)
if (busy !== 0) {
  console.error('Checkpoint was blocked by another connection — stop the service and retry')
  process.exitCode = 1
}
