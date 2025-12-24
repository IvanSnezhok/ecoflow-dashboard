import Database, { type Database as DatabaseType } from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, '../../data/ecoflow.db')

export const db: DatabaseType = new Database(dbPath)

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

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_device_states_device_timestamp
      ON device_states(device_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_device_timestamp
      ON operation_logs(device_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_type
      ON operation_logs(operation_type);
  `)

  console.log('Database initialized')
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
    batterySoc: number
    batteryWatts: number
    acInputWatts: number
    solarInputWatts: number
    acOutputWatts: number
    dcOutputWatts: number
    temperature: number
    rawData: string
  }
) {
  const stmt = db.prepare(`
    INSERT INTO device_states (
      device_id, battery_soc, battery_watts, ac_input_watts,
      solar_input_watts, ac_output_watts, dc_output_watts,
      temperature, raw_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    state.rawData
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

// Historical data for charts
export interface HistoryDataPoint {
  timestamp: string
  batterySoc: number
  batteryWatts: number
  acInputWatts: number
  solarInputWatts: number
  acOutputWatts: number
  dcOutputWatts: number
  temperature: number
}

export type AggregationType = 'none' | '1min' | '5min' | '15min' | '1hour' | '6hour'

// Convert ISO timestamp to SQLite format (2025-12-23T17:30:23.335Z -> 2025-12-23 17:30:23)
function toSqliteTimestamp(isoString: string): string {
  return isoString.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '')
}

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
    const rows = db.prepare(`
      SELECT
        timestamp,
        battery_soc as batterySoc,
        battery_watts as batteryWatts,
        ac_input_watts as acInputWatts,
        solar_input_watts as solarInputWatts,
        ac_output_watts as acOutputWatts,
        dc_output_watts as dcOutputWatts,
        temperature
      FROM device_states
      WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(deviceId, sqliteFrom, sqliteTo) as HistoryDataPoint[]
    return rows
  }

  // Determine the strftime format based on aggregation level
  let groupFormat: string
  switch (aggregation) {
    case '1min':
      groupFormat = '%Y-%m-%dT%H:%M:00'
      break
    case '5min':
      // Round to 5-minute intervals
      groupFormat = '%Y-%m-%dT%H:'
      break
    case '15min':
      groupFormat = '%Y-%m-%dT%H:'
      break
    case '1hour':
      groupFormat = '%Y-%m-%dT%H:00:00'
      break
    case '6hour':
      groupFormat = '%Y-%m-%dT'
      break
    default:
      groupFormat = '%Y-%m-%dT%H:%M:00'
  }

  // For 5min and 15min, we need special handling
  if (aggregation === '5min' || aggregation === '15min') {
    const interval = aggregation === '5min' ? 5 : 15
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:', timestamp) ||
          printf('%02d', (CAST(strftime('%M', timestamp) AS INTEGER) / ${interval}) * ${interval}) ||
          ':00' as timestamp,
        ROUND(AVG(battery_soc)) as batterySoc,
        ROUND(AVG(battery_watts)) as batteryWatts,
        ROUND(AVG(ac_input_watts)) as acInputWatts,
        ROUND(AVG(solar_input_watts)) as solarInputWatts,
        ROUND(AVG(ac_output_watts)) as acOutputWatts,
        ROUND(AVG(dc_output_watts)) as dcOutputWatts,
        ROUND(AVG(temperature), 1) as temperature
      FROM device_states
      WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
      GROUP BY strftime('%Y-%m-%dT%H:', timestamp) ||
        printf('%02d', (CAST(strftime('%M', timestamp) AS INTEGER) / ${interval}) * ${interval})
      ORDER BY timestamp ASC
    `).all(deviceId, sqliteFrom, sqliteTo) as HistoryDataPoint[]
    return rows
  }

  // For 6hour aggregation
  if (aggregation === '6hour') {
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m-%dT', timestamp) ||
          printf('%02d', (CAST(strftime('%H', timestamp) AS INTEGER) / 6) * 6) ||
          ':00:00' as timestamp,
        ROUND(AVG(battery_soc)) as batterySoc,
        ROUND(AVG(battery_watts)) as batteryWatts,
        ROUND(AVG(ac_input_watts)) as acInputWatts,
        ROUND(AVG(solar_input_watts)) as solarInputWatts,
        ROUND(AVG(ac_output_watts)) as acOutputWatts,
        ROUND(AVG(dc_output_watts)) as dcOutputWatts,
        ROUND(AVG(temperature), 1) as temperature
      FROM device_states
      WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
      GROUP BY strftime('%Y-%m-%dT', timestamp) ||
        printf('%02d', (CAST(strftime('%H', timestamp) AS INTEGER) / 6) * 6)
      ORDER BY timestamp ASC
    `).all(deviceId, sqliteFrom, sqliteTo) as HistoryDataPoint[]
    return rows
  }

  // Standard aggregation (1min, 1hour)
  const rows = db.prepare(`
    SELECT
      strftime('${groupFormat}', timestamp) as timestamp,
      ROUND(AVG(battery_soc)) as batterySoc,
      ROUND(AVG(battery_watts)) as batteryWatts,
      ROUND(AVG(ac_input_watts)) as acInputWatts,
      ROUND(AVG(solar_input_watts)) as solarInputWatts,
      ROUND(AVG(ac_output_watts)) as acOutputWatts,
      ROUND(AVG(dc_output_watts)) as dcOutputWatts,
      ROUND(AVG(temperature), 1) as temperature
    FROM device_states
    WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
    GROUP BY strftime('${groupFormat}', timestamp)
    ORDER BY timestamp ASC
  `).all(deviceId, sqliteFrom, sqliteTo) as HistoryDataPoint[]

  return rows
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

// Cleanup old data
export function cleanupOldData(retentionDays: number = 30): void {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
  const cutoff = cutoffDate.toISOString()

  db.prepare('DELETE FROM device_states WHERE timestamp < ?').run(cutoff)
  db.prepare('DELETE FROM operation_logs WHERE timestamp < ?').run(cutoff)

  console.log(`Cleaned up data older than ${retentionDays} days`)
}
