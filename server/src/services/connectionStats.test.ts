import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeConnection, type ConnectionEvent } from "./connectionStats.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = Date.UTC(2026, 9, 14, 12, 0, 0);
const ev = (online: boolean, ago: number, extra: Partial<ConnectionEvent> = {}): ConnectionEvent => ({
  online, timestamp: now - ago, unobservedSince: null, firstObservation: false, ...extra,
});

// No data yet
assert.equal(summarizeConnection([], now).online, null);

// First observation only: the streak start is a lower bound.
const fresh = summarizeConnection([ev(true, 2 * HOUR, { firstObservation: true })], now);
assert.equal(fresh.online, true);
assert.equal(fresh.sinceExact, false);
assert.equal(fresh.lastOutage, null);
assert.equal(fresh.disconnects24h, 0);

// Two outages seen live: the newest one is reported, both are counted.
const history = [
  ev(true, 3 * 24 * HOUR, { firstObservation: true }),
  ev(false, 30 * HOUR),
  ev(true, 29 * HOUR),
  ev(false, 5 * HOUR),
  ev(true, 5 * HOUR - 20 * MIN),
];
const s = summarizeConnection(history, now);
assert.equal(s.online, true);
assert.equal(s.since, new Date(now - 5 * HOUR + 20 * MIN).toISOString());
assert.equal(s.sinceExact, true);
assert.equal(s.unobservedMs, 0);
assert.deepEqual(s.lastOutage, {
  start: new Date(now - 5 * HOUR).toISOString(),
  end: new Date(now - 5 * HOUR + 20 * MIN).toISOString(),
  durationMs: 20 * MIN,
  exact: true,
});
assert.equal(s.disconnects24h, 1);
assert.equal(s.disconnects7d, 2);
assert.equal(s.trackingSince, new Date(now - 3 * 24 * HOUR).toISOString());

// A dashboard restart inside the streak keeps it but reports the unwatched time.
const gap = summarizeConnection([...history, ev(true, HOUR, { unobservedSince: now - 2 * HOUR })], now);
assert.equal(gap.since, s.since);
assert.equal(gap.unobservedMs, HOUR);

// Currently offline: the outage is open-ended and counts up to now.
const down = summarizeConnection([...history, ev(false, 10 * MIN)], now);
assert.equal(down.online, false);
assert.equal(down.lastOutage?.end, null);
assert.equal(down.lastOutage?.durationMs, 10 * MIN);
assert.equal(down.disconnects24h, 2);

// A change first seen after a gap is not exact.
const late = summarizeConnection([ev(true, 3 * HOUR), ev(false, HOUR, { unobservedSince: now - 2 * HOUR })], now);
assert.equal(late.sinceExact, false);
assert.equal(late.lastOutage?.exact, false);

// Recording: only changes and post-gap markers are stored.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecoflow-conn-"));
process.env.ECOFLOW_DB_PATH = path.join(dir, "test.db");
const { initDatabase, db, recordConnectionState, getConnectionEvents } = await import("../db/database.js");
initDatabase();
db.prepare("INSERT INTO devices (serial_number, device_type, name) VALUES ('SN1', 'DELTA Pro', 'Test')").run();
const id = (db.prepare("SELECT id FROM devices WHERE serial_number = 'SN1'").get() as { id: number }).id;

const t0 = now - 10 * HOUR;
for (let t = t0; t < t0 + HOUR; t += 10_000) recordConnectionState(id, true, t); // steady: 1 event
recordConnectionState(id, false, t0 + HOUR);                                       // drop
recordConnectionState(id, true, t0 + HOUR + 2 * MIN);                              // back
recordConnectionState(id, true, t0 + 3 * HOUR);                                    // after a 2 h gap
const { events, trackingSince } = getConnectionEvents(id, 7 * 24 * HOUR, now);
assert.deepEqual(events.map((e) => [e.online, e.timestamp - t0, e.firstObservation]), [
  [true, 0, true],
  [false, HOUR, false],
  [true, HOUR + 2 * MIN, false],
  [true, 3 * HOUR, false],
]);
assert.equal(events[3].unobservedSince, t0 + HOUR + 2 * MIN);
assert.equal(trackingSince, t0);

const summary = summarizeConnection(events, now, trackingSince);
assert.equal(summary.since, new Date(t0 + HOUR + 2 * MIN).toISOString());
assert.equal(summary.lastOutage?.durationMs, 2 * MIN);

db.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log("Connection stats tests passed");
