// Quota pushed over MQTT (/open/<account>/<sn>/quota) for devices whose REST quota the
// Open API refuses with code 1006, e.g. one shared from another account: the device
// list and the MQTT push still serve it. Each message carries some of the fields under
// `params`, keyed like the REST quota ("pd.soc", "inv.outputWatts"), so this keeps the
// merged picture. ecoflowApi asks for a device with want(); mqttService subscribes.

/** Older than this, the merged quota no longer counts as live (pushes come every few seconds). */
export const MQTT_QUOTA_FRESH_MS = 2 * 60_000;

/** The fields of one quota message, or null when it carries none. */
export function quotaMessageFields(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== "object") return null;
  const params = (message as Record<string, unknown>).params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  return Object.keys(params).length > 0 ? (params as Record<string, unknown>) : null;
}

export class MqttQuotaStore {
  private quotas = new Map<string, { values: Record<string, unknown>; updatedAt: number }>();
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

  /** Merge one message into the device's quota. Returns false when it carried no fields. */
  apply(sn: string, message: unknown, now = Date.now()): boolean {
    const fields = quotaMessageFields(message);
    if (!fields) return false;
    const entry = this.quotas.get(sn) ?? { values: {}, updatedAt: 0 };
    Object.assign(entry.values, fields);
    entry.updatedAt = now;
    this.quotas.set(sn, entry);
    return true;
  }

  /** The merged quota while pushes keep coming and it has the battery level, else null. */
  fresh(sn: string, now = Date.now()): Record<string, unknown> | null {
    const entry = this.quotas.get(sn);
    if (!entry || now - entry.updatedAt > MQTT_QUOTA_FRESH_MS) return null;
    if (!("pd.soc" in entry.values) && !("bmsMaster.soc" in entry.values)) return null;
    return { ...entry.values };
  }

  /** When the last message with fields arrived, or 0. */
  lastMessageAt(sn: string): number {
    return this.quotas.get(sn)?.updatedAt ?? 0;
  }
}

export const mqttQuotas = new MqttQuotaStore();
