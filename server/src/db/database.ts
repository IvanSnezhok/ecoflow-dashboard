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

  // Run migrations for new columns
  migrateDatabase()

  console.log('Database initialized')
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
  ]

  for (const col of newColumns) {
    if (!existingColumns.has(col.name)) {
      db.exec(`ALTER TABLE device_states ADD COLUMN ${col.name} ${col.type}`)
      console.log(`Migration: Added column ${col.name} to device_states`)
    }
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
    batterySoc: number
    batteryWatts: number
    acInputWatts: number
    solarInputWatts: number
    acOutputWatts: number
    dcOutputWatts: number
    temperature: number
    rawData: string
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
  const stmt = db.prepare(`
    INSERT INTO device_states (
      device_id, battery_soc, battery_watts, ac_input_watts,
      solar_input_watts, ac_output_watts, dc_output_watts,
      temperature, raw_data,
      bms_master_vol, extra_battery1_soc, extra_battery1_temp, extra_battery1_vol,
      extra_battery2_soc, extra_battery2_temp, extra_battery2_vol
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    state.rawData,
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

// Get last known error codes for a device (for offline state)
export interface LastKnownErrors {
  bmsMasterErrCode: number;
  invErrCode: number;
  mpptFaultCode: number;
  overloadState: number;
  emsIsNormal: boolean;
  bmsSlave1ErrCode?: number;
  bmsSlave2ErrCode?: number;
  timestamp: string;
}

export function getLastKnownErrors(deviceId: number): LastKnownErrors | null {
  const state = db.prepare(`
    SELECT raw_data, timestamp FROM device_states
    WHERE device_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(deviceId) as { raw_data: string; timestamp: string } | undefined;

  if (!state || !state.raw_data) return null;

  try {
    const rawData = JSON.parse(state.raw_data);
    return {
      bmsMasterErrCode: rawData["bmsMaster.errCode"] ?? 0,
      invErrCode: rawData["inv.errCode"] ?? 0,
      mpptFaultCode: rawData["mppt.faultCode"] ?? 0,
      overloadState: rawData["pd.iconOverloadState"] ?? 0,
      emsIsNormal: (rawData["ems.emsIsNormalFlag"] ?? 1) === 1,
      bmsSlave1ErrCode: rawData["bmsSlave1.errCode"],
      bmsSlave2ErrCode: rawData["bmsSlave2.errCode"],
      timestamp: state.timestamp,
    };
  } catch {
    return null;
  }
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
        temperature,
        bms_master_vol as bmsMasterVol,
        extra_battery1_soc as extraBattery1Soc,
        extra_battery1_temp as extraBattery1Temp,
        extra_battery1_vol as extraBattery1Vol,
        extra_battery2_soc as extraBattery2Soc,
        extra_battery2_temp as extraBattery2Temp,
        extra_battery2_vol as extraBattery2Vol
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
        ROUND(AVG(temperature), 1) as temperature,
        ROUND(AVG(bms_master_vol)) as bmsMasterVol,
        ROUND(AVG(extra_battery1_soc)) as extraBattery1Soc,
        ROUND(AVG(extra_battery1_temp), 1) as extraBattery1Temp,
        ROUND(AVG(extra_battery1_vol)) as extraBattery1Vol,
        ROUND(AVG(extra_battery2_soc)) as extraBattery2Soc,
        ROUND(AVG(extra_battery2_temp), 1) as extraBattery2Temp,
        ROUND(AVG(extra_battery2_vol)) as extraBattery2Vol
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
        ROUND(AVG(temperature), 1) as temperature,
        ROUND(AVG(bms_master_vol)) as bmsMasterVol,
        ROUND(AVG(extra_battery1_soc)) as extraBattery1Soc,
        ROUND(AVG(extra_battery1_temp), 1) as extraBattery1Temp,
        ROUND(AVG(extra_battery1_vol)) as extraBattery1Vol,
        ROUND(AVG(extra_battery2_soc)) as extraBattery2Soc,
        ROUND(AVG(extra_battery2_temp), 1) as extraBattery2Temp,
        ROUND(AVG(extra_battery2_vol)) as extraBattery2Vol
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
      ROUND(AVG(temperature), 1) as temperature,
      ROUND(AVG(bms_master_vol)) as bmsMasterVol,
      ROUND(AVG(extra_battery1_soc)) as extraBattery1Soc,
      ROUND(AVG(extra_battery1_temp), 1) as extraBattery1Temp,
      ROUND(AVG(extra_battery1_vol)) as extraBattery1Vol,
      ROUND(AVG(extra_battery2_soc)) as extraBattery2Soc,
      ROUND(AVG(extra_battery2_temp), 1) as extraBattery2Temp,
      ROUND(AVG(extra_battery2_vol)) as extraBattery2Vol
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

// Error history for devices
export type ErrorType = 'bms' | 'inv' | 'mppt' | 'overload' | 'ems' | 'extraBattery1' | 'extraBattery2';

export interface ErrorHistoryEntry {
  timestamp: string;
  errorType: ErrorType;
  errorCode: number;
}

export function getErrorHistory(deviceId: number, limit: number = 100): ErrorHistoryEntry[] {
  const states = db.prepare(`
    SELECT raw_data, timestamp
    FROM device_states
    WHERE device_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(deviceId, limit * 10) as Array<{ raw_data: string; timestamp: string }>;

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
    if (!state.raw_data) continue;

    try {
      const data = JSON.parse(state.raw_data);

      // BMS codes that indicate battery state, not errors
      // 5 = discharged state, 23 = charged state
      const BMS_STATE_CODES = new Set([5, 23]);

      for (const { type, field } of errorFields) {
        const code = data[field];
        if (code && code !== 0) {
          // Skip BMS state codes (not actual errors)
          if (type === 'bms' && BMS_STATE_CODES.has(code)) continue;

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
    } catch {
      // Skip invalid JSON
    }
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

  console.log(`Cleaned up data older than ${retentionDays} days`)
}
