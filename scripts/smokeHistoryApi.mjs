#!/usr/bin/env node
/**
 * End-to-end check that compressing raw_data changes nothing a client can see.
 *
 *   npm run build:backend && node scripts/smokeHistoryApi.mjs [--rows 500] [--keep]
 *
 * Builds a small copy of the live database, records what the history endpoints
 * return from the legacy TEXT column, then replays the same requests after the
 * migration and again after `--final` has dropped that column. All three
 * responses must be byte-identical.
 *
 * Each phase runs in its own child process (`--probe <db> <out.json>`): the
 * database module opens its handle and caches the table shape at import time, so
 * a phase cannot observe a schema change made after it started. The child writes
 * its results to a file because startup logging shares stdout.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const serverRequire = createRequire(path.join(repoRoot, 'server/'))

const HISTORY_ENDPOINTS = [
  sn => `/api/devices/${sn}/history?period=24h`,
  sn => `/api/devices/${sn}/errors?limit=100`,
]

// ---------------------------------------------------------------- probe child

async function probe(dbPath, outPath) {
  process.env.ECOFLOW_DB_PATH = dbPath

  const express = serverRequire('express')
  const { initDatabase, getDeviceBySn, getLastKnownErrors, db } = await import(
    path.join(repoRoot, 'server/dist/db/database.js')
  )
  const devicesRouter = (await import(path.join(repoRoot, 'server/dist/routes/devices.js'))).default

  initDatabase()

  const app = express()
  app.use(express.json())
  app.use('/api/devices', devicesRouter)

  const server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  const devices = db.prepare('SELECT serial_number FROM devices ORDER BY id').all()
  const range = db.prepare(
    'SELECT MIN(timestamp) AS from_, MAX(timestamp) AS to_ FROM device_states'
  ).get()

  const results = {}
  for (const { serial_number: sn } of devices) {
    if (!getDeviceBySn(sn)) continue

    const urls = HISTORY_ENDPOINTS.map(build => build(sn))
    if (range.from_ && range.to_) {
      // The copy holds old rows, so a preset period would return nothing; a custom
      // range over the copied rows is what actually exercises the query paths.
      const from = encodeURIComponent(range.from_.replace(' ', 'T') + 'Z')
      const to = encodeURIComponent(range.to_.replace(' ', 'T') + 'Z')
      urls.push(`/api/devices/${sn}/history?period=custom&from=${from}&to=${to}`)
    }

    for (const url of urls) {
      const response = await fetch(base + url)
      const body = await response.json()
      // Preset periods echo a window derived from the wall clock, which differs
      // between phases by construction; the custom range covers the same code.
      if (body.period && body.period !== 'custom') {
        body.from = '<now-relative>'
        body.to = '<now-relative>'
      }
      results[url] = { status: response.status, body }
    }

    // getLastKnownErrors is the third raw-payload read site and has no route of
    // its own that avoids calling the EcoFlow API, so check it directly.
    results[`fn:getLastKnownErrors(${sn})`] = getLastKnownErrors(getDeviceBySn(sn).id)
  }

  server.close()
  db.close()
  fs.writeFileSync(outPath, JSON.stringify(results))
}

// -------------------------------------------------------------- orchestrator

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`${label} failed with exit code ${result.status}`)
  }
  return result
}

function capture(dbPath, label) {
  const outPath = `/tmp/eco_smoke_probe_${process.pid}.json`
  const self = new URL(import.meta.url).pathname
  const result = run(process.execPath, [self, '--probe', dbPath, outPath], label)
  if (result.stderr.trim()) process.stderr.write(result.stderr)
  const captured = JSON.parse(fs.readFileSync(outPath, 'utf8'))
  fs.rmSync(outPath, { force: true })
  return captured
}

function sizeMiB(file) {
  return fs.statSync(file).size / 1024 ** 2
}

function main(argv) {
  let rows = 500
  let keep = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rows') rows = Number(argv[++i])
    else if (argv[i] === '--keep') keep = true
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }

  const dbPath = '/tmp/eco_smoke.db'
  const migrate = ['server/dist/scripts/migrateRawData.js', '--db', dbPath]

  run(process.execPath, ['scripts/makeTestDb.mjs', '--rows', String(rows), '--out', dbPath], 'makeTestDb')
  const initialSize = sizeMiB(dbPath)

  const before = capture(dbPath, 'probe (legacy raw_data)')
  assert.ok(Object.keys(before).length > 0, 'probe returned no results — is the test database empty?')
  for (const [key, value] of Object.entries(before)) {
    if (value && typeof value === 'object' && 'status' in value) {
      assert.equal(value.status, 200, `${key} should answer 200 before migration`)
    }
  }

  // Guard against a vacuous pass: the responses have to contain real rows, and
  // the raw payload has to have been decoded at least once.
  assert.ok(
    Object.values(before).some(v => v?.body?.dataPoints?.length > 0),
    'no history response returned any data points'
  )
  assert.ok(
    Object.entries(before).some(([k, v]) => k.startsWith('fn:getLastKnownErrors') && v !== null),
    'getLastKnownErrors returned null for every device — the raw payload path was never exercised'
  )

  run(process.execPath, [...migrate, '--verify'], 'migrateRawData --verify')
  const after = capture(dbPath, 'probe (raw_data_z present)')
  assert.deepEqual(after, before, 'responses changed after the migration')

  run(process.execPath, [...migrate, '--verify', '--final'], 'migrateRawData --final')
  const dropped = capture(dbPath, 'probe (legacy column dropped)')
  assert.deepEqual(dropped, before, 'responses changed after raw_data was dropped')

  const finalSize = sizeMiB(dbPath)
  console.log(
    `History API smoke passed: ${Object.keys(before).length} responses identical across ` +
      `legacy / migrated / dropped, ${initialSize.toFixed(1)} MiB -> ${finalSize.toFixed(1)} MiB ` +
      `(-${(100 * (1 - finalSize / initialSize)).toFixed(1)}%)`
  )

  if (!keep) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
  }
}

const args = process.argv.slice(2)
if (args[0] === '--probe') {
  await probe(path.resolve(args[1]), path.resolve(args[2]))
} else {
  main(args)
}
