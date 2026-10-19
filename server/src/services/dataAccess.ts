// Data access check: whether the EcoFlow Open API serves a device's data, channel by
// channel. A device can be in the cloud list and still have its quota refused (code
// 1006), e.g. one shared from another account; the check tells that apart from a
// panel bug. This module is the pure part; dataAccessProbe.ts talks to the cloud.
import { EcoflowApiError } from "../lib/ecoflowApiError.js";

/** Battery and power fields of the DELTA family, asked for by the named-fields read. */
export const PROBE_FIELDS = [
  "pd.soc", "bmsMaster.soc", "inv.inputWatts", "inv.outputWatts", "mppt.inWatts", "bmsSlave1.soc", "bmsSlave2.soc",
];

export interface ProbeRead {
  ok: boolean;
  /** EcoFlow's code when it refused, e.g. "1006"; absent for network errors */
  code?: string;
  message?: string;
  fieldCount?: number;
  /** The PROBE_FIELDS the answer carried */
  sample?: Record<string, unknown>;
}

export interface ProbeTopic {
  subscribed: boolean;
  error?: string;
  messages: number;
  /** Field names seen in the messages, a few at most */
  keys: string[];
}

export interface DeviceProbe {
  serialNumber: string;
  name: string | null;
  productName: string | null;
  inList: boolean;
  cloudOnline: boolean;
  quotaAll: ProbeRead;
  quotaFields: ProbeRead;
  /** null when the MQTT broker could not be reached at all */
  mqtt: { quota: ProbeTopic; status: ProbeTopic } | null;
}

export type ProbeVerdict =
  | "data-available" // a REST read answered with data
  | "mqtt-only" // REST refused, but MQTT pushes quota messages
  | "refused" // listed and online, refused everywhere
  | "keys-failing" // the comparison device failed too: keys or cloud, not this device
  | "offline" // nothing to read while the cloud has the device offline
  | "not-listed"; // not in the device list for these keys

export interface DataAccessReport {
  checkedAt: string;
  listenSeconds: number;
  mqttError: string | null;
  target: DeviceProbe;
  /** Another online, supported device, read the same way */
  comparison: DeviceProbe | null;
  verdict: ProbeVerdict;
}

export function probeSuccess(data: unknown): ProbeRead {
  const quota = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const sample = Object.fromEntries(PROBE_FIELDS.filter((key) => key in quota).map((key) => [key, quota[key]]));
  return { ok: true, fieldCount: Object.keys(quota).length, sample };
}

export function probeFailure(error: unknown): ProbeRead {
  if (error instanceof EcoflowApiError) return { ok: false, code: error.code, message: error.apiMessage };
  return { ok: false, message: error instanceof Error ? error.message : String(error) };
}

const servesData = (probe: DeviceProbe): boolean =>
  probe.quotaAll.ok || probe.quotaFields.ok || (probe.mqtt?.quota.messages ?? 0) > 0;

export function probeVerdict(target: DeviceProbe, comparison: DeviceProbe | null): ProbeVerdict {
  if (target.quotaAll.ok || target.quotaFields.ok) return "data-available";
  if ((target.mqtt?.quota.messages ?? 0) > 0) return "mqtt-only";
  if (!target.inList) return "not-listed";
  if (!target.cloudOnline) return "offline";
  if (comparison && !servesData(comparison)) return "keys-failing";
  return "refused";
}
