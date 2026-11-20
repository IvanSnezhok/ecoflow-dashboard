import type { HistoryDataPoint } from '@panel/types/device';

export interface EnergyBucket {
  /** Start of the day or month, local time, epoch ms */
  start: number;
  chargedWh: number;
  usedWh: number;
}

/** The longest stretch one stored point stands for, by the panel's bucket size */
export function stepLimitMs(aggregation: string): number {
  const minutes: Record<string, number> = { none: 2, '1min': 2, '5min': 8, '15min': 23, '1hour': 90, '6hour': 540 };
  return (minutes[aggregation] ?? 23) * 60_000;
}

/**
 * Energy in and out per local day or month: each point's power counts until the next
 * point, but no longer than `limitMs`, so a gap in the history adds nothing.
 */
export function energyBuckets(points: HistoryDataPoint[], limitMs: number, by: 'day' | 'month'): EnergyBucket[] {
  const buckets = new Map<number, EnergyBucket>();
  for (let i = 0; i < points.length - 1; i++) {
    const point = points[i];
    const time = new Date(point.timestamp).getTime();
    const step = Math.min(new Date(points[i + 1].timestamp).getTime() - time, limitMs);
    if (!(step > 0)) continue;
    const date = new Date(time);
    const start = by === 'day'
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      : new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    const bucket = buckets.get(start) ?? { start, chargedWh: 0, usedWh: 0 };
    const hours = step / 3_600_000;
    bucket.chargedWh += Math.max(0, (point.acInputWatts ?? 0) + (point.solarInputWatts ?? 0)) * hours;
    bucket.usedWh += Math.max(0, (point.acOutputWatts ?? 0) + (point.dcOutputWatts ?? 0)) * hours;
    buckets.set(start, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.start - b.start);
}
