import assert from "node:assert/strict";
import { MQTT_QUOTA_FRESH_MS, MqttQuotaStore, quotaMessageFields } from "./mqttQuota.js";

const sn = "DAEBZ5KF0000000";
const t0 = 1_800_000_000_000;

assert.equal(quotaMessageFields(null), null);
assert.equal(quotaMessageFields({ params: {} }), null);
assert.equal(quotaMessageFields({ params: [1, 2] }), null);
assert.equal(quotaMessageFields({ "pd.soc": 50 }), null);
assert.deepEqual(quotaMessageFields({ id: 1, version: "1.0", params: { "pd.soc": 50 } }), { "pd.soc": 50 });

const store = new MqttQuotaStore();
const subscribed: string[] = [];
store.onWant((wanted) => subscribed.push(wanted));
store.want(sn);
store.want(sn);
assert.deepEqual(subscribed, [sn]);
assert.deepEqual(store.wantedDevices(), [sn]);

// Messages carry part of the quota each; the store merges them
assert.equal(store.apply(sn, { params: { "inv.outputWatts": 120 } }, t0), true);
assert.equal(store.fresh(sn, t0), null, "no battery level yet");
assert.equal(store.lastMessageAt(sn), t0);
store.apply(sn, { params: { "pd.soc": 87, "inv.outputWatts": 95 } }, t0 + 1000);
assert.deepEqual(store.fresh(sn, t0 + 2000), { "inv.outputWatts": 95, "pd.soc": 87 });
assert.equal(store.apply(sn, { params: {} }, t0 + 3000), false);
assert.equal(store.lastMessageAt(sn), t0 + 1000);

// The copy handed out does not change with later messages
const snapshot = store.fresh(sn, t0 + 2000)!;
store.apply(sn, { params: { "pd.soc": 86 } }, t0 + 4000);
assert.equal(snapshot["pd.soc"], 87);

// Pushes stopping makes the quota stale
assert.ok(store.fresh(sn, t0 + 4000 + MQTT_QUOTA_FRESH_MS));
assert.equal(store.fresh(sn, t0 + 4001 + MQTT_QUOTA_FRESH_MS), null);
assert.equal(store.fresh("UNKNOWN", t0), null);
console.log("MQTT quota store passed");
