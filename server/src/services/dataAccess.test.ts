import assert from "node:assert/strict";
import { EcoflowApiError } from "../lib/ecoflowApiError.js";
import {
  countTopicMessage, probeFailure, probeSuccess, probeVerdict, recordGetReply, type DeviceProbe, type ProbeGet,
} from "./dataAccess.js";

const refused = probeFailure(new EcoflowApiError("1006", "current device is not allowed to get device info"));
assert.deepEqual(refused, { ok: false, code: "1006", message: "current device is not allowed to get device info" });
assert.deepEqual(probeFailure(new Error("fetch failed")), { ok: false, message: "fetch failed" });

const answered = probeSuccess({ "pd.soc": 87, "inv.outputWatts": 120, "pd.wifiRssi": -60 });
assert.deepEqual(answered, { ok: true, fieldCount: 3, sample: { "pd.soc": 87, "inv.outputWatts": 120 } });
assert.deepEqual(probeSuccess(null), { ok: true, fieldCount: 0, sample: {} });

const silent = { subscribed: true, messages: 0, keys: [] as string[], maxFields: 0 };
const mqttWith = (quota = silent) => ({ quota, status: silent, getReply: silent, gets: [], otherTopics: {} });
const probe = (overrides: Partial<DeviceProbe>): DeviceProbe => ({
  serialNumber: "DAEBZ5KF0000000", name: "DELTA Max", productName: "DELTA Max",
  inList: true, cloudOnline: true, quotaAll: refused, quotaFields: refused,
  mqtt: mqttWith(), ...overrides,
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
  probeVerdict(probe({ mqtt: mqttWith({ subscribed: true, messages: 4, keys: ["pd.soc"], maxFields: 4 }) }), working),
  "mqtt-only",
);
assert.equal(probeVerdict(probe({ cloudOnline: false }), working), "offline");
assert.equal(probeVerdict(probe({ inList: false, cloudOnline: false }), working), "not-listed");
// Topic counting: field names and the largest message
const topic = { subscribed: true, messages: 0, keys: [] as string[], maxFields: 0 };
countTopicMessage(topic, { params: { "pd.soc": 1, "pd.usb1Watts": 0 } });
countTopicMessage(topic, { data: { quotaMap: { "pd.soc": 1, "inv.inputWatts": 2, "bmsSlave1.soc": 3 } } });
countTopicMessage(topic, "not json");
assert.deepEqual(topic, {
  subscribed: true, messages: 3, keys: ["pd.soc", "pd.usb1Watts", "inv.inputWatts", "bmsSlave1.soc"], maxFields: 3,
});

// get_reply attribution by request id: a snapshot, a refusal, and a reply to nothing sent
const latest: ProbeGet = { variant: "latestQuotas", sent: 1, replies: 0, fieldCount: 0 };
const app: ProbeGet = { variant: "latestQuotas (app)", sent: 1, replies: 0, fieldCount: 0 };
const sent = new Map([["100", latest], ["101", app]]);
assert.equal(recordGetReply(sent, { id: 100, data: { quotaMap: { "pd.soc": 93, "inv.inputWatts": 182 } } }), true);
assert.equal(recordGetReply(sent, { id: "101", code: "1006", message: "not allowed" }), true);
assert.equal(recordGetReply(sent, { id: 999, data: { "pd.soc": 1 } }), false);
assert.deepEqual(latest, { variant: "latestQuotas", sent: 1, replies: 1, fieldCount: 2 });
assert.deepEqual(app, { variant: "latestQuotas (app)", sent: 1, replies: 1, fieldCount: 0, code: "1006", message: "not allowed" });
console.log("Data access check passed");
