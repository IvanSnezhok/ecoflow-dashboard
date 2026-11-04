import assert from "node:assert/strict";
import {
  MQTT_QUOTA_FRESH_MS, MqttQuotaStore, hasBatteryLevel, mergeLive, quotaMessageFields, replyMessageFields,
} from "./mqttQuota.js";

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
// The cloud's answer for a device it takes as offline is no quota, nor is an empty map
assert.equal(replyMessageFields({ operateType: "latestQuotas", data: { online: 0, sn } }), null);
assert.equal(replyMessageFields({ operateType: "latestQuotas", data: { online: 1, sn, quotaMap: {} } }), null);
// Some replies carry the map as a JSON string
assert.deepEqual(replyMessageFields({ data: { online: 1, quotaMap: JSON.stringify({ "inv.inputWatts": 180 }) } }), { "inv.inputWatts": 180 });
assert.equal(replyMessageFields({ data: { online: 1, quotaMap: "not json" } }), null);

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

// A shared DELTA Max: the Open API push repeats SOC and battery power every few seconds;
// the app channel had one snapshot and then only messages without the SOC.
const openApi = new MqttQuotaStore();
const app = new MqttQuotaStore();
app.applyReply(sn, { data: { online: 1, quotaMap: { "bmsMaster.soc": 100, "inv.inputWatts": 180, "bmsSlave1.vol": 52000, "bmsSlave1.soc": 100 } } }, t0);
for (let at = t0; at <= t0 + 3 * 60_000; at += 5_000) {
  openApi.apply(sn, { params: { "bmsMaster.soc": 100, "bmsMaster.inputWatts": 3, "bmsMaster.outputWatts": 0 } }, at);
}
app.apply(sn, { params: { "inv.inputWatts": 176, "bmsSlave1.vol": 52010 } }, t0 + 2.5 * 60_000);
const now = t0 + 3 * 60_000;
assert.equal(app.fresh(sn, now), null, "the app channel alone lacks a fresh SOC");
const merged = mergeLive(openApi.live(sn, now), app.live(sn, now));
assert.equal(hasBatteryLevel(merged), true, "the push supplies it");
assert.equal(merged["inv.inputWatts"], 176, "AC input from the app channel is kept");
assert.equal(merged["bmsSlave1.vol"], 52010, "and the extra battery");
assert.equal("bmsSlave1.soc" in merged, false, "a snapshot field older than 2 min still drops out");
assert.equal(app.lastReplyAt(sn), t0);
assert.equal(app.diagnostics(sn, now).liveFieldCount, 2);
assert.equal(app.diagnostics(sn, now).lastReplyAt, new Date(t0).toISOString());

// For a field both report, the newer report wins whichever channel sent it
const older = { values: { "pd.soc": 80, a: 1 }, seenAt: { "pd.soc": t0, a: t0 } };
const newer = { values: { "pd.soc": 81 }, seenAt: { "pd.soc": t0 + 1 } };
assert.deepEqual(mergeLive(older, newer), { "pd.soc": 81, a: 1 });
assert.deepEqual(mergeLive(newer, older), { "pd.soc": 81, a: 1 });
assert.deepEqual(mergeLive(null, null), {});
assert.equal(new MqttQuotaStore().live(sn, t0), null);
console.log("MQTT quota store passed");
