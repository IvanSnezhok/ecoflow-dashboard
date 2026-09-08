/**
 * Backfill `device_states.raw_data_z` from the legacy `raw_data` TEXT column.
 *
 *   tsx server/src/scripts/migrateRawData.ts --db server/data/ecoflow.db
 *   tsx server/src/scripts/migrateRawData.ts --db server/data/ecoflow.db --verify
 *   tsx server/src/scripts/migrateRawData.ts --db server/data/ecoflow.db --verify --final
 *
 * Idempotent: only rows with `raw_data_z IS NULL AND raw_data IS NOT NULL` are
 * touched, so an interrupted run is resumed by re-running the same command.
 * The scan is strictly forward by id — `ORDER BY id DESC` races the writer's WAL
 * and reports `database disk image is malformed`.
 */
import Database, { type Database as DatabaseType } from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { compressRawData, decompressRawData, loadDictionary } from '../lib/rawDataCodec.js'

const BATCH_SIZE = 5000
const SPOT_CHECK_ROWS = 100

interface Options {
  dbPath: string
  verify: boolean
  final: boolean
  vacuum: boolean
  dictPath?: string
}

function parseArgs(argv: string[]): Options {
  let dbPath = ''
  let verify = false
  let final = false
  let vacuum = true
  let dictPath: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--db') dbPath = argv[++i]
    else if (arg === '--dict') dictPath = argv[++i]
    else if (arg === '--verify') verify = true
    else if (arg === '--final') final = true
    else if (arg === '--no-vacuum') vacuum = false
    else if (!arg.startsWith('--') && !dbPath) dbPath = arg
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if (!dbPath) {
    throw new Error('Usage: migrateRawData --db <path/to/ecoflow.db> [--verify] [--final] [--no-vacuum] [--dict <path>]')
  }
  return { dbPath: path.resolve(dbPath), verify, final, vacuum, dictPath }
}

/** Database file plus its WAL, which is where freshly written pages live. */
function fileSizeGiB(dbPath: string): number {
  let total = 0
  for (const suffix of ['', '-wal']) {
    try {
      total += fs.statSync(dbPath + suffix).size
    } catch {
      // missing WAL is normal after a checkpoint
    }
  }
  return total / 1024 ** 3
}

function columnNames(db: DatabaseType): Set<string> {
  const info = db.prepare('PRAGMA table_info(device_states)').all() as Array<{ name: string }>
  return new Set(info.map(c => c.name))
}

function open(dbPath: string): DatabaseType {
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  return db
}

