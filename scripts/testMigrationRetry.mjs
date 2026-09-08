#!/usr/bin/env node
/**
 * Checks the malformed-image retry path and that the migration still completes
 * on a real (small) copy of the database.
 *
 *   npm run test:migrate
 *
 * Two halves:
 *  1. The retry helper itself — both copies of it, since `scripts/lib/sqliteRetry.mjs`
 *     is a hand-kept mirror of `server/src/lib/sqliteRetry.ts` and nothing else
 *     would catch the two drifting apart.
 *  2. A 5000-row copy built by makeTestDb, migrated with `--verify`, asserting a
 *     zero exit. The live database is only ever opened read-only, by makeTestDb.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

const MALFORMED = 'database disk image is malformed'

// ------------------------------------------------------------- retry helper

async function checkHelper(label, modulePath) {
  const { withMalformedRetry, isMalformedError, MALFORMED_RETRIES } = await import(modulePath)

  assert.equal(isMalformedError(new Error(MALFORMED)), true)
  assert.equal(isMalformedError(new Error('11 SQLITE_CORRUPT: malformed')), true)
  assert.equal(isMalformedError(new Error('database is locked')), false)
  assert.equal(isMalformedError('not an error'), false)

  // Recovers: the third attempt is the one that works.
  let calls = 0
  const value = withMalformedRetry(
    () => {
      calls++
      if (calls < 3) throw new Error(MALFORMED)
      return 'batch'
    },
    { label: 'test', delayMs: 1 }
  )
  assert.equal(value, 'batch')
  assert.equal(calls, 3)

  // Gives up: one initial attempt plus MALFORMED_RETRIES, then the error escapes.
  calls = 0
  assert.throws(
    () => withMalformedRetry(() => { calls++; throw new Error(MALFORMED) }, { label: 'test', delayMs: 1 }),
    /malformed/
  )
  assert.equal(calls, MALFORMED_RETRIES + 1)

  // Anything else is not a WAL race and must not be retried.
  calls = 0
  assert.throws(
    () => withMalformedRetry(() => { calls++; throw new Error('no such table: device_states') }, { delayMs: 1 }),
    /no such table/
  )
  assert.equal(calls, 1)

  console.log(`  ${label}: retry helper ok (retries=${MALFORMED_RETRIES})`)
}

// ------------------------------------------------------- migration on a copy

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
  }
  assert.equal(result.status, 0, `${label} exited ${result.status}, expected 0`)
  return result.stdout
}

function migrateCopy(rows) {
  const dbPath = '/tmp/eco_migrate_retry.db'
  run(['scripts/makeTestDb.mjs', '--rows', String(rows), '--out', dbPath], 'makeTestDb')

  const migrate = ['server/dist/scripts/migrateRawData.js', '--db', dbPath]
  const first = run([...migrate, '--verify'], 'migrateRawData --verify')
  assert.match(first, /Verify passed/, '--verify did not report success')

  // Idempotent: a second run has nothing left to do and still exits 0.
  const second = run([...migrate, '--verify'], 'migrateRawData --verify (rerun)')
  assert.match(second, /Nothing to migrate/, 'the rerun migrated rows again')

  console.log(`  migration: ${rows}-row copy migrated and verified, rerun was a no-op`)
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
}

// ------------------------------------------------------------------- driver

await checkHelper('scripts/lib/sqliteRetry.mjs', path.join(repoRoot, 'scripts/lib/sqliteRetry.mjs'))
await checkHelper('server/dist/lib/sqliteRetry.js', path.join(repoRoot, 'server/dist/lib/sqliteRetry.js'))
migrateCopy(5000)
console.log('Migration retry tests passed')
