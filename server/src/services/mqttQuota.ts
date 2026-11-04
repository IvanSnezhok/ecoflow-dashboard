// Quota pushed over MQTT (/open/<account>/<sn>/quota) for devices whose REST quota the
// Open API refuses with code 1006, e.g. one shared from another account: the device
// list and MQTT still serve it. Fields are keyed like the REST quota ("pd.soc").
//
// The push alone is a fixed subset (SOC, limits, USB ports; no AC power, no extra
// batteries), so mqttService also asks for the full snapshot the way the EcoFlow app
// does: a "latestQuotas" get, answered on /get_reply. This store merges both.
// ecoflowApi asks for a device with want(); mqttService subscribes and polls.

/**
 * A field older than this no longer counts as live. Pushes repeat every few seconds and
 * full snapshots every 20 s, so a field from replies that stopped drops out by itself.
 */
export const MQTT_QUOTA_FRESH_MS = 2 * 60_000;
/** Raw messages kept per device for the raw-data download: the latest of each shape. */
const MAX_SAMPLES = 20;

/**
 * Formats of the full-quota request sent to /open/<account>/<sn>/get: the one Open API
 * integrations use, and the EcoFlow app's own. Both are reads; replies echo the id.
 */
export const FULL_QUOTA_REQUESTS: Array<{ variant: string; build: (id: number, sn: string) => Record<string, unknown> }> = [
  { variant: "latestQuotas", build: (id, sn) => ({ id, version: "1.1", moduleType: 0, operateType: "latestQuotas", params: {}, sn }) },
  { variant: "latestQuotas (app)", build: (id) => ({ from: "Android", id: String(id), version: "1.0", moduleType: 0, operateType: "latestQuotas", params: {} }) },
];

const asFields = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0
    ? (value as Record<string, unknown>)
    : null;

/** Some replies carry the quota map as a JSON string. */
const parseIfString = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** The quota is usable once it carries the battery level. */
export const hasBatteryLevel = (quota: Record<string, unknown>): boolean => "pd.soc" in quota || "bmsMaster.soc" in quota;

/** The fields of one quota push, or null when it carries none. */
export function quotaMessageFields(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== "object") return null;
  return asFields((message as Record<string, unknown>).params);
}

/**
 * The fields of a get_reply: the snapshot sits under data (app-style replies one level
 * deeper, data.quotaMap, sometimes as a JSON string), params or param. A bare
 * acknowledgement yields null, and so does a latestQuotas answer without a map (the
 * cloud's { online: 0 } for a device it takes as offline): its wrapper is not a quota.
 */
export function replyMessageFields(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== "object") return null;
  const reply = message as Record<string, unknown>;
  for (const key of ["data", "params", "param"]) {
    const value = asFields(reply[key]);
    if (!value) continue;
    // { online, sn, quotaMap }: only the map is quota ("online" is never a quota field)
    return "quotaMap" in value || "online" in value ? asFields(parseIfString(value.quotaMap)) : value;
  }
  return null;
}

/** Fields reported recently, with when each was last reported. */
export interface LiveFields {
  values: Record<string, unknown>;
  seenAt: Record<string, number>;
}

/**
 * One quota from several live sets: for each field the most recent report wins, so an
 * older snapshot never hides a fresher push of the same field.
 */
export function mergeLive(...sets: Array<LiveFields | null>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const seenAt: Record<string, number> = {};
  for (const set of sets) {
    if (!set) continue;
    for (const [key, value] of Object.entries(set.values)) {
      const at = set.seenAt[key] ?? 0;
      if (key in seenAt && seenAt[key] > at) continue;
      values[key] = value;
      seenAt[key] = at;
    }
  }
  return values;
}

export interface MqttSample {
  topic: string;
  at: string;
  message: unknown;
}

export interface MqttQuotaDiagnostics {
  wanted: boolean;
  lastMessageAt: string | null;
  fieldCount: number;
  pushes: number;
  replies: number;
  /** get_reply messages that carried no quota, e.g. an error code */
  emptyReplies: number;
  /** When the last get_reply with data arrived */
  lastReplyAt: string | null;
  /** Fields reported within MQTT_QUOTA_FRESH_MS, of fieldCount ever seen */
  liveFieldCount: number;
  samples: MqttSample[];
}

interface DeviceEntry {
  values: Record<string, unknown>;
  /** When each field was last reported */
  seenAt: Map<string, number>;
  updatedAt: number;
  replyAt: number;
  pushes: number;
  replies: number;
  emptyReplies: number;
  samples: Map<string, MqttSample>;
}

