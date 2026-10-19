// Runs the data access check (see dataAccess.ts) against the cloud: the full quota,
// the named-fields read and the device's MQTT topics, for the device and for one
// working device to compare against. On MQTT it also tries the known formats of a
// full-quota request (a read, answered on /get_reply). It sends no commands.
import mqtt from "mqtt";
import { ecoflowApi } from "./ecoflowApi.js";
import { getDeviceProfile } from "./deviceProfiles.js";
import { config } from "../config/env.js";
import { FULL_QUOTA_REQUESTS } from "./mqttQuota.js";
import {
  PROBE_FIELDS,
  countTopicMessage,
  probeFailure,
  probeSuccess,
  probeVerdict,
  recordGetReply,
  type DataAccessReport,
  type DeviceProbe,
  type ProbeGet,
  type ProbeMqtt,
  type ProbeRead,
  type ProbeTopic,
} from "./dataAccess.js";

/** MQTT listening time; keeps the whole request well under proxy timeouts (~100 s). */
export const LISTEN_SECONDS = 45;
const CONNECT_TIMEOUT_MS = 20_000;
const SUBSCRIBE_TIMEOUT_MS = 10_000;

/** The panel's full-quota requests plus the REST-style field list. All are reads. */
const GET_VARIANTS = [
  ...FULL_QUOTA_REQUESTS,
  { variant: "quotas", build: (id: number, sn: string) => ({ id, version: "1.0", sn, params: { quotas: PROBE_FIELDS } }) },
];

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

const emptyTopic = (): ProbeTopic => ({ subscribed: false, messages: 0, keys: [], maxFields: 0 });

interface Listened {
  devices: Map<string, ProbeMqtt>;
  subscription: "wildcard" | "topics";
  /** Why the connection ended early, if it did */
  note: string | null;
}

/**
 * Listen to each device's MQTT topics, sending the full-quota requests at the start and
 * halfway. Uses its own client, so the dashboard's MQTT connection is left alone.
 */
async function listenMqtt(serials: string[], listenMs: number): Promise<Listened> {
  const cert = await ecoflowApi.getMqttCredentials();
  const prefix = `/open/${cert.certificateAccount}/`;
  const client = mqtt.connect(`mqtts://${cert.url || config.ecoflow.mqttBroker}:${cert.port || 8883}`, {
    clientId: `ecoflow_dashboard_probe_${Date.now()}`,
    username: cert.certificateAccount,
    password: cert.certificatePassword,
    rejectUnauthorized: false, // same as mqttService.ts
    reconnectPeriod: 0,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  let lastError: Error | null = null;
  let closedAt = 0;
  let lastGetAt = 0;
  client.on("error", (error) => { lastError = error; });
  client.on("close", () => { closedAt ||= Date.now(); });

  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("close", () => reject(lastError ?? new Error("connection closed")));
    }), CONNECT_TIMEOUT_MS, "MQTT connect");

    const devices = new Map<string, ProbeMqtt>();
    for (const sn of serials) {
      devices.set(sn, {
        quota: emptyTopic(),
        status: emptyTopic(),
        getReply: emptyTopic(),
        gets: GET_VARIANTS.map(({ variant }) => ({ variant, sent: 0, replies: 0, fieldCount: 0 })),
        otherTopics: {},
      });
    }
    const sentIds = new Map<string, ProbeGet>();

    client.on("message", (topic, payload) => {
      if (!topic.startsWith(prefix)) return;
      const [sn, ...rest] = topic.slice(prefix.length).split("/");
      const device = devices.get(sn);
      if (!device) return;
      const suffix = rest.join("/");
      // Requests, ours included (the wildcard echoes them back), not device output
      if (suffix === "get" || suffix === "set") return;
      let message: unknown = null;
      try { message = JSON.parse(payload.toString()); } catch { /* not JSON; still counted */ }
      const entry = suffix === "quota" ? device.quota : suffix === "status" ? device.status : suffix === "get_reply" ? device.getReply : null;
      if (!entry) {
        device.otherTopics[suffix] = (device.otherTopics[suffix] ?? 0) + 1;
        return;
      }
      countTopicMessage(entry, message);
      if (entry === device.getReply) recordGetReply(sentIds, message);
    });

    // A wildcard shows replies on topics nobody documents; without it, topic by topic.
    // One topic per request: a refusal fails the whole SUBACK, so this tells which one.
    const subscribe = async (topic: string): Promise<string | null> => {
      try {
        await withTimeout(client.subscribeAsync(topic, { qos: 1 }), SUBSCRIBE_TIMEOUT_MS, "subscribe");
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    let subscription: Listened["subscription"] = "wildcard";
    for (const [sn, device] of devices) {
      if ((await subscribe(`${prefix}${sn}/#`)) === null) {
        device.quota.subscribed = device.status.subscribed = device.getReply.subscribed = true;
        continue;
      }
      subscription = "topics";
      for (const [suffix, entry] of [["quota", device.quota], ["status", device.status], ["get_reply", device.getReply]] as const) {
        const error = await subscribe(`${prefix}${sn}/${suffix}`);
        entry.subscribed = error === null;
        if (error) entry.error = error;
      }
    }

    // QoS 0, as in mqttService.ts: a refused QoS 1 publish would be queued and resent
    let nextId = Date.now();
    const sendGets = () => {
      if (!client.connected) return;
      for (const [sn, device] of devices) {
        GET_VARIANTS.forEach(({ build }, index) => {
          const id = nextId++;
          const get = device.gets[index];
          sentIds.set(String(id), get);
          get.sent++;
          lastGetAt = Date.now();
          client.publish(`${prefix}${sn}/get`, JSON.stringify(build(id, sn)), { qos: 0 });
        });
      }
    };
    sendGets();
    await new Promise((resolve) => setTimeout(resolve, listenMs / 2));
    sendGets();
    await new Promise((resolve) => setTimeout(resolve, listenMs / 2));

    const note = !closedAt ? null
      : closedAt - lastGetAt < 3000 ? "the broker closed the connection right after a full-quota request"
        : "the connection closed while listening";
    return { devices, subscription, note };
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
    let listened: Listened | null = null;
    try {
      listened = await listenMqtt(other ? [sn, other.sn] : [sn], LISTEN_SECONDS * 1000);
      mqttError = listened.note;
    } catch (error) {
      mqttError = error instanceof Error ? error.message : String(error);
    }
    target.mqtt = listened?.devices.get(target.serialNumber) ?? null;
    if (comparison) comparison.mqtt = listened?.devices.get(comparison.serialNumber) ?? null;

    return {
      checkedAt: new Date().toISOString(),
      listenSeconds: LISTEN_SECONDS,
      mqttError,
      mqttSubscription: listened?.subscription ?? null,
      target,
      comparison,
      verdict: probeVerdict(target, comparison),
    };
  } finally {
    running = false;
  }
}