function migrate(db: DatabaseType, dbPath: string): number {
  if (!columnNames(db).has('raw_data_z')) {
    db.exec('ALTER TABLE device_states ADD COLUMN raw_data_z BLOB')
    console.log('Added column raw_data_z to device_states')
  }

  const bounds = db.prepare('SELECT MIN(id) AS minId, MAX(id) AS maxId FROM device_states')
    .get() as { minId: number | null; maxId: number | null }
  if (bounds.maxId === null) {
    console.log('device_states is empty — nothing to migrate')
    return 0
  }
  const maxId = bounds.maxId
  const startId = (bounds.minId ?? 1) - 1

  const selectBatch = db.prepare(`
    SELECT id, raw_data
    FROM device_states
    WHERE id > ? AND raw_data_z IS NULL AND raw_data IS NOT NULL
    ORDER BY id ASC
    LIMIT ${BATCH_SIZE}
  `)
  const update = db.prepare('UPDATE device_states SET raw_data_z = ? WHERE id = ?')

  const writeBatch = db.transaction((encoded: Array<{ id: number; blob: Buffer }>) => {
    for (const row of encoded) update.run(row.blob, row.id)
  })

  const startedAt = Date.now()
  let lastId = startId
  let migrated = 0
  let rawBytes = 0
  let zBytes = 0

  for (;;) {
    const rows = selectBatch.all(lastId) as Array<{ id: number; raw_data: string }>
    if (rows.length === 0) break

    const encoded = rows.map(row => {
      const blob = compressRawData(row.raw_data)
      rawBytes += Buffer.byteLength(row.raw_data, 'utf8')
      zBytes += blob.length
      return { id: row.id, blob }
    })
    writeBatch(encoded)

    lastId = rows[rows.length - 1].id
    migrated += rows.length

    // ETA from id progress: rows already carrying a blob are skipped cheaply,
    // so elapsed-per-id is a better predictor than elapsed-per-migrated-row.
    const elapsed = (Date.now() - startedAt) / 1000
    const idsDone = lastId - startId
    const idsLeft = Math.max(0, maxId - lastId)
    const eta = idsDone > 0 ? Math.round((elapsed / idsDone) * idsLeft) : 0
    console.log(
      `id=${lastId} rows_migrated=${migrated} eta_seconds=${eta} file_size_gib=${fileSizeGiB(dbPath).toFixed(3)}`
    )
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (migrated === 0) {
    console.log('Nothing to migrate — every row with raw_data already has raw_data_z')
  } else {
    const ratio = rawBytes > 0 ? zBytes / rawBytes : 0
    console.log(
      `Migrated ${migrated} rows in ${elapsed}s — ${(rawBytes / 1024 ** 2).toFixed(1)} MiB of JSON ` +
        `to ${(zBytes / 1024 ** 2).toFixed(1)} MiB of blobs (${ratio.toFixed(4)}x)`
    )
  }
  return migrated
}

/** Returns true when every legacy payload has a blob that decodes back to the same object. */
function verify(db: DatabaseType): boolean {
  const counts = db.prepare(
    'SELECT COUNT(raw_data) AS legacy, COUNT(raw_data_z) AS compressed FROM device_states'
  ).get() as { legacy: number; compressed: number }

  console.log(`Verify: COUNT(raw_data)=${counts.legacy} COUNT(raw_data_z)=${counts.compressed}`)
  if (counts.legacy !== counts.compressed) {
    console.error(`Verify FAILED: ${counts.legacy - counts.compressed} rows still lack raw_data_z`)
    return false
  }

  const bounds = db.prepare(
    'SELECT MIN(id) AS minId, MAX(id) AS maxId FROM device_states WHERE raw_data_z IS NOT NULL'
  ).get() as { minId: number | null; maxId: number | null }

  if (bounds.minId === null || bounds.maxId === null) {
    console.log('Verify: no compressed rows to spot-check')
    return true
  }

  // ORDER BY RANDOM() would sort the whole table; probe random ids instead.
  const pick = db.prepare(`
    SELECT id, raw_data, raw_data_z
    FROM device_states
    WHERE id >= ? AND raw_data IS NOT NULL AND raw_data_z IS NOT NULL
    ORDER BY id ASC LIMIT 1
  `)

  const checked = new Set<number>()
  let mismatches = 0
  for (let attempt = 0; checked.size < SPOT_CHECK_ROWS && attempt < SPOT_CHECK_ROWS * 20; attempt++) {
    const probe = bounds.minId + Math.floor(Math.random() * (bounds.maxId - bounds.minId + 1))
    const row = pick.get(probe) as { id: number; raw_data: string; raw_data_z: Buffer } | undefined
    if (!row || checked.has(row.id)) continue
    checked.add(row.id)

    try {
      const decoded = decompressRawData(row.raw_data_z)
      if (JSON.stringify(JSON.parse(decoded)) !== JSON.stringify(JSON.parse(row.raw_data))) {
        console.error(`Verify FAILED: row ${row.id} decodes to a different object`)
        mismatches++
      }
    } catch (err) {
      console.error(`Verify FAILED: row ${row.id} does not decode:`, err instanceof Error ? err.message : err)
      mismatches++
    }
  }

  console.log(`Verify: spot-checked ${checked.size} rows, ${mismatches} mismatches`)
  return mismatches === 0
}

function dropLegacyColumn(db: DatabaseType, dbPath: string, vacuum: boolean): void {
  if (!columnNames(db).has('raw_data')) {
    console.log('Legacy raw_data column is already gone')
  } else {
    db.exec('ALTER TABLE device_states DROP COLUMN raw_data')
    console.log('Dropped legacy column device_states.raw_data')
  }

  if (!vacuum) {
    console.log('Skipping VACUUM (--no-vacuum): the file will not shrink until one is run')
    return
  }
  // DROP COLUMN only stops reading the field; VACUUM is what rewrites the pages.
  // It needs free disk roughly equal to the *new* database size while it runs.
  console.log(`VACUUM starting (file is ${fileSizeGiB(dbPath).toFixed(3)} GiB) — this can take a while...`)
  const startedAt = Date.now()
  db.exec('VACUUM')
  // Fold the WAL back in, otherwise the reclaimed pages are still on disk beside the file.
  db.pragma('wal_checkpoint(TRUNCATE)')
  console.log(
    `VACUUM done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — file is now ${fileSizeGiB(dbPath).toFixed(3)} GiB`
  )
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  loadDictionary(opts.dictPath)

  console.log(`Database: ${opts.dbPath} (${fileSizeGiB(opts.dbPath).toFixed(3)} GiB)`)
  const db = open(opts.dbPath)

  try {
    migrate(db, opts.dbPath)

    let verified = false
    if (opts.verify) {
      verified = verify(db)
      if (!verified) {
        process.exitCode = 1
        return
      }
      console.log('Verify passed')
    }

    if (opts.final) {
      if (!verified) {
        console.error('Refusing --final: it requires --verify to pass in the same invocation')
        process.exitCode = 1
        return
      }
      dropLegacyColumn(db, opts.dbPath, opts.vacuum)
    }
  } finally {
    db.close()
  }
}

main()
