// Data access check: whether the EcoFlow Open API serves a device's data, channel by
// channel. A device can be in the cloud list and still have its quota refused (code
// 1006), e.g. one shared from another account; the check tells that apart from a
// panel bug. This module is the pure part; dataAccessProbe.ts talks to the cloud.
import { EcoflowApiError } from "../lib/ecoflowApiError.js";
import { replyMessageFields } from "./mqttQuota.js";

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
  /** Most fields in a single message: a full snapshot has hundreds, a push a handful */
  maxFields: number;
}

/** One format of full-quota request sent to /get, and what came back on /get_reply */
export interface ProbeGet {
  variant: string;
  sent: number;
  /** get_reply messages answering this request (matched by id) */
  replies: number;
  /** Most quota fields in one of those replies */
  fieldCount: number;
  /** From a reply that carried no quota, e.g. a refusal */
  code?: string;
  message?: string;
}

export interface ProbeMqtt {
  quota: ProbeTopic;
  status: ProbeTopic;
  getReply: ProbeTopic;
  gets: ProbeGet[];
  /** Messages on the device's other topics, by topic suffix (when a wildcard is allowed) */
  otherTopics: Record<string, number>;
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
  mqtt: ProbeMqtt | null;
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
  /** How the probe subscribed: one wildcard for all device topics, or topic by topic */
  mqttSubscription: "wildcard" | "topics" | null;
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

/** Count one message on a topic: how many, which field names, the most fields at once. */
export function countTopicMessage(topic: ProbeTopic, message: unknown, maxKeys = 25): void {
  topic.messages++;
  const fields = replyMessageFields(message) ?? (message && typeof message === "object" ? message : {});
  const keys = Object.keys(fields);
  topic.maxFields = Math.max(topic.maxFields, keys.length);
  for (const key of keys) {
    if (topic.keys.length < maxKeys && !topic.keys.includes(key)) topic.keys.push(key);
  }
}

/** Credit a get_reply to the request it answers (matched by id) and note what it carried. */
export function recordGetReply(sent: Map<string, ProbeGet>, message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const reply = message as Record<string, unknown>;
  const get = reply.id !== undefined ? sent.get(String(reply.id)) : undefined;
  if (!get) return false;
  get.replies++;
  const fields = replyMessageFields(reply);
  if (fields) {
    get.fieldCount = Math.max(get.fieldCount, Object.keys(fields).length);
  } else {
    if (reply.code !== undefined) get.code = String(reply.code);
    if (typeof reply.message === "string") get.message = reply.message;
  }
  return true;
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
