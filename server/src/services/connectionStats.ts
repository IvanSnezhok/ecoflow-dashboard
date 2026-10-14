// How long a device's Wi-Fi/cloud connection holds, derived from the online flag
// the background collector sees every 10 s in the EcoFlow device list.
//
// Only state changes are stored. The dashboard itself can be down (restart, update),
// so an event written after such a gap carries `unobservedSince`: the change, or an
// outage that came and went, happened somewhere in that window and durations that
// include it are lower bounds.

export interface ConnectionEvent {
  online: boolean;
  /** Epoch ms when the collector saw this state. */
  timestamp: number;
  /** Epoch ms of the last check before a monitoring gap; null = watched continuously. */
  unobservedSince: number | null;
  /** First observation of the device: the state started at an unknown earlier time. */
  firstObservation: boolean;
}

export interface ConnectionSummary {
  online: boolean | null;
  /** ISO start of the current online/offline streak. */
  since: string | null;
  /** false = the streak started before monitoring or during a gap, so it is "at least". */
  sinceExact: boolean;
  /** Time inside the current streak the dashboard was not watching. */
  unobservedMs: number;
  /** Most recent offline period (the current one when offline). */
  lastOutage: { start: string; end: string | null; durationMs: number; exact: boolean } | null;
  disconnects24h: number;
  disconnects7d: number;
  /** ISO time of the first stored event; earlier history is unknown. */
  trackingSince: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Events must be sorted oldest first and cover the last 7 days, the current streak
 * and the latest outage, plus the event just before them.
 */
export function summarizeConnection(
  events: ConnectionEvent[],
  now: number = Date.now(),
  trackingSinceMs: number | null = events[0]?.timestamp ?? null,
): ConnectionSummary {
  const empty: ConnectionSummary = {
    online: null, since: null, sinceExact: false, unobservedMs: 0, lastOutage: null,
    disconnects24h: 0, disconnects7d: 0, trackingSince: null,
  };
  if (events.length === 0) return empty;

  const latest = events[events.length - 1];
  let start = events.length - 1;
  while (start > 0 && events[start - 1].online === latest.online) start--;

  const startEvent = events[start];
  let unobservedMs = 0;
  for (let i = start; i < events.length; i++) {
    const e = events[i];
    if (e.unobservedSince !== null) unobservedMs += e.timestamp - e.unobservedSince;
  }

  // A streak start is exact only when a real transition was seen live.
  const sinceExact = start > 0 && !startEvent.firstObservation && startEvent.unobservedSince === null;

  let disconnects24h = 0;
  let disconnects7d = 0;
  let lastOutage: ConnectionSummary["lastOutage"] = null;
  for (let i = 1; i < events.length; i++) {
    const e = events[i];
    if (e.online || !events[i - 1].online) continue;
    if (e.timestamp >= now - DAY_MS) disconnects24h++;
    if (e.timestamp >= now - 7 * DAY_MS) disconnects7d++;
  }

  // Walk back to the latest offline streak and the online event that ended it.
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].online) continue;
    let first = i;
    while (first > 0 && !events[first - 1].online) first--;
    const end = events[i + 1];
    const startMs = events[first].timestamp;
    const endMs = end ? end.timestamp : now;
    let exact = first > 0 && !events[first].firstObservation && events[first].unobservedSince === null;
    for (let j = first + 1; j <= i + 1 && j < events.length; j++) {
      if (events[j].unobservedSince !== null) exact = false;
    }
    lastOutage = { start: iso(startMs), end: end ? iso(endMs) : null, durationMs: endMs - startMs, exact };
    break;
  }

  return {
    online: latest.online,
    since: iso(startEvent.timestamp),
    sinceExact,
    unobservedMs,
    lastOutage,
    disconnects24h,
    disconnects7d,
    trackingSince: trackingSinceMs !== null ? iso(trackingSinceMs) : null,
  };
}
