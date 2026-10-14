import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Configuration is read at import time
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecoflow-ble-"));
process.env.ECOFLOW_DB_PATH = path.join(dir, "test.db");
process.env.ECOFLOW_ACCESS_KEY ??= "test-access";
process.env.ECOFLOW_SECRET_KEY ??= "test-secret";
process.env.ECOFLOW_BLE_BRIDGE_URL = "http://bridge.test";
delete process.env.ECOFLOW_BLE_MODE;

const SN = "DCEBZ5ZE1234567";
const bleQuota = { "pd.soc": 77, "bmsMaster.soc": 77, "inv.outputWatts": 120, "inv.cfgAcEnabled": 1 };
let bridgeAuthenticated = true;
let bridgeCommandFails = false;
let cloudUp = false;
const calls: string[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  calls.push(`${method} ${url.host}${url.pathname}`);
  if (url.host === "bridge.test") {
    if (url.pathname === "/status") {
      const now = Date.now();
      return json({
        scanning: true, scannerError: null, userIdConfigured: true, now,
        devices: [{
          sn: SN, name: "EF-DC4567", address: "AA:BB", rssi: -61, advertisedAt: now, state: "authenticated",
          supported: true, authenticated: bridgeAuthenticated, authenticatedSince: now - 60_000, lastPacketAt: now,
          error: null, pausedUntil: null, sessionsStarted: 1, quota: bleQuota, quotaUpdatedAt: now - 1_000,
        }],
      });
    }
    if (url.pathname.endsWith("/command")) {
      return bridgeCommandFails ? json({ error: "device rejected the command" }, 503) : json({ ok: true });
    }
  }
  if (!cloudUp) throw new TypeError("fetch failed");
  if (url.pathname.endsWith("/device/list")) {
    return json({ code: "0", message: "ok", data: [{ sn: SN, deviceName: "Delta", online: 0, productName: "DELTA Pro" }] });
  }
  if (url.pathname.endsWith("/device/quota") && method === "PUT") return json({ code: "0", message: "ok", data: null });
  return json({ code: "1006", message: "device offline", data: null });
}) as typeof fetch;

const { initDatabase, db } = await import("../db/database.js");
initDatabase();
db.prepare("INSERT INTO devices (serial_number, device_type, name) VALUES (?, 'DELTA Pro', 'Delta')").run(SN);
const { ecoflowApi } = await import("./ecoflowApi.js");
const { bleBridge, mergeQuotas } = await import("./bleBridge.js");
await bleBridge.refresh();

// Cloud unreachable at start: the database stands in for the device list, BLE marks it online
let list = await ecoflowApi.getDeviceList();
assert.equal(list.length, 1);
assert.equal(list[0].online, 1);
assert.equal(list[0].cloudOnline, 0);
assert.equal(list[0].bleOnline, true);

// Quota comes from BLE without touching the cloud
calls.length = 0;
const quota = await ecoflowApi.getDeviceQuota(SN);
assert.equal(quota["pd.soc"], 77);
assert.equal(ecoflowApi.getDataSource(SN), "ble");

// Commands go over BLE first in the default "prefer" mode...
calls.length = 0;
await ecoflowApi.setAcOutput(SN, false);
assert.deepEqual(calls.filter((c) => !c.endsWith("/status")), ["POST bridge.test/devices/DCEBZ5ZE1234567/command"]);

// ...and fall back to the cloud when BLE rejects them
cloudUp = true;
bridgeCommandFails = true;
calls.length = 0;
await ecoflowApi.setAcOutput(SN, true);
assert.deepEqual(calls.filter((c) => !c.endsWith("/status")), [
  "POST bridge.test/devices/DCEBZ5ZE1234567/command",
  "PUT api-e.ecoflow.com/iot-open/sign/device/quota",
]);

// Both channels down: one error naming both
cloudUp = false;
await assert.rejects(ecoflowApi.setAcOutput(SN, true), /BLE: .*device rejected.*cloud: /);

// Without an authenticated session BLE is not used at all
bridgeAuthenticated = false;
await bleBridge.refresh();
cloudUp = true;
list = await ecoflowApi.getDeviceList();
assert.equal(list[0].online, 0);
await assert.rejects(ecoflowApi.getDeviceQuota(SN), /device offline/);

// Merge: BLE wins its keys; stale cloud keeps only slow-changing extra-battery fields
const cloud = { "pd.soc": 70, "pd.carWatts": 5, "bmsSlave1.fullCap": 80000, "bmsSlave1.vol": 51000, "bmsSlave1.cycles": 30 };
const merged = mergeQuotas(cloud, 10 * 60_000, { "pd.soc": 77, "bmsSlave1.soc": 55 });
assert.deepEqual(merged, { "pd.soc": 77, "pd.carWatts": 5, "bmsSlave1.fullCap": 80000, "bmsSlave1.cycles": 30, "bmsSlave1.soc": 55 });
assert.equal(mergeQuotas(cloud, 30_000, {})["bmsSlave1.vol"], 51000);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log("BLE routing tests passed");
