import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildStateSample, isUsefulSample } from "./stateSample.js";
import { deltaProQuotaFixture } from "./__fixtures__/deltaProQuota.js";

// Full quota maps every metric, keeping real zeros.
const full = buildStateSample({ ...deltaProQuotaFixture, "mppt.inWatts": 0, "bmsMaster.vol": 52000 });
assert.equal(full.batterySoc, 82);
assert.equal(full.batteryWatts, 900);
assert.equal(full.solarInputWatts, 0);
assert.equal(full.acOutputWatts, 250);
assert.equal(full.bmsMasterVol, 52000);
assert.equal(full.extraBattery1Soc, null);

// A partial quota (only one module answered) must not become a 0% sample.
const partial = buildStateSample({ "bmsSlave1.fullCap": 80000, "bmsSlave1.remainCap": 40000, "bmsSlave1.vol": 51000 });
assert.equal(partial.batterySoc, null);
assert.equal(partial.acOutputWatts, null);
assert.equal(partial.extraBattery1Soc, 50);
assert.equal(isUsefulSample(partial), false);
assert.equal(buildStateSample({ "pd.soc": 0, "bmsMaster.soc": 0 }).batterySoc, null);

// History reads must skip legacy all-zero rows instead of averaging them in.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecoflow-sample-"));
process.env.ECOFLOW_DB_PATH = path.join(dir, "test.db");
const { initDatabase, db, getDeviceHistory } = await import("../db/database.js");
initDatabase();
db.prepare("INSERT INTO devices (serial_number, device_type, name) VALUES ('SN1', 'DELTA Pro', 'Test')").run();
const deviceId = (db.prepare("SELECT id FROM devices WHERE serial_number = 'SN1'").get() as { id: number }).id;
const insert = db.prepare(`
  INSERT INTO device_states (device_id, battery_soc, ac_output_watts, temperature, timestamp)
  VALUES (?, ?, ?, ?, ?)
`);
insert.run(deviceId, 80, 300, 25, "2026-01-01 10:00:00");
insert.run(deviceId, 0, 0, 0, "2026-01-01 10:00:20"); // legacy partial-quota row
insert.run(deviceId, 80, 300, 25, "2026-01-01 10:00:40");
insert.run(deviceId, null, null, null, "2026-01-01 10:00:50"); // new-style partial row

const raw = getDeviceHistory({ deviceId, from: "2026-01-01T09:00:00.000Z", to: "2026-01-01T11:00:00.000Z", aggregation: "none" });
assert.equal(raw.length, 4);
assert.equal(raw[1].batterySoc, null);
assert.equal(raw[1].acOutputWatts, null);

const perMinute = getDeviceHistory({ deviceId, from: "2026-01-01T09:00:00.000Z", to: "2026-01-01T11:00:00.000Z", aggregation: "1min" });
assert.equal(perMinute.length, 1);
assert.equal(perMinute[0].batterySoc, 80);
assert.equal(perMinute[0].acOutputWatts, 300);
assert.equal(perMinute[0].temperature, 25);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log("State sample tests passed");
