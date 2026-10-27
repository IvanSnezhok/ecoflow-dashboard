import Database, { type Database as DatabaseType } from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { compressRawData, loadDictionary, parseRawData } from '../lib/rawDataCodec.js'
import { isStatusCode } from '../lib/errorClassification.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// ECOFLOW_DB_PATH lets tests and maintenance scripts point at a copy of the database.
const dbPath = process.env.ECOFLOW_DB_PATH
  ? path.resolve(process.env.ECOFLOW_DB_PATH)
  : path.resolve(__dirname, '../../data/ecoflow.db')

export const db: DatabaseType = new Database(dbPath)

// Multiple request paths can observe the same quota. Persist one snapshot per device
// per interval and retain the large raw payload only for periodic diagnostics/errors.
const lastStateInsertAt = new Map<number, number>()
const lastRawPayloadAt = new Map<number, number>()
const STATE_SAMPLE_INTERVAL_MS = 10_000
const RAW_PAYLOAD_INTERVAL_MS = 5 * 60_000

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL')

// Initialize database schema
export function initDatabase(): void {
  db.exec(`
    -- Devices table
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_number TEXT UNIQUE NOT NULL,
      device_type TEXT NOT NULL,
      name TEXT,
      online INTEGER DEFAULT 0,
      last_seen TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Device state snapshots
    CREATE TABLE IF NOT EXISTS device_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      battery_soc INTEGER,
      battery_watts INTEGER,
      ac_input_watts INTEGER,
      solar_input_watts INTEGER,
      ac_output_watts INTEGER,
      dc_output_watts INTEGER,
      temperature REAL,
      raw_data TEXT,
      raw_data_z BLOB,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    -- Operation logs
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      operation_type TEXT NOT NULL,
      operation_name TEXT,
      request_payload TEXT,
      response_payload TEXT,
      success INTEGER,
      error_message TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    -- Automation rules table
    CREATE TABLE IF NOT EXISTS automation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      device_id INTEGER,
      enabled INTEGER DEFAULT 1,
      conditions TEXT NOT NULL,
      actions TEXT NOT NULL,
      cooldown_seconds INTEGER DEFAULT 300,
      priority INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_triggered_at TEXT,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    -- Automation execution logs
    CREATE TABLE IF NOT EXISTS automation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      rule_name TEXT,
      device_id INTEGER,
      device_serial TEXT,
      trigger_details TEXT,
      actions_executed TEXT,
      success INTEGER NOT NULL,
      error_message TEXT,
      execution_time_ms INTEGER,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES automation_rules(id),
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    -- Slack integration settings
    CREATE TABLE IF NOT EXISTS slack_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_url TEXT,
      incoming_secret TEXT,
      default_channel TEXT,
      enabled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Kyiv outage-aware AC automation and load forecast (single installation)
    CREATE TABLE IF NOT EXISTS resilience_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      device_id INTEGER,
      enabled INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'hybrid',
      auto_ac INTEGER DEFAULT 0,
      notify_slack INTEGER DEFAULT 1,
      region_id INTEGER,
      dso_id INTEGER,
      outage_group TEXT,
      warning_lead_minutes INTEGER DEFAULT 60,
      recovery_delay_minutes INTEGER DEFAULT 15,
      min_soc INTEGER DEFAULT 25,
      reserve_soc INTEGER DEFAULT 15,
      battery_capacity_wh INTEGER DEFAULT 3600,
      inverter_efficiency REAL DEFAULT 0.85,
      load_profile TEXT DEFAULT '[]',
      ac_off_max_watts INTEGER DEFAULT 50,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    -- Grid presence per minute as seen by the device (light / no light timeline)
    CREATE TABLE IF NOT EXISTS grid_minutes (
      device_id INTEGER NOT NULL,
      minute INTEGER NOT NULL, -- unix epoch minute, UTC
      grid_on INTEGER NOT NULL,
      load_wh REAL NOT NULL DEFAULT 0,
      ecoflow_seconds REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (device_id, minute)
    ) WITHOUT ROWID;

    -- Last known outage schedule per Kyiv day, kept after YASNO stops serving it
    CREATE TABLE IF NOT EXISTS outage_schedule_days (
      day TEXT NOT NULL, -- YYYY-MM-DD, Kyiv
      source TEXT NOT NULL, -- planned | probable
      outage_group TEXT NOT NULL,
      status TEXT,
      slots TEXT NOT NULL DEFAULT '[]', -- [{ start, end }] in Kyiv minutes of the day
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (day, source, outage_group)
    );

    -- Wi-Fi/cloud connectivity: one row per observed online/offline change
    CREATE TABLE IF NOT EXISTS device_connection_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      online INTEGER NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      unobserved_since_ms INTEGER, -- last check before a monitoring gap, NULL = watched live
      first_observation INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    -- Last time the collector checked each device, to detect dashboard downtime
    CREATE TABLE IF NOT EXISTS device_connection_watch (
      device_id INTEGER PRIMARY KEY,
      online INTEGER NOT NULL,
      checked_at_ms INTEGER NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    -- AC the outage automation switched on itself, so a restart can still switch it off
    CREATE TABLE IF NOT EXISTS resilience_ac_state (
      device_id INTEGER PRIMARY KEY,
      owns_ac INTEGER NOT NULL DEFAULT 0, -- 1 = switched on by the automation, on ever since
      last_risk_at_ms INTEGER NOT NULL DEFAULT 0, -- last moment an outage risk needed AC
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_device_states_device_timestamp
      ON device_states(device_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_device_timestamp
      ON operation_logs(device_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_type
      ON operation_logs(operation_type);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_timestamp
      ON operation_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_type_timestamp
      ON operation_logs(operation_type, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled
      ON automation_rules(enabled);
    CREATE INDEX IF NOT EXISTS idx_automation_rules_device
      ON automation_rules(device_id);
    CREATE INDEX IF NOT EXISTS idx_automation_logs_rule
      ON automation_logs(rule_id);
    CREATE INDEX IF NOT EXISTS idx_automation_logs_timestamp
      ON automation_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_device_connection_events_device_ts
      ON device_connection_events(device_id, timestamp_ms);
  `)

  // Run migrations for new columns
  migrateDatabase()

  // Reads of raw_data_z are impossible without the dictionary, so refuse to start without it.
  loadDictionary()

  console.log('Database initialized')
}

