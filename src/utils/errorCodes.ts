/**
 * EcoFlow DELTA Pro error / status codes.
 *
 * What is actually known (researched Oct 2026):
 * - EcoFlow's developer doc lists `bmsMaster.errCode`, `inv.errCode`, `pd.errCode`
 *   only as "Global error code" without values. The DELTA Pro manual says "refer to
 *   the EcoFlow app for specific error codes" and prints none.
 * - `*.errCode` is an enum, not a bitmask. 5, 6 and 23 appear in normal operation
 *   (6 = charge complete, 23 = stopped at the user's max-charge limit).
 * - `mppt.faultCode` is byte-coded: solar | car-12V << 8 | DC-24V << 16.
 * - `ems.emsIsNormalFlag` 0 means *sleep*, not a fault.
 * - `bmsMaster.bmsFault` (permanent BMS fault) and `ems.bmsWarningState`
 *   (bit0 high temp, bit1 low temp, bit2 overload) are documented officially and
 *   are the most reliable fault signals.
 * - Numeric app codes (077, 102, 301-303) come from EcoFlow retailer FAQs; that
 *   they are reported through these exact fields is likely but not confirmed.
 * Lists of "E01-E14" codes on blogs are unsourced and deliberately not used.
 *
 * Status codes must stay in sync with server/src/lib/errorClassification.ts.
 */
import type { DeviceErrorCodes, LastKnownErrors } from '@/types/device'

export type ErrorSeverity = 'error' | 'warning' | 'info'
export type ErrorConfidence = 'official' | 'community' | 'unverified'

export interface ErrorCodeInfo {
  code: number | string
  title: string
  description: string
  causes: string[]
  solutions: string[]
  severity: ErrorSeverity
  confidence: ErrorConfidence
  youtubeUrl?: string
  docsUrl?: string
}

export type ErrorType =
  | 'bms'
  | 'inv'
  | 'mppt'
  | 'overload'
  | 'ems'
  | 'battery'
  /** bmsMaster.bmsFault, any non-zero value */
  | 'bmsFault'
  /** ems.bmsWarningState, `code` is the bit index */
  | 'bmsWarning'

const SUPPORT_URL = 'https://www.ecoflow.com/support'
const MANUAL_URL = 'https://websiteoss.ecoflow.com/cms/upload/2022/10/12/1312845623_1665543468829.pdf'

const CONFIDENCE_LABELS: Record<ErrorConfidence, string> = {
  official: 'EcoFlow documentation',
  community: 'EcoFlow support / community reports',
  unverified: 'Community reports (unverified)',
}

export function getConfidenceLabel(confidence: ErrorConfidence): string {
  return CONFIDENCE_LABELS[confidence]
}

// ---------------------------------------------------------------- BMS (main + extra batteries)

const BMS_CODES: Record<number, ErrorCodeInfo> = {
  5: {
    code: 5,
    title: 'Standby / charging paused',
    description: 'The battery is idle or charging is paused by the system. Seen during normal operation.',
    causes: ['No charging source connected or charging finished', 'Charging paused by the energy management system'],
    solutions: ['No action needed'],
    severity: 'info',
    confidence: 'unverified',
  },
  6: {
    code: 6,
    title: 'Fully charged',
    description: 'The battery reached 100% and charging has stopped. This is a status message, not a fault.',
    causes: ['Battery reached full capacity'],
    solutions: ['No action needed - normal operation'],
    severity: 'info',
    confidence: 'community',
  },
  23: {
    code: 23,
    title: 'Charged to your limit',
    description: 'Charging stopped because the battery reached the Max Charge Level set in the app or here. This is a status message, not a fault.',
    causes: ['Battery reached the configured maximum charge level'],
    solutions: ['No action needed - normal operation', 'To charge higher, raise "Max Charge Level" in Charge Settings'],
    severity: 'info',
    confidence: 'community',
  },
}

