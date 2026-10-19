import assert from "node:assert/strict";
import { EcoflowApiError } from "../lib/ecoflowApiError.js";
import { probeFailure, probeSuccess, probeVerdict, type DeviceProbe } from "./dataAccess.js";

const refused = probeFailure(new EcoflowApiError("1006", "current device is not allowed to get device info"));
assert.deepEqual(refused, { ok: false, code: "1006", message: "current device is not allowed to get device info" });
assert.deepEqual(probeFailure(new Error("fetch failed")), { ok: false, message: "fetch failed" });

const answered = probeSuccess({ "pd.soc": 87, "inv.outputWatts": 120, "pd.wifiRssi": -60 });
assert.deepEqual(answered, { ok: true, fieldCount: 3, sample: { "pd.soc": 87, "inv.outputWatts": 120 } });
assert.deepEqual(probeSuccess(null), { ok: true, fieldCount: 0, sample: {} });

const silent = { subscribed: true, messages: 0, keys: [] };
const probe = (overrides: Partial<DeviceProbe>): DeviceProbe => ({
  serialNumber: "DAEBZ5KF0000000", name: "DELTA Max", productName: "DELTA Max",
  inList: true, cloudOnline: true, quotaAll: refused, quotaFields: refused,
  mqtt: { quota: silent, status: silent }, ...overrides,
});
const working = probe({ serialNumber: "DCEBZ8ZE0000000", quotaAll: answered, quotaFields: answered });

// A shared device: listed and online, refused on every channel while the keys work
assert.equal(probeVerdict(probe({}), working), "refused");
assert.equal(probeVerdict(probe({}), null), "refused");
assert.equal(probeVerdict(probe({ mqtt: null }), working), "refused");
// The comparison failing too points at the keys or the cloud
assert.equal(probeVerdict(probe({}), probe({ serialNumber: "DCEBZ8ZE0000000" })), "keys-failing");
assert.equal(probeVerdict(probe({ quotaFields: answered }), working), "data-available");
assert.equal(
  probeVerdict(probe({ mqtt: { quota: { subscribed: true, messages: 4, keys: ["pd.soc"] }, status: silent } }), working),
  "mqtt-only",
);
assert.equal(probeVerdict(probe({ cloudOnline: false }), working), "offline");
assert.equal(probeVerdict(probe({ inList: false, cloudOnline: false }), working), "not-listed");
console.log("Data access check passed");