// `raw_data` disappears once the owner runs `migrateRawData.ts --final`. Every
// statement that mentions it is built from this so the server keeps working
// either side of that step.
let legacyRawDataPresent: boolean | null = null

function hasLegacyRawData(): boolean {
  if (legacyRawDataPresent === null) {
    const info = db.prepare('PRAGMA table_info(device_states)').all() as Array<{ name: string }>
    legacyRawDataPresent = info.some(col => col.name === 'raw_data')
  }
  return legacyRawDataPresent
}

// Selecting a literal NULL keeps the result shape identical after the drop.
function rawPayloadColumns(): string {
  return hasLegacyRawData() ? 'raw_data, raw_data_z' : 'NULL AS raw_data, raw_data_z'
}

// Migration for new chart data columns
function migrateDatabase(): void {
  const tableInfo = db.prepare("PRAGMA table_info(device_states)").all() as Array<{ name: string }>
  const existingColumns = new Set(tableInfo.map(col => col.name))

  const newColumns = [
    { name: 'bms_master_vol', type: 'INTEGER' },
    { name: 'extra_battery1_soc', type: 'INTEGER' },
    { name: 'extra_battery1_temp', type: 'REAL' },
    { name: 'extra_battery1_vol', type: 'INTEGER' },
    { name: 'extra_battery2_soc', type: 'INTEGER' },
    { name: 'extra_battery2_temp', type: 'REAL' },
    { name: 'extra_battery2_vol', type: 'INTEGER' },
    // Dictionary-compressed copy of raw_data; see lib/rawDataCodec.ts.
    { name: 'raw_data_z', type: 'BLOB' },
  ]

  for (const col of newColumns) {
    if (!existingColumns.has(col.name)) {
      db.exec(`ALTER TABLE device_states ADD COLUMN ${col.name} ${col.type}`)
      console.log(`Migration: Added column ${col.name} to device_states`)
    }
  }

  legacyRawDataPresent = existingColumns.has('raw_data')

  const resilienceColumns = new Set(
    (db.prepare("PRAGMA table_info(resilience_settings)").all() as Array<{ name: string }>).map(col => col.name)
  )
  if (!resilienceColumns.has('notify_slack')) {
    db.exec('ALTER TABLE resilience_settings ADD COLUMN notify_slack INTEGER DEFAULT 1')
    console.log('Migration: Added column notify_slack to resilience_settings')
  }
  if (!resilienceColumns.has('ac_off_max_watts')) {
    db.exec('ALTER TABLE resilience_settings ADD COLUMN ac_off_max_watts INTEGER DEFAULT 50')
    console.log('Migration: Added column ac_off_max_watts to resilience_settings')
  }
  if (!resilienceColumns.has('mode')) {
    db.exec("ALTER TABLE resilience_settings ADD COLUMN mode TEXT DEFAULT 'hybrid'")
    console.log('Migration: Added column mode to resilience_settings')
  }
}

// Device operations
export function upsertDevice(sn: string, deviceType: string, name: string, online: boolean): number {
  const stmt = db.prepare(`
    INSERT INTO devices (serial_number, device_type, name, online, last_seen, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(serial_number) DO UPDATE SET
      device_type = excluded.device_type,
      name = excluded.name,
      online = excluded.online,
      last_seen = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `)
  const result = stmt.get(sn, deviceType, name, online ? 1 : 0) as { id: number }
  return result.id
}

export function getDeviceById(id: number) {
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(id)
}

export function getDeviceBySn(sn: string) {
  return db.prepare('SELECT * FROM devices WHERE serial_number = ?').get(sn)
}

export function getAllDevices() {
  return db.prepare('SELECT * FROM devices ORDER BY name, serial_number').all()
}