export class MqttQuotaStore {
  private devices = new Map<string, DeviceEntry>();
  private wanted = new Set<string>();
  private listeners = new Set<(sn: string) => void>();

  /** Ask for a device's pushed quota; listeners (the MQTT service) subscribe to it. */
  want(sn: string): void {
    if (this.wanted.has(sn)) return;
    this.wanted.add(sn);
    for (const listener of this.listeners) listener(sn);
  }

  wantedDevices(): string[] {
    return [...this.wanted];
  }

  onWant(listener: (sn: string) => void): void {
    this.listeners.add(listener);
  }

  private entry(sn: string): DeviceEntry {
    let entry = this.devices.get(sn);
    if (!entry) {
      entry = { values: {}, seenAt: new Map(), updatedAt: 0, replyAt: 0, pushes: 0, replies: 0, emptyReplies: 0, samples: new Map() };
      this.devices.set(sn, entry);
    }
    return entry;
  }

  private merge(entry: DeviceEntry, fields: Record<string, unknown>, now: number): void {
    Object.assign(entry.values, fields);
    for (const key of Object.keys(fields)) entry.seenAt.set(key, now);
    entry.updatedAt = now;
  }

  /** Merge one quota push. Returns false when it carried no fields. */
  apply(sn: string, message: unknown, now = Date.now()): boolean {
    const fields = quotaMessageFields(message);
    if (!fields) return false;
    const entry = this.entry(sn);
    entry.pushes++;
    this.merge(entry, fields, now);
    return true;
  }

  /** Merge a get_reply snapshot. Returns false for a reply without quota. */
  applyReply(sn: string, message: unknown, now = Date.now()): boolean {
    const entry = this.entry(sn);
    const fields = replyMessageFields(message);
    if (!fields) {
      entry.emptyReplies++;
      return false;
    }
    entry.replies++;
    entry.replyAt = now;
    this.merge(entry, fields, now);
    return true;
  }

  /** Keep the latest raw message of each shape (topic + field names) for diagnostics. */
  sample(sn: string, topic: string, message: unknown, now = Date.now()): void {
    const fields = quotaMessageFields(message) ?? replyMessageFields(message) ?? {};
    const kind = topic.slice(topic.lastIndexOf("/") + 1);
    const shape = `${kind}:${Object.keys(fields).sort().join(",")}`;
    const samples = this.entry(sn).samples;
    samples.delete(shape);
    if (samples.size >= MAX_SAMPLES) samples.delete(samples.keys().next().value!);
    samples.set(shape, { topic: `…/${kind}`, at: new Date(now).toISOString(), message });
  }

  /** The fields reported recently with their report times, or null when there are none. */
  live(sn: string, now = Date.now()): LiveFields | null {
    const entry = this.devices.get(sn);
    if (!entry) return null;
    const values: Record<string, unknown> = {};
    const seenAt: Record<string, number> = {};
    for (const [key, at] of entry.seenAt) {
      if (now - at > MQTT_QUOTA_FRESH_MS) continue;
      values[key] = entry.values[key];
      seenAt[key] = at;
    }
    return Object.keys(values).length > 0 ? { values, seenAt } : null;
  }

  /** The fields reported recently, when they include the battery level, else null. */
  fresh(sn: string, now = Date.now()): Record<string, unknown> | null {
    const live = this.live(sn, now)?.values;
    return live && hasBatteryLevel(live) ? live : null;
  }

  /** When the last message with fields arrived, or 0. */
  lastMessageAt(sn: string): number {
    return this.devices.get(sn)?.updatedAt ?? 0;
  }

  /** When the last get_reply with data arrived, or 0. */
  lastReplyAt(sn: string): number {
    return this.devices.get(sn)?.replyAt ?? 0;
  }

  diagnostics(sn: string, now = Date.now()): MqttQuotaDiagnostics {
    const entry = this.devices.get(sn);
    return {
      wanted: this.wanted.has(sn),
      lastMessageAt: entry?.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
      fieldCount: entry ? Object.keys(entry.values).length : 0,
      pushes: entry?.pushes ?? 0,
      replies: entry?.replies ?? 0,
      emptyReplies: entry?.emptyReplies ?? 0,
      lastReplyAt: entry?.replyAt ? new Date(entry.replyAt).toISOString() : null,
      liveFieldCount: Object.keys(this.live(sn, now)?.values ?? {}).length,
      samples: entry ? [...entry.samples.values()] : [],
    };
  }
}

export const mqttQuotas = new MqttQuotaStore();
