import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { apnsJwt, isApnsToken, liveActivityPayload, outageActivityProps } from "./apns.js";
import { isExpoPushToken, lowBatteryStep, pushText } from "./pushMessages.js";

// Battery low: once at the threshold, again only after recovering by 5 points
let armed: boolean | undefined;
const feed = (soc: number) => {
  const step = lowBatteryStep(soc, 20, armed);
  armed = step.armed;
  return step.notify;
};
assert.equal(feed(18), false, "already low at the first reading: silent");
assert.equal(feed(17), false);
assert.equal(feed(24), false, "not recovered enough");
assert.equal(feed(19), false);
assert.equal(feed(25), false, "re-armed");
assert.equal(feed(21), false);
assert.equal(feed(20), true, "reaching the threshold notifies");
assert.equal(feed(19), false, "only once");
armed = undefined;
assert.equal(feed(60), false);
assert.equal(feed(20), true);

// Texts
assert.deepEqual(pushText({ kind: "gridOff", name: "Garage", soc: 78, reserveHours: 7.5 }, "en"), {
  title: "Power is out", body: "Garage runs on battery, 78% left. It lasts about 7 h 30 min.",
});
assert.equal(pushText({ kind: "gridOff", name: "Гараж", soc: 78, reserveHours: null }, "uk").body, "Гараж працює від батареї, заряд 78%.");
assert.equal(pushText({ kind: "gridOn", name: "Garage", outageMinutes: 125 }, "uk").body, "Відключення тривало 2 год 5 хв.");
assert.equal(pushText({ kind: "gridOn", name: "Garage", outageMinutes: null }, "en").body, "Garage");
assert.equal(pushText({ kind: "lowBattery", name: "Garage", soc: 20 }, "en").title, "Battery low: 20%");

// Tokens
assert.equal(isExpoPushToken("ExponentPushToken[abcDEF123_-xyz]"), true);
assert.equal(isExpoPushToken("ExpoPushToken[abcDEF123456]"), true);
assert.equal(isExpoPushToken("ExponentPushToken[]"), false);
assert.equal(isExpoPushToken("https://evil.example/ExponentPushToken[abcdefghijk]"), false);
assert.equal(isExpoPushToken(42), false);

// Live Activity pushes to Apple
{
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwt = apnsJwt(privateKey, "KEYID12345", "TEAMID1234", 1_800_000_000_000);
  const [head, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(head, "base64url").toString()), { alg: "ES256", kid: "KEYID12345" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { iss: "TEAMID1234", iat: 1_800_000_000 });
  assert.equal(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);

  const props = outageActivityProps("uk", { name: "DELTA Pro", soc: 77.6, since: 1_800_000_000_000, reserveHours: 5.5, over: false });
  assert.deepEqual(props, { name: "DELTA Pro", soc: 78, title: "Світла немає", since: 1_800_000_000_000, reserve: "≈ 5 год 30 хв на батареї", ended: "" });
  assert.equal(outageActivityProps("en", { name: "x", soc: null, since: 1, reserveHours: null, over: true }).ended, "Power is back");
  assert.equal(outageActivityProps("en", { name: "x", soc: 50, since: 1, reserveHours: 0.5, over: false }).reserve, "≈ 30 min on battery");

  const start = liveActivityPayload("start", props, 1_800_000_060_000, { title: "t", body: "b" }).aps;
  assert.equal(start.event, "start");
  assert.equal(start.timestamp, 1_800_000_060);
  assert.equal(start["attributes-type"], "LiveActivityAttributes");
  assert.deepEqual(start.alert, { title: "t", body: "b" });
  const state = start["content-state"] as { name: string; props: string };
  assert.equal(state.name, "OutageActivity");
  assert.deepEqual(JSON.parse(state.props), props);
  assert.equal(start["stale-date"], 1_800_000_060 + 1800);

  const end = liveActivityPayload("end", props, 1_800_000_060_000).aps;
  assert.equal(end["dismissal-date"], 1_800_000_060 + 300);
  assert.equal("alert" in end, false);
  assert.equal("stale-date" in end, false);

  assert.equal(isApnsToken("ab12".repeat(16)), true);
  assert.equal(isApnsToken("ExponentPushToken[abcdefghijk]"), false);
  assert.equal(isApnsToken("../../3/device/x"), false);
}

console.log("Push message tests passed");
