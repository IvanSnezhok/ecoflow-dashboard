import assert from "node:assert/strict";
import {
  EXTRA_BATTERY_HOLD_MS,
  ExtraBatteryTracker,
  connectedExtraBatterySocs,
  hasExtraBattery,
} from "./extraBatteries.js";

const SN = "DCEBZ5ZE1234567";
const pack = (prefix: string, soc: number) => ({
  [`${prefix}.soc`]: soc,
  [`${prefix}.fullCap`]: 80000,
  [`${prefix}.remainCap`]: 800 * soc,
  [`${prefix}.vol`]: 52000,
  [`${prefix}.cycles`]: 40,
});
const main = { "pd.soc": 70, "bmsMaster.soc": 70 };
const both = { ...main, ...pack("bmsSlave1", 60), ...pack("bmsSlave2", 50) };
const onlyFirst = { ...main, ...pack("bmsSlave1", 59) };

// Presence and SOC helpers
assert.equal(hasExtraBattery(both, "bmsSlave2"), true);
assert.equal(hasExtraBattery({ "bmsSlave2.soc": 0, "bmsSlave2.fullCap": 0, "bmsSlave2.vol": 0 }, "bmsSlave2"), false);
assert.deepEqual(connectedExtraBatterySocs(both), [60, 50]);
assert.deepEqual(connectedExtraBatterySocs({ "bmsSlave1.fullCap": 80000, "bmsSlave1.remainCap": 20000 }), [25]);

// The cloud answers with one pack: the other is kept from memory, the live one updated.
const t0 = Date.UTC(2026, 9, 15, 12, 0, 0);
const tracker = new ExtraBatteryTracker();
tracker.fill(SN, both, t0);
const filled = tracker.fill(SN, onlyFirst, t0 + 10_000);
assert.deepEqual(connectedExtraBatterySocs(filled), [59, 50]);
assert.equal(tracker.isHeld(SN, "bmsSlave1"), false);
assert.equal(tracker.isHeld(SN, "bmsSlave2"), true);
assert.equal(tracker.lastSeen(SN, "bmsSlave2"), t0);
assert.equal("bmsSlave2.soc" in onlyFirst, false, "the input quota (a cached object) is not mutated");

// Next answer carries the second pack again: no longer held.
tracker.fill(SN, both, t0 + 20_000);
assert.equal(tracker.isHeld(SN, "bmsSlave2"), false);

// A pack absent for longer than the hold time counts as disconnected.
const late = tracker.fill(SN, onlyFirst, t0 + 20_000 + EXTRA_BATTERY_HOLD_MS + 1);
assert.deepEqual(connectedExtraBatterySocs(late), [59]);
assert.equal(tracker.lastSeen(SN, "bmsSlave2"), null);

// BLE reports only SOC for extra packs: the live SOC wins over memory and keeps the pack alive.
const ble = new ExtraBatteryTracker();
ble.fill(SN, both, t0);
const bleOnly = { ...main, "bmsSlave1.soc": 58, "bmsSlave2.soc": 47 };
const later = t0 + EXTRA_BATTERY_HOLD_MS + 60_000;
const merged = ble.fill(SN, bleOnly, later);
assert.deepEqual(connectedExtraBatterySocs(merged), [58, 47]);
assert.equal(merged["bmsSlave2.fullCap"], 80000);
assert.equal(ble.isHeld(SN, "bmsSlave2"), false);
assert.equal(ble.lastSeen(SN, "bmsSlave2"), later);

// After a restart the stored snapshot seeds the memory.
const restarted = new ExtraBatteryTracker();
assert.equal(restarted.knows(SN), false);
restarted.seed(SN, both, t0);
assert.equal(restarted.knows(SN), true);
assert.deepEqual(connectedExtraBatterySocs(restarted.fill(SN, onlyFirst, t0 + 60_000)), [59, 50]);

// A device without extra batteries stays without them.
const plain = new ExtraBatteryTracker();
assert.deepEqual(connectedExtraBatterySocs(plain.fill(SN, main, t0)), []);

console.log("extraBatteries tests passed");
