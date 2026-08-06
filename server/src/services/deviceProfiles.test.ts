import assert from "node:assert/strict";
import { getDeviceProfile, getSupportedCommand } from "./deviceProfiles.js";
import { deltaProQuotaFixture, deltaProNormalizedFixture } from "./__fixtures__/deltaProQuota.js";

const deltaPro = getDeviceProfile("DELTA Pro", deltaProQuotaFixture);
assert.equal(deltaPro.id, "delta-pro-legacy");
assert.equal(deltaPro.status, "supported");
assert.deepEqual(deltaPro.normalizeQuota(deltaProQuotaFixture), deltaProNormalizedFixture);
assert.deepEqual(getSupportedCommand("DELTA Pro", { type: "setAcOutput", enabled: true }), {
  transport: "legacy-delta", id: 66, params: { enabled: 1, xboost: 0 },
});
assert.equal(getDeviceProfile("RIVER 2 Pro").id, "river-read-only");
assert.equal(getDeviceProfile("PowerStream").id, "powerstream-read-only");
assert.equal(getDeviceProfile("DELTA Pro", { "pd.soc": 50 }).id, "unclassified-read-only");
assert.throws(() => getSupportedCommand("RIVER 2 Pro", { type: "setAcOutput", enabled: true }));
console.log("Device profile fixtures passed");
