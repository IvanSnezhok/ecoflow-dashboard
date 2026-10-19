import assert from "node:assert/strict";
import {
  appTopics, defaultAppRegion, isAppRegion, latestQuotasRequest, loginBody, maskEmail, parseAppTopic,
} from "./appChannelProtocol.js";

assert.equal(defaultAppRegion("https://api-e.ecoflow.com"), "api-e");
assert.equal(defaultAppRegion("https://api.ecoflow.com"), "api");
assert.equal(defaultAppRegion("https://example.com"), "api");
assert.equal(defaultAppRegion("not a url"), "api");
assert.equal(isAppRegion("api-a"), true);
assert.equal(isAppRegion("api-cn"), false, "phone-number logins are not supported");

const body = loginBody("me@example.com", "pässword");
assert.equal(body.email, "me@example.com");
assert.equal(Buffer.from(String(body.password), "base64").toString("utf8"), "pässword");
assert.equal(body.scene, "IOT_APP");
assert.equal(body.userType, "ECOFLOW");

const topics = appTopics("1234567890", "DAEBZ5KF0000000");
assert.deepEqual(topics, {
  data: "/app/device/property/DAEBZ5KF0000000",
  get: "/app/1234567890/DAEBZ5KF0000000/thing/property/get",
  getReply: "/app/1234567890/DAEBZ5KF0000000/thing/property/get_reply",
});
assert.deepEqual(parseAppTopic(topics.data, "1234567890"), { sn: "DAEBZ5KF0000000", kind: "data" });
assert.deepEqual(parseAppTopic(topics.getReply, "1234567890"), { sn: "DAEBZ5KF0000000", kind: "getReply" });
assert.equal(parseAppTopic(topics.get, "1234567890"), null, "our own requests are not device output");
assert.equal(parseAppTopic(topics.getReply, "999"), null, "another account's replies");
assert.equal(parseAppTopic("/open/x/DAEBZ5KF0000000/quota", "1234567890"), null);

assert.deepEqual(latestQuotasRequest(42), {
  from: "HomeAssistant", id: "42", version: "1.1", moduleType: 0, operateType: "latestQuotas", params: {},
});
assert.equal(maskEmail("ivan@example.com"), "iv…@example.com");
assert.equal(maskEmail("x"), "x…@");
console.log("App channel protocol passed");
