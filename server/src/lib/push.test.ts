import assert from "node:assert/strict";
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

console.log("Push message tests passed");