// Codes shown in the EcoFlow app for DELTA Pro (retailer / support FAQ).
const APP_CODES: Record<number, ErrorCodeInfo> = {
  18: {
    code: 18,
    title: 'Charging failure',
    description: 'The station could not start charging (reported at 0% battery).',
    causes: ['Battery deeply discharged', 'Firmware issue'],
    solutions: ['Update the firmware in the EcoFlow app', 'Try charging from AC (wall) power', 'Contact EcoFlow support if it persists'],
    severity: 'warning',
    confidence: 'unverified',
  },
  25: {
    code: 25,
    title: 'Insufficient charging power',
    description: 'The input source cannot deliver enough power to charge.',
    causes: ['Weak generator or solar input', 'Charging power set too high for the source'],
    solutions: ['Lower the AC charging power', 'Use a stronger input source'],
    severity: 'warning',
    confidence: 'unverified',
  },
  77: {
    code: 77,
    title: 'Cell voltage imbalance',
    description: 'The voltage difference between battery cells is too large.',
    causes: ['Long storage without charging', 'Extreme temperatures', 'Cell ageing'],
    solutions: [
      'Long-press the power button for 10 s, wait 30 minutes and turn the station on again',
      'Charge to 100% and let it rest a few hours so cells can balance',
      'Contact EcoFlow support if it comes back',
    ],
    severity: 'warning',
    confidence: 'community',
  },
  102: {
    code: 102,
    title: 'Cell undervoltage - discharge blocked',
    description: 'A battery cell is below the safe voltage, so output is disabled to protect the battery.',
    causes: ['Battery fully drained', 'Stored for a long time without charging'],
    solutions: ['Connect AC charging as soon as possible', 'Do not leave the battery empty', 'Contact EcoFlow support if it will not charge'],
    severity: 'error',
    confidence: 'community',
  },
  115: {
    code: 115,
    title: 'Low temperature alarm',
    description: 'Temperature is too low for normal operation. Charging is allowed from 0 °C, discharging from -10 °C.',
    causes: ['Station kept in a cold place'],
    solutions: ['Move the station somewhere warmer; it resumes on its own once warm (charging resumes above 5 °C)'],
    severity: 'warning',
    confidence: 'unverified',
  },
  301: {
    code: 301,
    title: 'Cell undervoltage',
    description: 'One or more battery cells are below the recommended voltage.',
    causes: ['Deep discharge', 'Long storage without a maintenance charge'],
    solutions: ['Recharge promptly', 'Keep the battery above the minimum discharge level'],
    severity: 'warning',
    confidence: 'community',
  },
  302: {
    code: 302,
    title: 'BMS communication lost',
    description: 'The main board lost contact with the battery management system. Also appears briefly during firmware updates.',
    causes: ['Firmware update in progress', 'Internal communication glitch', 'Loose extra battery cable'],
    solutions: ['Restart the station', 'Reseat the extra battery cable (power off first)', 'Contact EcoFlow support if it persists'],
    severity: 'warning',
    confidence: 'community',
  },
  303: {
    code: 303,
    title: 'Inverter communication lost',
    description: 'The main board lost contact with the inverter.',
    causes: ['Firmware update in progress', 'Internal communication glitch'],
    solutions: ['Restart the station', 'Contact EcoFlow support if it persists'],
    severity: 'warning',
    confidence: 'community',
  },
}

const INV_APP_CODES = [115, 302, 303]

// ---------------------------------------------------------------- solar / DC (mppt.faultCode)

const MPPT_BYTES = [
  { shift: 0, label: 'Solar input (MPPT)' },
  { shift: 8, label: '12 V car output' },
  { shift: 16, label: 'DC 24 V output' },
]

function mpptInfo(code: number): ErrorCodeInfo {
  // 0x1000 is a steady value seen during normal use (car-output byte)
  if (code === 4096) {
    return {
      code,
      title: 'DC output status flag',
      description: 'A steady status value on the 12 V car output channel seen during normal use, not a fault.',
      causes: ['Normal operation'],
      solutions: ['No action needed'],
      severity: 'info',
      confidence: 'community',
    }
  }
  const parts = MPPT_BYTES
    .map(({ shift, label }) => ({ label, value: (code >> shift) & 0xff }))
    .filter((part) => part.value !== 0)
  const where = parts.map((p) => `${p.label} (0x${p.value.toString(16)})`).join(', ') || 'unknown channel'
  return {
    code,
    title: parts.length === 1 ? `${parts[0].label} fault` : 'Solar / DC fault',
    description: `The DC controller reports a fault on: ${where}. EcoFlow does not publish the individual flag meanings.`,
    causes: [
      'Solar voltage outside the 11-150 V input range or reversed polarity',
      'Overload or short circuit on the 12 V car / DC5521 outputs',
      'DC controller overheating',
    ],
    solutions: [
      'Disconnect solar panels and DC loads, then reconnect one by one',
      'Check panel wiring (series voltage, polarity) and cables',
      'Restart the station; contact support if it persists',
    ],
    severity: 'warning',
    confidence: 'official',
  }
}

