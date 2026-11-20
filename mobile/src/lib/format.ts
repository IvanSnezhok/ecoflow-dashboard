export { formatMinutes } from '@panel/lib/deviceStatus';

/** "1.2 kW" from 1000 W up, else "850 W" */
export function watts(value: number): string {
  const abs = Math.abs(value);
  return abs >= 1000 ? `${(value / 1000).toFixed(abs >= 10_000 ? 0 : 1)} kW` : `${Math.round(value)} W`;
}

export const volts = (millivolts: number) => `${(millivolts / 1000).toFixed(1)} V`;

const pad = (value: number) => String(value).padStart(2, '0');

/** "14:05" */
export const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** "21.11" */
export const dayMonth = (date: Date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;

/** "5 min ago", "3 h ago", "2 d ago" */
export function ago(iso: string | number | null | undefined, now = Date.now()): string | null {
  if (iso === null || iso === undefined) return null;
  const time = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

/** "2 h 15 min" from a number of minutes */
export function duration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