// State operations
export function insertDeviceState(
  deviceId: number,
  state: {
    // null = the quota did not carry the value; never store a made-up 0
    batterySoc: number | null
    batteryWatts: number | null
    acInputWatts: number | null
    solarInputWatts: number | null
    acOutputWatts: number | null
    dcOutputWatts: number | null
    temperature: number | null
    rawData?: string | null
    // New fields for detailed charts
    bmsMasterVol?: number | null
    extraBattery1Soc?: number | null
    extraBattery1Temp?: number | null
    extraBattery1Vol?: number | null
    extraBattery2Soc?: number | null
    extraBattery2Temp?: number | null
    extraBattery2Vol?: number | null
  }
) {
  const now = Date.now()
  const lastInsert = lastStateInsertAt.get(deviceId) ?? 0
  if (now - lastInsert < STATE_SAMPLE_INTERVAL_MS) return null
  lastStateInsertAt.set(deviceId, now)

  const containsError = state.rawData ? /"[^"]*(?:errCode|faultCode)"\s*:\s*(?!0(?:[,}]))/.test(state.rawData) : false
  const lastRaw = lastRawPayloadAt.get(deviceId) ?? 0
  const rawData = containsError || now - lastRaw >= RAW_PAYLOAD_INTERVAL_MS ? state.rawData ?? null : null
  if (rawData) lastRawPayloadAt.set(deviceId, now)

  // Dual write: raw_data_z is what readers use, raw_data stays populated so an older
  // build of the app (or a rollback) still sees a complete history. The legacy column
  // is dropped only by `migrateRawData.ts --final`, once the owner confirms.
  const rawDataZ = rawData ? compressRawData(rawData) : null

  const legacy = hasLegacyRawData()
  const stmt = db.prepare(`
    INSERT INTO device_states (
      device_id, battery_soc, battery_watts, ac_input_watts,
      solar_input_watts, ac_output_watts, dc_output_watts,
      temperature, ${legacy ? 'raw_data, ' : ''}raw_data_z,
      bms_master_vol, extra_battery1_soc, extra_battery1_temp, extra_battery1_vol,
      extra_battery2_soc, extra_battery2_temp, extra_battery2_vol
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${legacy ? '?, ' : ''}?, ?, ?, ?, ?, ?, ?, ?)
  `)
  return stmt.run(
    deviceId,
    state.batterySoc,
    state.batteryWatts,
    state.acInputWatts,
    state.solarInputWatts,
    state.acOutputWatts,
    state.dcOutputWatts,
    state.temperature,
    ...(legacy ? [rawData] : []),
    rawDataZ,
    state.bmsMasterVol ?? null,
    state.extraBattery1Soc ?? null,
    state.extraBattery1Temp ?? null,
    state.extraBattery1Vol ?? null,
    state.extraBattery2Soc ?? null,
    state.extraBattery2Temp ?? null,
    state.extraBattery2Vol ?? null
  )
}

