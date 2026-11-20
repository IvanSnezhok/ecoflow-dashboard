import assert from "node:assert/strict";
import {
  EXTRA_BATTERY_HOLD_MS,
  ExtraBatteryTracker,
  connectedExtraBatterySocs,
  hasExtraBattery,
  packFlow,
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

// Over MQTT a message carries part of a pack's block: any live reading keeps it confirmed.
const mqtt = new ExtraBatteryTracker();
mqtt.fill(SN, { ...main, ...pack("bmsSlave1", 100) }, t0);
const partial = mqtt.fill(SN, { ...main, "bmsSlave1.maxCellVol": 3400, "bmsSlave1.inputWatts": 0 }, later);
assert.deepEqual(connectedExtraBatterySocs(partial), [100]);
assert.equal(partial["bmsSlave1.maxCellVol"], 3400);
assert.equal(mqtt.isHeld(SN, "bmsSlave1"), false);
assert.equal(mqtt.lastSeen(SN, "bmsSlave1"), later);
// Readings an empty slot also has (0 W, a temperature) do not keep a pack alive
const idle = new ExtraBatteryTracker();
idle.fill(SN, { ...main, ...pack("bmsSlave1", 100) }, t0);
idle.fill(SN, { ...main, "bmsSlave1.inputWatts": 0, "bmsSlave1.temp": 25 }, t0 + 60_000);
assert.equal(idle.lastSeen(SN, "bmsSlave1"), t0);

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

// Pack power: a DELTA Pro leaves inputWatts/outputWatts at 0, so current x voltage is used.
const charging = { ...pack("bmsSlave1", 50), "bmsSlave1.inputWatts": 0, "bmsSlave1.outputWatts": 0, "bmsSlave1.amp": 10000 };
assert.deepEqual(packFlow(charging, "bmsSlave1"), { watts: 520, remainMinutes: 240 });
assert.deepEqual(packFlow(charging, "bmsSlave1", { maxChargeSoc: 80 }), { watts: 520, remainMinutes: 144 });
const discharging = { ...pack("bmsSlave1", 50), "bmsSlave1.amp": -8000 };
assert.deepEqual(packFlow(discharging, "bmsSlave1"), { watts: -416, remainMinutes: 300 });
assert.deepEqual(packFlow(discharging, "bmsSlave1", { minDischargeSoc: 10 }), { watts: -416, remainMinutes: 240 });
// Reported watts win over the current; without capacities the time is unknown
assert.deepEqual(packFlow({ "bmsSlave1.inputWatts": 300, "bmsSlave1.outputWatts": 0 }, "bmsSlave1"), { watts: 300, remainMinutes: null });
assert.deepEqual(packFlow({ ...pack("bmsSlave1", 50), "bmsSlave1.outputWatts": 260 }, "bmsSlave1"), { watts: -260, remainMinutes: 480 });
// A resting pack reads a few watts either way
assert.deepEqual(packFlow({ ...pack("bmsSlave1", 50), "bmsSlave1.amp": -40 }, "bmsSlave1"), { watts: 0, remainMinutes: null });
// BLE sends only the SOC: the power is unknown, not 0
assert.equal(packFlow({ "bmsSlave1.soc": 58 }, "bmsSlave1"), null);

// A pack kept from memory does not keep its last power reading.
const flowing = new ExtraBatteryTracker();
flowing.fill(SN, { ...main, ...charging }, t0);
const afterBle = flowing.fill(SN, { ...main, "bmsSlave1.soc": 51 }, t0 + 10_000);
assert.equal(afterBle["bmsSlave1.fullCap"], 80000);
assert.equal("bmsSlave1.amp" in afterBle, false);
assert.equal(packFlow(afterBle, "bmsSlave1"), null);
