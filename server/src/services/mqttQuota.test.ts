import assert from "node:assert/strict";
import { MQTT_QUOTA_FRESH_MS, MqttQuotaStore, quotaMessageFields, replyMessageFields } from "./mqttQuota.js";

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

// get_reply to a latestQuotas request: the full snapshot, possibly under data.quotaMap
assert.equal(replyMessageFields({ id: 1, code: 0, message: "ok" }), null, "a bare ack");
assert.equal(replyMessageFields({ id: 1, data: {} }), null);
assert.deepEqual(replyMessageFields({ id: 1, data: { "inv.inputWatts": 230 } }), { "inv.inputWatts": 230 });
assert.deepEqual(
  replyMessageFields({ operateType: "latestQuotas", data: { online: 1, sn, quotaMap: { "bmsSlave1.soc": 70 } } }),
  { "bmsSlave1.soc": 70 },
);
assert.deepEqual(replyMessageFields({ params: { "pd.soc": 50 } }), { "pd.soc": 50 });

const replies = new MqttQuotaStore();
assert.equal(replies.applyReply(sn, { id: 7, code: "1006", message: "refused" }, t0), false);
assert.equal(replies.applyReply(sn, { data: { quotaMap: { "pd.soc": 90, "inv.outputWatts": 300 } } }, t0 + 10), true);
replies.apply(sn, { params: { "pd.soc": 89 } }, t0 + 20);
assert.deepEqual(replies.fresh(sn, t0 + 30), { "pd.soc": 89, "inv.outputWatts": 300 });
// Pushes keep coming but the snapshots stop: their fields drop out instead of going stale
replies.apply(sn, { params: { "pd.soc": 88 } }, t0 + MQTT_QUOTA_FRESH_MS + 20);
assert.deepEqual(replies.fresh(sn, t0 + MQTT_QUOTA_FRESH_MS + 30), { "pd.soc": 88 });
const diag = replies.diagnostics(sn);
assert.equal(diag.replies, 1);
assert.equal(diag.emptyReplies, 1);
assert.equal(diag.pushes, 2);
assert.equal(diag.fieldCount, 2);

// Raw samples: the latest message per shape, at most 20
for (let i = 0; i < 30; i++) replies.sample(sn, `/open/x/${sn}/quota`, { params: { [`f${i}`]: i } }, t0 + i);
replies.sample(sn, `/open/x/${sn}/quota`, { params: { f29: 99 } }, t0 + 100);
const samples = replies.diagnostics(sn).samples;
assert.equal(samples.length, 20);
assert.deepEqual(samples.at(-1)!.message, { params: { f29: 99 } });
assert.equal(samples.at(-1)!.topic, "…/quota");
console.log("MQTT quota store passed");