// ---------------------------------------------------------------- other signals

const BMS_FAULT_INFO: ErrorCodeInfo = {
  code: 'FAULT',
  title: 'Battery failure',
  description: 'The battery management system reports a permanent fault (the "battery failure" icon stays on).',
  causes: ['Internal battery fault'],
  solutions: ['Stop charging and discharging the station', 'Restart it once; if the fault remains, contact EcoFlow support'],
  severity: 'error',
  confidence: 'official',
  docsUrl: MANUAL_URL,
}

const BMS_WARNING_BITS: Record<number, ErrorCodeInfo> = {
  0: {
    code: 'HI-TEMP',
    title: 'High temperature protection',
    description: 'The battery is too hot, so charging or discharging is limited until it cools down.',
    causes: ['High ambient temperature', 'Blocked vents', 'Long high-power use'],
    solutions: ['Improve ventilation and move out of the sun', 'Reduce the load; the station resumes after cooling'],
    severity: 'warning',
    confidence: 'official',
    docsUrl: MANUAL_URL,
  },
  1: {
    code: 'LOW-TEMP',
    title: 'Low temperature protection',
    description: 'The battery is too cold. Charging resumes above 5 °C, discharging above -12 °C.',
    causes: ['Station kept in a cold place'],
    solutions: ['Move the station somewhere warmer and let it warm up naturally'],
    severity: 'warning',
    confidence: 'official',
    docsUrl: MANUAL_URL,
  },
  2: {
    code: 'OVERLOAD',
    title: 'Battery overload protection',
    description: 'The battery is asked for more current than it can safely deliver.',
    causes: ['Total load above the rated output', 'High inrush current from motors/compressors'],
    solutions: ['Disconnect some loads', 'Start high-power appliances one at a time'],
    severity: 'warning',
    confidence: 'official',
  },
}

const OVERLOAD_INFO: ErrorCodeInfo = {
  code: 'OVERLOAD',
  title: 'Output overload',
  description: 'The overload icon is on: connected loads exceed what the outputs can deliver.',
  causes: ['Load above 3600 W on AC (or above the X-Boost limit)', 'USB or car port overload', 'Inrush current from appliances'],
  solutions: ['Remove some loads and restart the output', 'Stay within the rated power of each port'],
  severity: 'warning',
  confidence: 'official',
  docsUrl: MANUAL_URL,
}

const EMS_SLEEP_INFO: ErrorCodeInfo = {
  code: 'SLEEP',
  title: 'Energy management in sleep mode',
  description: 'The EMS reports sleep mode (emsIsNormalFlag = 0). This is a power-saving state, not a fault.',
  causes: ['Station idle with no load or charging'],
  solutions: ['No action needed'],
  severity: 'info',
  confidence: 'official',
}

function unknownCode(code: number, where: string): ErrorCodeInfo {
  return {
    code,
    title: `Unrecognised ${where} code ${code}`,
    description: `The ${where} reported code ${code}. EcoFlow does not publish a list of these values, so its meaning is unknown.`,
    causes: ['Check the EcoFlow app or the station screen for the matching message'],
    solutions: [
      'Look at the station display / EcoFlow app for details',
      'If it persists for more than a few minutes, restart the station',
      'Contact EcoFlow support with this code if it keeps coming back',
    ],
    severity: 'warning',
    confidence: 'unverified',
  }
}