export function getLatestDeviceState(deviceId: number) {
  return db.prepare(`
    SELECT * FROM device_states
    WHERE device_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(deviceId)
}

// A device_states row read for its raw payload: raw_data_z is preferred, raw_data
// is the legacy fallback that stays populated until the --final migration step.
interface RawStateRow {
  raw_data: string | null;
  raw_data_z: Buffer | null;
  timestamp: string;
}

// Latest stored quota snapshot. Raw payloads are only kept every few minutes, so
// skip the rows written without one.
export function getLatestRawData(deviceId: number): { data: Record<string, unknown>; timestamp: string } | null {
  const state = db.prepare(`
    SELECT ${rawPayloadColumns()}, timestamp FROM device_states
    WHERE device_id = ? AND (raw_data_z IS NOT NULL${hasLegacyRawData() ? ' OR raw_data IS NOT NULL' : ''})
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(deviceId) as RawStateRow | undefined;

  if (!state) return null;
  const data = parseRawData(state);
  return data ? { data, timestamp: state.timestamp } : null;
}

// ==================== Connectivity ====================

// A check older than this means the collector was not running in between.
const CONNECTION_GAP_MS = 3 * 60_000
// Heartbeats are persisted at most this often; must stay well under the gap.
const CONNECTION_HEARTBEAT_MS = 60_000
const connectionWatch = new Map<number, { online: boolean; checkedAt: number; persistedAt: number }>()

/** Called by the collector each time it reads a device's online flag. */
export function recordConnectionState(deviceId: number, online: boolean, now: number = Date.now()): void {
  let known = connectionWatch.get(deviceId)
  if (!known) {
    const row = db.prepare('SELECT online, checked_at_ms FROM device_connection_watch WHERE device_id = ?')
      .get(deviceId) as { online: number; checked_at_ms: number } | undefined
    if (row) known = { online: row.online === 1, checkedAt: row.checked_at_ms, persistedAt: row.checked_at_ms }
  }

  const gap = known !== undefined && now - known.checkedAt > CONNECTION_GAP_MS
  // After a gap the device may have dropped and come back unseen, so a fresh event
  // marks the unwatched window even when the state looks unchanged.
  if (!known || known.online !== online || gap) {
    db.prepare(`
      INSERT INTO device_connection_events (device_id, online, timestamp_ms, unobserved_since_ms, first_observation)
      VALUES (?, ?, ?, ?, ?)
    `).run(deviceId, online ? 1 : 0, now, gap ? known!.checkedAt : null, known ? 0 : 1)
  }

  const persist = !known || known.online !== online || gap || now - known.persistedAt >= CONNECTION_HEARTBEAT_MS
  if (persist) {
    db.prepare(`
      INSERT INTO device_connection_watch (device_id, online, checked_at_ms) VALUES (?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET online = excluded.online, checked_at_ms = excluded.checked_at_ms
    `).run(deviceId, online ? 1 : 0, now)
  }
  connectionWatch.set(deviceId, { online, checkedAt: now, persistedAt: persist ? now : known!.persistedAt })
}

interface ConnectionEventRow {
  online: number
  timestamp_ms: number
  unobserved_since_ms: number | null
  first_observation: number
}

/**
 * Events covering the last `windowMs`, the current streak and the latest outage,
 * plus the event before them, oldest first; and when tracking started.
 */
export function getConnectionEvents(deviceId: number, windowMs: number, now: number = Date.now()) {
  // Start of the latest outage is the first offline event after the last online one before it.
  const lastOffline = db.prepare(
    'SELECT MAX(timestamp_ms) AS ts FROM device_connection_events WHERE device_id = ? AND online = 0'
  ).get(deviceId) as { ts: number | null }
  const onlineBeforeOutage = lastOffline.ts === null ? null : (db.prepare(
    'SELECT MAX(timestamp_ms) AS ts FROM device_connection_events WHERE device_id = ? AND online = 1 AND timestamp_ms < ?'
  ).get(deviceId, lastOffline.ts) as { ts: number | null }).ts

  // No outage ever (or none with an online event before it): the streak spans all history.
  const from = lastOffline.ts === null || onlineBeforeOutage === null
    ? 0
    : Math.min(now - windowMs, onlineBeforeOutage)

  const rows = db.prepare(`
    SELECT * FROM (
      SELECT online, timestamp_ms, unobserved_since_ms, first_observation FROM device_connection_events
      WHERE device_id = ? AND timestamp_ms < ? ORDER BY timestamp_ms DESC, id DESC LIMIT 1
    )
    UNION ALL
    SELECT online, timestamp_ms, unobserved_since_ms, first_observation FROM device_connection_events
    WHERE device_id = ? AND timestamp_ms >= ?
  `).all(deviceId, from, deviceId, from) as ConnectionEventRow[]
  rows.sort((a, b) => a.timestamp_ms - b.timestamp_ms)

  const first = db.prepare('SELECT MIN(timestamp_ms) AS ts FROM device_connection_events WHERE device_id = ?')
    .get(deviceId) as { ts: number | null }

  return {
    trackingSince: first.ts,
    events: rows.map((r) => ({
      online: r.online === 1,
      timestamp: r.timestamp_ms,
      unobservedSince: r.unobserved_since_ms,
      firstObservation: r.first_observation === 1,
    })),
  }
}

// Get last known error codes for a device (for offline state)
export interface LastKnownErrors {
  bmsMasterErrCode: number;
  invErrCode: number;
  mpptFaultCode: number;
  overloadState: number;
  emsIsNormal: boolean;
  bmsSlave1ErrCode?: number;
  bmsSlave2ErrCode?: number;
  bmsFault?: number;
  bmsWarningState?: number;
  timestamp: string;
}

export function getLastKnownErrors(deviceId: number): LastKnownErrors | null {
  const state = db.prepare(`
    SELECT ${rawPayloadColumns()}, timestamp FROM device_states
    WHERE device_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(deviceId) as RawStateRow | undefined;

  if (!state) return null;

  const rawData = parseRawData(state) as Record<string, number | undefined> | null;
  if (!rawData) return null;

  return {
    bmsMasterErrCode: rawData["bmsMaster.errCode"] ?? 0,
    invErrCode: rawData["inv.errCode"] ?? 0,
    mpptFaultCode: rawData["mppt.faultCode"] ?? 0,
    overloadState: rawData["pd.iconOverloadState"] ?? 0,
    emsIsNormal: (rawData["ems.emsIsNormalFlag"] ?? 1) === 1,
    bmsSlave1ErrCode: rawData["bmsSlave1.errCode"],
    bmsSlave2ErrCode: rawData["bmsSlave2.errCode"],
    bmsFault: rawData["bmsMaster.bmsFault"],
    bmsWarningState: rawData["ems.bmsWarningState"],
    timestamp: state.timestamp,
  };
}

// Historical data for charts
export interface HistoryDataPoint {
  timestamp: string
  // null = no valid reading in this sample/bucket
  batterySoc: number | null
  batteryWatts: number | null
  acInputWatts: number | null
  solarInputWatts: number | null
  acOutputWatts: number | null
  dcOutputWatts: number | null
  temperature: number | null
  // New fields for detailed charts
  bmsMasterVol: number | null
  extraBattery1Soc: number | null
  extraBattery1Temp: number | null
  extraBattery1Vol: number | null
  extraBattery2Soc: number | null
  extraBattery2Temp: number | null
  extraBattery2Vol: number | null
}

export type AggregationType = 'none' | '1min' | '5min' | '15min' | '1hour' | '6hour'

/**
 * Safety cap on every history range read. A 30-day window is ~130K rows today,
 * and a single unbounded fetch large enough to outlive the writer's WAL snapshot
 * is what surfaces as `database disk image is malformed` (see "WAL and long
 * reads" in the README). Nothing the UI draws needs anywhere near this many
 * points, so the cap only bites if the retention window is misconfigured.
 */
const HISTORY_ROW_LIMIT = 100000

// Convert ISO timestamp to SQLite format (2025-12-23T17:30:23.335Z -> 2025-12-23 17:30:23)
function toSqliteTimestamp(isoString: string): string {
  return isoString.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '')
}

/**
 * Rows written before the null-aware sampler stored a partial quota as all zeros
 * (battery_soc = 0 included). A running DELTA Pro never reports 0% SOC, so such a
 * row is treated as "no reading" for every metric instead of a dip to zero.
 */
function sampleValue(column: string): string {
  return `CASE WHEN battery_soc = 0 THEN NULL ELSE ${column} END`
}

// Column expressions shared by every history read; `agg` wraps them for bucketed reads.
function historyColumns(agg: (expr: string, decimals?: number) => string): string {
  return [
    `${agg(sampleValue('battery_soc'))} as batterySoc`,
    `${agg(sampleValue('battery_watts'))} as batteryWatts`,
    `${agg(sampleValue('ac_input_watts'))} as acInputWatts`,
    `${agg(sampleValue('solar_input_watts'))} as solarInputWatts`,
    `${agg(sampleValue('ac_output_watts'))} as acOutputWatts`,
    `${agg(sampleValue('dc_output_watts'))} as dcOutputWatts`,
    `${agg(sampleValue('NULLIF(temperature, 0)'), 1)} as temperature`,
    `${agg('NULLIF(bms_master_vol, 0)')} as bmsMasterVol`,
    `${agg('NULLIF(extra_battery1_soc, 0)')} as extraBattery1Soc`,
    `${agg('extra_battery1_temp', 1)} as extraBattery1Temp`,
    `${agg('NULLIF(extra_battery1_vol, 0)')} as extraBattery1Vol`,
    `${agg('NULLIF(extra_battery2_soc, 0)')} as extraBattery2Soc`,
    `${agg('extra_battery2_temp', 1)} as extraBattery2Temp`,
    `${agg('NULLIF(extra_battery2_vol, 0)')} as extraBattery2Vol`,
  ].join(',\n        ')
}

const rawColumn = (expr: string) => expr
const avgColumn = (expr: string, decimals = 0) =>
  decimals > 0 ? `ROUND(AVG(${expr}), ${decimals})` : `ROUND(AVG(${expr}))`

export function getDeviceHistory(options: {
  deviceId: number
  from: string
  to: string
  aggregation: AggregationType
}): HistoryDataPoint[] {
  const { deviceId, from, to, aggregation } = options

  // Convert ISO timestamps to SQLite format
  const sqliteFrom = toSqliteTimestamp(from)
  const sqliteTo = toSqliteTimestamp(to)

  // For 'none' aggregation, return raw data
  if (aggregation === 'none') {
    return db.prepare(`
      SELECT
        timestamp,
        ${historyColumns(rawColumn)}
      FROM device_states
      WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
      LIMIT ${HISTORY_ROW_LIMIT}
    `).all(deviceId, sqliteFrom, sqliteTo) as HistoryDataPoint[]
  }

  // Bucket key expression for each aggregation level
  let bucket: string
  switch (aggregation) {
    case '5min':
    case '15min': {
      const interval = aggregation === '5min' ? 5 : 15
      bucket = `strftime('%Y-%m-%dT%H:', timestamp) ||
          printf('%02d', (CAST(strftime('%M', timestamp) AS INTEGER) / ${interval}) * ${interval}) ||
          ':00'`
      break
    }
    case '1hour':
      bucket = `strftime('%Y-%m-%dT%H:00:00', timestamp)`
      break
    case '6hour':
      bucket = `strftime('%Y-%m-%dT', timestamp) ||
          printf('%02d', (CAST(strftime('%H', timestamp) AS INTEGER) / 6) * 6) ||
          ':00:00'`
      break
    case '1min':
    default:
      bucket = `strftime('%Y-%m-%dT%H:%M:00', timestamp)`
  }

  return db.prepare(`
    SELECT
      ${bucket} as timestamp,
      ${historyColumns(avgColumn)}
    FROM device_states
    WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
    GROUP BY ${bucket}
    ORDER BY timestamp ASC
    LIMIT ${HISTORY_ROW_LIMIT}
  `).all(deviceId, sqliteFrom, sqliteTo) as HistoryDataPoint[]
}

// Log operations
export function insertLog(
  deviceId: number | null,
  operationType: string,
  operationName: string,
  requestPayload: string | null,
  responsePayload: string | null,
  success: boolean,
  errorMessage: string | null
) {
  const stmt = db.prepare(`
    INSERT INTO operation_logs (
      device_id, operation_type, operation_name,
      request_payload, response_payload, success, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  return stmt.run(
    deviceId,
    operationType,
    operationName,
    requestPayload,
    responsePayload,
    success ? 1 : 0,
    errorMessage
  )
}

export function getLogs(options: {
  deviceId?: number
  operationType?: string
  limit?: number
  offset?: number
}) {
  const { deviceId, operationType, limit = 100, offset = 0 } = options

  let query = 'SELECT l.*, d.serial_number, d.name as device_name FROM operation_logs l LEFT JOIN devices d ON l.device_id = d.id WHERE 1=1'
  const params: (number | string)[] = []

  if (deviceId) {
    query += ' AND l.device_id = ?'
    params.push(deviceId)
  }
  if (operationType) {
    query += ' AND l.operation_type = ?'
    params.push(operationType)
  }

  query += ' ORDER BY l.timestamp DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  return db.prepare(query).all(...params)
}

// Error history for devices
export type ErrorType = 'bms' | 'inv' | 'mppt' | 'overload' | 'ems' | 'extraBattery1' | 'extraBattery2';

export interface ErrorHistoryEntry {
  timestamp: string;
  errorType: ErrorType;
  errorCode: number;
}

export function getErrorHistory(deviceId: number, limit: number = 100): ErrorHistoryEntry[] {
  const states = db.prepare(`
    SELECT ${rawPayloadColumns()}, timestamp
    FROM device_states
    WHERE device_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(deviceId, limit * 10) as RawStateRow[];

  const errors: ErrorHistoryEntry[] = [];
  const seen = new Set<string>();

  const errorFields: Array<{ type: ErrorType; field: string }> = [
    { type: 'bms', field: 'bmsMaster.errCode' },
    { type: 'inv', field: 'inv.errCode' },
    { type: 'mppt', field: 'mppt.faultCode' },
    { type: 'overload', field: 'pd.iconOverloadState' },
    { type: 'extraBattery1', field: 'bmsSlave1.errCode' },
    { type: 'extraBattery2', field: 'bmsSlave2.errCode' },
  ];


  for (const state of states) {
    const data = parseRawData(state) as Record<string, number | undefined> | null;
    if (!data) continue;

    for (const { type, field } of errorFields) {
      const code = data[field];
      if (code && code !== 0) {
        // Skip status codes (fully charged, charge limit reached, ...): not errors
        if (isStatusCode(type, code)) continue;

        // Group by type-code-minute to avoid duplicates
        const key = `${type}-${code}-${state.timestamp.substring(0, 16)}`;
        if (!seen.has(key)) {
          seen.add(key);
          errors.push({
            timestamp: state.timestamp,
            errorType: type,
            errorCode: code,
          });
        }
      }
    }

    if (errors.length >= limit) break;
  }

  return errors.slice(0, limit);
}

// Cleanup old data
export function cleanupOldData(retentionDays: number = 30): void {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
  const cutoff = cutoffDate.toISOString()

  db.prepare('DELETE FROM device_states WHERE timestamp < ?').run(cutoff)
  db.prepare('DELETE FROM operation_logs WHERE timestamp < ?').run(cutoff)
  db.prepare('DELETE FROM grid_minutes WHERE minute < ?').run(Math.floor(cutoffDate.getTime() / 60_000))
  db.prepare('DELETE FROM outage_schedule_days WHERE day < ?').run(cutoff.slice(0, 10))

  console.log(`Cleaned up data older than ${retentionDays} days`)
}

// ==================== Automation Rules ====================

import type {
  AutomationRuleRow,
  AutomationLogRow,
  SlackSettingsRow,
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
  UpdateSlackSettingsDto,
} from '../types/automation.js'

export function getAllAutomationRules(): AutomationRuleRow[] {
  return db.prepare(`
    SELECT * FROM automation_rules
    ORDER BY priority DESC, created_at ASC
  `).all() as AutomationRuleRow[]
}

export function getAutomationRuleById(id: number): AutomationRuleRow | undefined {
  return db.prepare(`
    SELECT * FROM automation_rules WHERE id = ?
  `).get(id) as AutomationRuleRow | undefined
}

export function getAutomationRulesForDevice(deviceId: number): AutomationRuleRow[] {
  return db.prepare(`
    SELECT * FROM automation_rules
    WHERE enabled = 1 AND (device_id IS NULL OR device_id = ?)
    ORDER BY priority DESC, created_at ASC
  `).all(deviceId) as AutomationRuleRow[]
}

export function createAutomationRule(dto: CreateAutomationRuleDto): number {
  const stmt = db.prepare(`
    INSERT INTO automation_rules (
      name, description, device_id, enabled,
      conditions, actions, cooldown_seconds, priority
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `)
  const result = stmt.get(
    dto.name,
    dto.description ?? null,
    dto.deviceId ?? null,
    dto.enabled !== false ? 1 : 0,
    JSON.stringify(dto.conditions),
    JSON.stringify(dto.actions),
    dto.cooldownSeconds ?? 300,
    dto.priority ?? 0
  ) as { id: number }
  return result.id
}

export function updateAutomationRule(id: number, dto: UpdateAutomationRuleDto): boolean {
  const updates: string[] = []
  const params: (string | number | null)[] = []

  if (dto.name !== undefined) {
    updates.push('name = ?')
    params.push(dto.name)
  }
  if (dto.description !== undefined) {
    updates.push('description = ?')
    params.push(dto.description)
  }
  if (dto.deviceId !== undefined) {
    updates.push('device_id = ?')
    params.push(dto.deviceId)
  }
  if (dto.enabled !== undefined) {
    updates.push('enabled = ?')
    params.push(dto.enabled ? 1 : 0)
  }
  if (dto.conditions !== undefined) {
    updates.push('conditions = ?')
    params.push(JSON.stringify(dto.conditions))
  }
  if (dto.actions !== undefined) {
    updates.push('actions = ?')
    params.push(JSON.stringify(dto.actions))
  }
  if (dto.cooldownSeconds !== undefined) {
    updates.push('cooldown_seconds = ?')
    params.push(dto.cooldownSeconds)
  }
  if (dto.priority !== undefined) {
    updates.push('priority = ?')
    params.push(dto.priority)
  }

  if (updates.length === 0) return false

  updates.push('updated_at = CURRENT_TIMESTAMP')
  params.push(id)

  const result = db.prepare(`
    UPDATE automation_rules
    SET ${updates.join(', ')}
    WHERE id = ?
  `).run(...params)

  return result.changes > 0
}

export function deleteAutomationRule(id: number): boolean {
  const result = db.prepare('DELETE FROM automation_rules WHERE id = ?').run(id)
  return result.changes > 0
}

export function toggleAutomationRule(id: number, enabled: boolean): boolean {
  const result = db.prepare(`
    UPDATE automation_rules
    SET enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(enabled ? 1 : 0, id)
  return result.changes > 0
}

export function updateRuleLastTriggered(id: number): void {
  db.prepare(`
    UPDATE automation_rules
    SET last_triggered_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id)
}

// ==================== Automation Logs ====================

export function insertAutomationLog(log: {
  ruleId: number
  ruleName?: string
  deviceId?: number
  deviceSerial?: string
  triggerDetails?: Record<string, unknown>
  actionsExecuted: unknown[]
  success: boolean
  errorMessage?: string
  executionTimeMs?: number
}): number {
  const stmt = db.prepare(`
    INSERT INTO automation_logs (
      rule_id, rule_name, device_id, device_serial,
      trigger_details, actions_executed, success,
      error_message, execution_time_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `)
  const result = stmt.get(
    log.ruleId,
    log.ruleName ?? null,
    log.deviceId ?? null,
    log.deviceSerial ?? null,
    log.triggerDetails ? JSON.stringify(log.triggerDetails) : null,
    JSON.stringify(log.actionsExecuted),
    log.success ? 1 : 0,
    log.errorMessage ?? null,
    log.executionTimeMs ?? null
  ) as { id: number }
  return result.id
}

export function getAutomationLogs(options: {
  ruleId?: number
  deviceId?: number
  limit?: number
  offset?: number
}): AutomationLogRow[] {
  const { ruleId, deviceId, limit = 100, offset = 0 } = options

  let query = 'SELECT * FROM automation_logs WHERE 1=1'
  const params: (number | string)[] = []

  if (ruleId !== undefined) {
    query += ' AND rule_id = ?'
    params.push(ruleId)
  }
  if (deviceId !== undefined) {
    query += ' AND device_id = ?'
    params.push(deviceId)
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  return db.prepare(query).all(...params) as AutomationLogRow[]
}

export function cleanupAutomationLogs(retentionDays: number = 30): void {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
  const cutoff = cutoffDate.toISOString()

  db.prepare('DELETE FROM automation_logs WHERE timestamp < ?').run(cutoff)
}

// ==================== Resilience Settings ====================

export interface ResilienceSettingsRow {
  id: number
  device_id: number | null
  enabled: number
  /** 'hybrid' or 'grid', see ResilienceMode. */
  mode: string
  auto_ac: number
  notify_slack: number
  region_id: number | null
  dso_id: number | null
  outage_group: string | null
  warning_lead_minutes: number
  recovery_delay_minutes: number
  min_soc: number
  reserve_soc: number
  battery_capacity_wh: number
  inverter_efficiency: number
  load_profile: string
  ac_off_max_watts: number
  updated_at: string
}

export function getResilienceSettings(): ResilienceSettingsRow | undefined {
  return db.prepare('SELECT * FROM resilience_settings WHERE id = 1').get() as ResilienceSettingsRow | undefined
}

export function upsertResilienceSettings(values: Omit<ResilienceSettingsRow, 'id' | 'updated_at'>): void {
  db.prepare(`
    INSERT INTO resilience_settings (
      id, device_id, enabled, mode, auto_ac, notify_slack, region_id, dso_id, outage_group,
      warning_lead_minutes, recovery_delay_minutes, min_soc, reserve_soc,
      battery_capacity_wh, inverter_efficiency, load_profile, ac_off_max_watts, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      device_id=excluded.device_id, enabled=excluded.enabled, mode=excluded.mode, auto_ac=excluded.auto_ac,
      notify_slack=excluded.notify_slack,
      region_id=excluded.region_id, dso_id=excluded.dso_id, outage_group=excluded.outage_group,
      warning_lead_minutes=excluded.warning_lead_minutes,
      recovery_delay_minutes=excluded.recovery_delay_minutes,
      min_soc=excluded.min_soc, reserve_soc=excluded.reserve_soc,
      battery_capacity_wh=excluded.battery_capacity_wh,
      inverter_efficiency=excluded.inverter_efficiency,
      load_profile=excluded.load_profile, ac_off_max_watts=excluded.ac_off_max_watts,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    values.device_id, values.enabled, values.mode, values.auto_ac, values.notify_slack, values.region_id, values.dso_id,
    values.outage_group, values.warning_lead_minutes, values.recovery_delay_minutes,
    values.min_soc, values.reserve_soc, values.battery_capacity_wh,
    values.inverter_efficiency, values.load_profile, values.ac_off_max_watts
  )
}

export interface ResilienceAcStateRow {
  owns_ac: number
  last_risk_at_ms: number
}

export function getResilienceAcState(deviceId: number): ResilienceAcStateRow | undefined {
  return db.prepare('SELECT owns_ac, last_risk_at_ms FROM resilience_ac_state WHERE device_id = ?')
    .get(deviceId) as ResilienceAcStateRow | undefined
}

export function saveResilienceAcState(deviceId: number, row: ResilienceAcStateRow): void {
  db.prepare(`
    INSERT INTO resilience_ac_state (device_id, owns_ac, last_risk_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      owns_ac=excluded.owns_ac, last_risk_at_ms=excluded.last_risk_at_ms, updated_at_ms=excluded.updated_at_ms
  `).run(deviceId, row.owns_ac, row.last_risk_at_ms, Date.now())
}

/** Name of the newest successful AC command logged for a device, from the panel or the outage automation. */
export function getLastAcCommand(deviceId: number): string | undefined {
  const row = db.prepare(`
    SELECT operation_name FROM operation_logs
    WHERE device_id = ? AND operation_type = 'COMMAND' AND success = 1
      AND operation_name IN ('setAcOutput', 'resilienceAcOn', 'resilienceAcOff')
    ORDER BY timestamp DESC, id DESC LIMIT 1
  `).get(deviceId) as { operation_name: string } | undefined
  return row?.operation_name
}

// ==================== Grid timeline & load history ====================

export interface GridMinuteRow {
  minute: number
  grid_on: number
  load_wh: number
  ecoflow_seconds: number
}

export function upsertGridMinute(deviceId: number, row: GridMinuteRow): void {
  db.prepare(`
    INSERT INTO grid_minutes (device_id, minute, grid_on, load_wh, ecoflow_seconds)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(device_id, minute) DO UPDATE SET
      grid_on=excluded.grid_on, load_wh=excluded.load_wh, ecoflow_seconds=excluded.ecoflow_seconds
  `).run(deviceId, row.minute, row.grid_on, row.load_wh, row.ecoflow_seconds)
}

export function getGridMinutes(deviceId: number, fromMinute: number, toMinute: number): GridMinuteRow[] {
  return db.prepare(`
    SELECT minute, grid_on, load_wh, ecoflow_seconds FROM grid_minutes
    WHERE device_id = ? AND minute >= ? AND minute < ?
    ORDER BY minute
  `).all(deviceId, fromMinute, toMinute) as GridMinuteRow[]
}

export function getLastGridMinute(deviceId: number): GridMinuteRow | undefined {
  return db.prepare(`
    SELECT minute, grid_on, load_wh, ecoflow_seconds FROM grid_minutes
    WHERE device_id = ? ORDER BY minute DESC LIMIT 1
  `).get(deviceId) as GridMinuteRow | undefined
}

/**
 * Where the grid state that ends at `lastMinute` began, and what was drawn since,
 * so an outage in progress survives a restart. Looks back at most `maxMinutes`.
 */
export function getGridEpisodeStart(deviceId: number, gridOn: number, lastMinute: number, maxMinutes: number): {
  startMinute: number; loadWh: number; ecoflowSeconds: number
} {
  const floor = lastMinute - maxMinutes
  const changed = db.prepare(`
    SELECT MAX(minute) AS minute FROM grid_minutes
    WHERE device_id = ? AND grid_on != ? AND minute >= ? AND minute <= ?
  `).get(deviceId, gridOn, floor, lastMinute) as { minute: number | null }
  const first = db.prepare(`
    SELECT MIN(minute) AS minute FROM grid_minutes WHERE device_id = ? AND minute >= ?
  `).get(deviceId, floor) as { minute: number | null }
  const startMinute = changed.minute !== null ? changed.minute + 1 : first.minute ?? lastMinute
  const totals = db.prepare(`
    SELECT COALESCE(SUM(load_wh), 0) AS loadWh, COALESCE(SUM(ecoflow_seconds), 0) AS ecoflowSeconds
    FROM grid_minutes WHERE device_id = ? AND minute >= ? AND minute <= ?
  `).get(deviceId, startMinute, lastMinute) as { loadWh: number; ecoflowSeconds: number }
  return { startMinute, ...totals }
}

export interface OutageScheduleDayRow {
  day: string
  source: string
  status: string | null
  slots: string
}

export function upsertOutageScheduleDay(row: OutageScheduleDayRow & { outage_group: string }): void {
  db.prepare(`
    INSERT INTO outage_schedule_days (day, source, outage_group, status, slots, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(day, source, outage_group) DO UPDATE SET
      status=excluded.status, slots=excluded.slots, updated_at=CURRENT_TIMESTAMP
  `).run(row.day, row.source, row.outage_group, row.status, row.slots)
}

export function getOutageScheduleDays(outageGroup: string, fromDay: string, toDay: string): OutageScheduleDayRow[] {
  return db.prepare(`
    SELECT day, source, status, slots FROM outage_schedule_days
    WHERE outage_group = ? AND day >= ? AND day <= ?
  `).all(outageGroup, fromDay, toDay) as OutageScheduleDayRow[]
}

/**
 * Consumer load in 15-minute UTC buckets (each fits inside one 30-minute Kyiv
 * slot). Only samples with AC output count: while AC is off the outputs read 0 W,
 * which says nothing about what the household would draw during an outage.
 */
export function getLoadBuckets(deviceId: number, fromIso: string): Array<{ bucketStartMs: number; wattsSum: number; samples: number }> {
  return db.prepare(`
    SELECT
      (CAST(strftime('%s', timestamp) AS INTEGER) / 900) * 900000 AS bucketStartMs,
      SUM(COALESCE(ac_output_watts, 0) + COALESCE(dc_output_watts, 0)) AS wattsSum,
      COUNT(*) AS samples
    FROM device_states
    WHERE device_id = ? AND timestamp >= ? AND ac_output_watts > 0
    GROUP BY CAST(strftime('%s', timestamp) AS INTEGER) / 900
  `).all(deviceId, toSqliteTimestamp(fromIso)) as Array<{ bucketStartMs: number; wattsSum: number; samples: number }>
}

// ==================== Slack Settings ====================

export function getSlackSettings(): SlackSettingsRow | undefined {
  return db.prepare('SELECT * FROM slack_settings ORDER BY id LIMIT 1').get() as SlackSettingsRow | undefined
}

export function upsertSlackSettings(dto: UpdateSlackSettingsDto): number {
  const existing = getSlackSettings()

  if (existing) {
    const updates: string[] = []
    const params: (string | number | null)[] = []

    if (dto.webhookUrl !== undefined) {
      updates.push('webhook_url = ?')
      params.push(dto.webhookUrl || null)
    }
    if (dto.incomingSecret !== undefined) {
      updates.push('incoming_secret = ?')
      params.push(dto.incomingSecret || null)
    }
    if (dto.defaultChannel !== undefined) {
      updates.push('default_channel = ?')
      params.push(dto.defaultChannel || null)
    }
    if (dto.enabled !== undefined) {
      updates.push('enabled = ?')
      params.push(dto.enabled ? 1 : 0)
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP')
      params.push(existing.id)
      db.prepare(`
        UPDATE slack_settings
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params)
    }

    return existing.id
  } else {
    const stmt = db.prepare(`
      INSERT INTO slack_settings (webhook_url, incoming_secret, default_channel, enabled)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `)
    const result = stmt.get(
      dto.webhookUrl || null,
      dto.incomingSecret || null,
      dto.defaultChannel || null,
      dto.enabled ? 1 : 0
    ) as { id: number }
    return result.id
  }
}
