/**
 * Keeps DELTA Pro extra batteries (bmsSlave1 / bmsSlave2) in every quota.
 *
 * The cloud's /quota/all regularly answers with only one of the two bmsSlave blocks,
 * and BLE reports nothing but the extra batteries' SOC. Dropping a pack whenever its
 * block was missing made the panel flicker between one and two extra batteries and
 * made the outage runtime forecast (Slack) count a single extra pack. The tracker
 * remembers each pack's last block and fills it into quotas that lack it, until the
 * pack has not been reported for EXTRA_BATTERY_HOLD_MS (then it is taken as removed).
 */

export const EXTRA_BATTERY_PREFIXES = ["bmsSlave1", "bmsSlave2"] as const;
export type ExtraBatteryPrefix = (typeof EXTRA_BATTERY_PREFIXES)[number];

/** A pack missing from the quota longer than this is treated as disconnected. */
export const EXTRA_BATTERY_HOLD_MS = 30 * 60_000;

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** A slot holds a pack when the quota reports its capacity or voltage; empty slots read 0. */
export function hasExtraBattery(q: Record<string, unknown>, prefix: string): boolean {
  return positive(q[`${prefix}.fullCap`]) || positive(q[`${prefix}.vol`]);
}

/** Pack SOC in percent: `soc`, else remainCap / fullCap; null when neither is known. */
export function extraBatterySoc(q: Record<string, unknown>, prefix: string): number | null {
  const soc = q[`${prefix}.soc`];
  if (typeof soc === "number" && Number.isFinite(soc)) return soc;
  const remainCap = q[`${prefix}.remainCap`];
  const fullCap = q[`${prefix}.fullCap`];
  if (typeof remainCap === "number" && positive(fullCap)) return Math.round((remainCap / fullCap) * 100);
  return null;
}

/** SOCs of every connected extra pack, in slot order. */
export function connectedExtraBatterySocs(q: Record<string, unknown>): number[] {
  return EXTRA_BATTERY_PREFIXES.flatMap((prefix) => {
    if (!hasExtraBattery(q, prefix)) return [];
    const soc = extraBatterySoc(q, prefix);
    return soc === null ? [] : [soc];
  });
}

interface PackMemory {
  fields: Record<string, unknown>;
  /** When the device itself last reported the pack */
  seenAt: number;
}

export class ExtraBatteryTracker {
  private packs = new Map<string, Map<string, PackMemory>>();
  private held = new Map<string, Set<string>>();

  constructor(private readonly holdMs = EXTRA_BATTERY_HOLD_MS) {}

  /** Whether this device already has memory (or was seeded), so callers seed only once. */
  knows(sn: string): boolean {
    return this.packs.has(sn);
  }

  /** Start from a stored snapshot (after a restart); packs already known are kept. */
  seed(sn: string, quota: Record<string, unknown> | null, seenAt: number): void {
    const packs = this.packsOf(sn);
    if (!quota) return;
    for (const prefix of EXTRA_BATTERY_PREFIXES) {
      if (!packs.has(prefix) && hasExtraBattery(quota, prefix)) {
        packs.set(prefix, { fields: slotFields(quota, prefix), seenAt });
      }
    }
  }

  /**
   * The quota with every recently seen pack present. Keys the quota carries win,
   * so a live BLE SOC is kept over the remembered one. Returns a new object.
   */
  fill(sn: string, quota: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
    const packs = this.packsOf(sn);
    const held = new Set<string>();
    let result = quota;
    for (const prefix of EXTRA_BATTERY_PREFIXES) {
      const memory = packs.get(prefix);
      if (hasExtraBattery(quota, prefix)) {
        packs.set(prefix, { fields: { ...memory?.fields, ...slotFields(quota, prefix) }, seenAt: now });
        continue;
      }
      if (!memory) continue;
      // BLE lists only connected packs, so a live SOC confirms the pack is still there.
      if (positive(quota[`${prefix}.soc`])) memory.seenAt = now;
      if (now - memory.seenAt > this.holdMs) {
        packs.delete(prefix);
        continue;
      }
      if (result === quota) result = { ...quota };
      for (const [key, value] of Object.entries(memory.fields)) {
        if (!(key in result)) result[key] = value;
      }
      if (memory.seenAt !== now) held.add(prefix);
    }
    this.held.set(sn, held);
    return result;
  }

  /** When the device last reported this pack itself, or null if it is unknown. */
  lastSeen(sn: string, prefix: string): number | null {
    return this.packs.get(sn)?.get(prefix)?.seenAt ?? null;
  }

  /** True when the latest fill() supplied this pack from memory. */
  isHeld(sn: string, prefix: string): boolean {
    return this.held.get(sn)?.has(prefix) ?? false;
  }

  private packsOf(sn: string): Map<string, PackMemory> {
    let packs = this.packs.get(sn);
    if (!packs) {
      packs = new Map();
      this.packs.set(sn, packs);
    }
    return packs;
  }
}

function slotFields(quota: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(quota)) {
    if (key.startsWith(`${prefix}.`)) fields[key] = value;
  }
  return fields;
}

export const extraBatteries = new ExtraBatteryTracker();
