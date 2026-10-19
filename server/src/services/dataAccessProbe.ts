// Runs the data access check (see dataAccess.ts) against the cloud: the full quota,
// the named-fields read and the MQTT quota/status topics, for the device and for one
// working device to compare against. Read-only: it sends no commands.
import mqtt from "mqtt";
import { ecoflowApi } from "./ecoflowApi.js";
import { getDeviceProfile } from "./deviceProfiles.js";
import { config } from "../config/env.js";
import {
  PROBE_FIELDS,
  probeFailure,
  probeSuccess,
  probeVerdict,
  type DataAccessReport,
  type DeviceProbe,
  type ProbeRead,
  type ProbeTopic,
} from "./dataAccess.js";

/** MQTT listening time; keeps the whole request well under proxy timeouts (~100 s). */
export const LISTEN_SECONDS = 45;
const CONNECT_TIMEOUT_MS = 20_000;
const SUBSCRIBE_TIMEOUT_MS = 10_000;
const MAX_KEYS = 25;

let running = false;

export const isDataAccessCheckRunning = (): boolean => running;

async function read(run: () => Promise<unknown>): Promise<ProbeRead> {
  try {
    return probeSuccess(await run());
  } catch (error) {
    return probeFailure(error);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type Listened = Map<string, { quota: ProbeTopic; status: ProbeTopic }>;

/**
 * Subscribe to each device's quota and status topics and count what arrives. Uses its
 * own client, so the dashboard's MQTT connection is left alone.
 */
async function listenMqtt(serials: string[], listenMs: number): Promise<Listened> {
  const cert = await ecoflowApi.getMqttCredentials();
  const account = cert.certificateAccount;
  const client = mqtt.connect(`mqtts://${cert.url || config.ecoflow.mqttBroker}:${cert.port || 8883}`, {
    clientId: `ecoflow_dashboard_probe_${Date.now()}`,
    username: account,
    password: cert.certificatePassword,
    rejectUnauthorized: false, // same as mqttService.ts
    reconnectPeriod: 0,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  let lastError: Error | null = null;
  client.on("error", (error) => { lastError = error; });

  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("close", () => reject(lastError ?? new Error("connection closed")));
    }), CONNECT_TIMEOUT_MS, "MQTT connect");

    const listened: Listened = new Map();
    const topics = new Map<string, ProbeTopic>();
    for (const sn of serials) {
      const entry = {
        quota: { subscribed: false, messages: 0, keys: [] as string[] },
        status: { subscribed: false, messages: 0, keys: [] as string[] },
      };
      listened.set(sn, entry);
      topics.set(`/open/${account}/${sn}/quota`, entry.quota);
      topics.set(`/open/${account}/${sn}/status`, entry.status);
    }

    client.on("message", (topic, payload) => {
      const entry = topics.get(topic);
      if (!entry) return;
      entry.messages++;
      try {
        const message = JSON.parse(payload.toString()) as Record<string, unknown>;
        const params = message.params && typeof message.params === "object" ? message.params : message;
        for (const key of Object.keys(params)) {
          if (entry.keys.length < MAX_KEYS && !entry.keys.includes(key)) entry.keys.push(key);
        }
      } catch { /* not JSON; still counted */ }
    });

    // One topic per request: a refusal fails the whole SUBACK, so this tells which one
    for (const [topic, entry] of topics) {
      try {
        await withTimeout(client.subscribeAsync(topic, { qos: 1 }), SUBSCRIBE_TIMEOUT_MS, "subscribe");
        entry.subscribed = true;
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, listenMs));
    return listened;
  } finally {
    client.end(true);
  }
}

type ListItem = Awaited<ReturnType<typeof ecoflowApi.getDeviceList>>[number];

async function readDevice(sn: string, listed: ListItem | undefined): Promise<DeviceProbe> {
  return {
    serialNumber: sn,
    name: listed?.deviceName ?? null,
    productName: listed?.productName ?? null,
    inList: listed !== undefined,
    cloudOnline: (listed?.cloudOnline ?? listed?.online) === 1,
    quotaAll: await read(() => ecoflowApi.probeQuotaAll(sn)),
    quotaFields: await read(() => ecoflowApi.getQuotaFields(sn, PROBE_FIELDS)),
    mqtt: null,
  };
}

export async function runDataAccessCheck(sn: string): Promise<DataAccessReport> {
  if (running) throw new Error("A data access check is already running");
  running = true;
  try {
    const list = await ecoflowApi.getDeviceList();
    const other = list.find((device) =>
      device.sn !== sn &&
      (device.cloudOnline ?? device.online) === 1 &&
      getDeviceProfile(device.productName).status === "supported");

    const target = await readDevice(sn, list.find((device) => device.sn === sn));
    const comparison = other ? await readDevice(other.sn, other) : null;

    let mqttError: string | null = null;
    let listened: Listened = new Map();
    try {
      listened = await listenMqtt(other ? [sn, other.sn] : [sn], LISTEN_SECONDS * 1000);
    } catch (error) {
      mqttError = error instanceof Error ? error.message : String(error);
    }
    target.mqtt = listened.get(target.serialNumber) ?? null;
    if (comparison) comparison.mqtt = listened.get(comparison.serialNumber) ?? null;

    return {
      checkedAt: new Date().toISOString(),
      listenSeconds: LISTEN_SECONDS,
      mqttError,
      target,
      comparison,
      verdict: probeVerdict(target, comparison),
    };
  } finally {
    running = false;
  }
}
