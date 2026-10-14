import assert from "node:assert/strict";
import { decodeCharCodes, extractTechnicalInfo, formatPackedVersion } from "./deviceInfo.js";
import { deltaProQuotaFixture } from "./__fixtures__/deltaProQuota.js";

// Versions are one byte per part, high byte first.
assert.equal(formatPackedVersion(16908444), "1.2.0.156");
assert.equal(formatPackedVersion(196610), "0.3.0.2");
assert.equal(formatPackedVersion(0), null);
assert.equal(formatPackedVersion(undefined), null);

// Pack serials are NUL-padded char codes; an all-zero serial means "not set".
const slaveSn = [69, 51, 69, 66, 90, 53, 90, 69, 65, 49, 53, 48, 49, 48, 49, 0];
assert.equal(decodeCharCodes(slaveSn), "E3EBZ5ZEA150101");
assert.equal(decodeCharCodes(new Array(16).fill(48)), null);

const info = extractTechnicalInfo("DCABZ1234", "DELTA Pro", {
  ...deltaProQuotaFixture,
  "pd.sysVer": 16908444,
  "pd.wifiVer": 196610,
  "pd.wifiRssi": -58,
  "pd.model": 1,
  "mppt.swVer": 50397234,
  "bmsMaster.packSn": new Array(16).fill(48),
  "bmsMaster.sysVer": 16844066,
  "bmsSlave1.packSn": slaveSn,
});
assert.equal(info.serialNumber, "DCABZ1234");
assert.equal(info.model, 1);
assert.deepEqual(info.firmware.map((f) => f.version), ["1.2.0.156", "3.1.0.50", "1.1.5.34"]);
assert.deepEqual(info.batteryPacks, [
  { label: "Main battery", serialNumber: null, firmware: "1.1.5.34" },
  { label: "Extra battery 1", serialNumber: "E3EBZ5ZEA150101", firmware: null },
]);
assert.deepEqual(info.wifi, { rssi: -58, ssid: null, macAddress: null, firmware: "0.3.0.2" });
assert.equal(info.recordedAt, null);

// RSSI 0 is what devices send when they do not measure it.
assert.equal(extractTechnicalInfo("SN", "DELTA Pro", { "pd.wifiRssi": 0 }).wifi.rssi, null);

// Models that do report MAC/SSID get them picked up by key name.
const other = extractTechnicalInfo("SN", "X", { "wifi.mac": "a1b2c3d4e5f6", "pd.wifiSsid": "Home" }, "2026-01-01 00:00:00");
assert.equal(other.wifi.macAddress, "A1:B2:C3:D4:E5:F6");
assert.equal(other.wifi.ssid, "Home");
assert.equal(other.recordedAt, "2026-01-01 00:00:00");

console.log("deviceInfo tests passed");