function withLinks(info: ErrorCodeInfo): ErrorCodeInfo {
  return {
    docsUrl: SUPPORT_URL,
    youtubeUrl: info.severity === 'info'
      ? undefined
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(`ecoflow delta pro ${info.title}`)}`,
    ...info,
  }
}

/**
 * Description of a code. Never throws; unknown codes get a generic warning.
 */
export function getErrorInfo(type: ErrorType, code: number): ErrorCodeInfo {
  switch (type) {
    case 'bms':
    case 'battery':
      return withLinks(BMS_CODES[code] ?? APP_CODES[code] ?? unknownCode(code, type === 'battery' ? 'extra battery' : 'battery (BMS)'))
    case 'inv':
      // Only the app codes that concern the inverter side
      return withLinks((INV_APP_CODES.includes(code) ? APP_CODES[code] : undefined) ?? unknownCode(code, 'inverter'))
    case 'mppt':
      return withLinks(mpptInfo(code))
    case 'overload':
      return withLinks(OVERLOAD_INFO)
    case 'ems':
      return EMS_SLEEP_INFO
    case 'bmsFault':
      return withLinks({ ...BMS_FAULT_INFO, code })
    case 'bmsWarning':
      return withLinks(BMS_WARNING_BITS[code] ?? unknownCode(code, 'battery warning bit'))
  }
}

/** null = no issue (code 0) */
export function getErrorSeverity(type: ErrorType, code: number | undefined | null): ErrorSeverity | null {
  if (code === undefined || code === null) return null
  if (type !== 'ems' && type !== 'bmsWarning' && code === 0) return null
  return getErrorInfo(type, code).severity
}

/** True for warnings and errors; false for 0 and for status codes like "fully charged" */
export function isRealError(type: ErrorType, code: number | undefined | null): boolean {
  const severity = getErrorSeverity(type, code)
  return severity === 'error' || severity === 'warning'
}

export interface DeviceIssue {
  key: string
  source: string
  type: ErrorType
  code: number
  value: string
  info: ErrorCodeInfo
}

/** Every non-zero signal in the device error fields, status messages included. */
export function collectDeviceIssues(errorCodes: DeviceErrorCodes | LastKnownErrors): DeviceIssue[] {
  const issues: DeviceIssue[] = []
  const add = (key: string, source: string, type: ErrorType, code: number, value: string = String(code)) => {
    issues.push({ key, source, type, code, value, info: getErrorInfo(type, code) })
  }

  if (errorCodes.bmsFault) add('bmsFault', 'Battery', 'bmsFault', errorCodes.bmsFault, 'Fault')
  if (errorCodes.bmsMasterErrCode) add('bms', 'Main battery', 'bms', errorCodes.bmsMasterErrCode)
  const lastKnown = errorCodes as LastKnownErrors
  if (lastKnown.bmsSlave1ErrCode) add('slave1', 'Extra battery 1', 'battery', lastKnown.bmsSlave1ErrCode)
  if (lastKnown.bmsSlave2ErrCode) add('slave2', 'Extra battery 2', 'battery', lastKnown.bmsSlave2ErrCode)
  if (errorCodes.invErrCode) add('inv', 'Inverter', 'inv', errorCodes.invErrCode)
  if (errorCodes.mpptFaultCode) add('mppt', 'Solar / DC', 'mppt', errorCodes.mpptFaultCode)
  if (errorCodes.overloadState) add('overload', 'Outputs', 'overload', errorCodes.overloadState, 'Active')
  for (const bit of [0, 1, 2]) {
    if (((errorCodes.bmsWarningState ?? 0) >> bit) & 1) {
      add(`bmsWarning${bit}`, 'Battery', 'bmsWarning', bit, BMS_WARNING_BITS[bit].code as string)
    }
  }
  if (errorCodes.emsIsNormal === false) add('ems', 'EMS', 'ems', 0, 'Sleep')

  return issues
}

const SEVERITY_RANK: Record<ErrorSeverity, number> = { info: 0, warning: 1, error: 2 }

export function highestSeverity(issues: DeviceIssue[]): ErrorSeverity | null {
  return issues.reduce<ErrorSeverity | null>(
    (worst, issue) => (worst === null || SEVERITY_RANK[issue.info.severity] > SEVERITY_RANK[worst] ? issue.info.severity : worst),
    null
  )
}
