import mqtt, { MqttClient } from "mqtt";
import { EventEmitter } from "events";
import { ecoflowApi } from "./ecoflowApi.js";
import { mqttQuotas } from "./mqttQuota.js";
import { config } from "../config/env.js";

/** After a failed start (e.g. no internet at boot), try again this often. */
const CONNECT_RETRY_MS = 60_000;
/** How often a REST-refused device is asked for its full quota, as the EcoFlow app does. */
const LATEST_QUOTAS_INTERVAL_MS = 20_000;
/** A broker dropping the connection right after a get refuses it; stop asking after this many. */
const MAX_GET_DISCONNECTS = 3;

interface MqttCredentials {
  url: string;
  port: number;
  certificateAccount: string;
  certificatePassword: string;
}

interface DeviceMessage {
  sn: string;
  topic: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

class EcoflowMqttService extends EventEmitter {
  private client: MqttClient | null = null;
  private credentials: MqttCredentials | null = null;
  private subscribedDevices: Set<string> = new Set();
  private reconnectAttempts = 0;
  private connected = false;
  private lastError: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private lastGetAt = 0;
  private getDisconnects = 0;
  private quotaSeen = new Set<string>();
  private repliesSeen = new Set<string>();

  constructor() {
    super();
    mqttQuotas.onWant((sn) => this.subscribeQuota(sn));
  }

  async connect(): Promise<void> {
    if (this.client?.connected) {
      console.log("MQTT already connected");
      return;
    }

    try {
      // Get MQTT credentials from API
      const certData = await ecoflowApi.getMqttCredentials();
      this.credentials = {
        url: certData.url || config.ecoflow.mqttBroker,
        port: certData.port || 8883,
        certificateAccount: certData.certificateAccount,
        certificatePassword: certData.certificatePassword,
      };

      const brokerUrl = `mqtts://${this.credentials.url}:${this.credentials.port}`;
      console.log(`Connecting to MQTT broker: ${brokerUrl}`);

      this.client = mqtt.connect(brokerUrl, {
        clientId: `ecoflow_dashboard_${Date.now()}`,
        username: this.credentials.certificateAccount,
        password: this.credentials.certificatePassword,
        rejectUnauthorized: false, // Ecoflow uses self-signed certs
        keepalive: 60,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
      });

      this.setupEventHandlers();
    } catch (error) {
      console.error("Failed to connect to MQTT:", error);
      this.emit("error", error);
      // Devices whose REST quota is refused depend on MQTT, so keep trying
      this.retryTimer ??= setTimeout(() => {
        this.retryTimer = null;
        this.connect().catch(() => { /* logged above, retried again */ });
      }, CONNECT_RETRY_MS);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on("connect", () => {
      console.log("MQTT connected");
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.emit("connected");

      for (const sn of mqttQuotas.wantedDevices()) this.subscribeQuota(sn);
      this.refreshTimer ??= setInterval(() => {
        for (const sn of mqttQuotas.wantedDevices()) this.requestLatestQuotas(sn);
      }, LATEST_QUOTAS_INTERVAL_MS);
    });

    this.client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        const sn = this.extractSnFromTopic(topic);

        mqttQuotas.sample(sn, topic, data);
        if (topic.endsWith("/quota") && mqttQuotas.apply(sn, data) && !this.quotaSeen.has(sn)) {
          this.quotaSeen.add(sn);
          console.log(`MQTT quota pushes arriving for ${sn}`);
        }
        if (topic.endsWith("/get_reply")) {
          const full = mqttQuotas.applyReply(sn, data);
          if (!this.repliesSeen.has(sn)) {
            this.repliesSeen.add(sn);
            console.log(full
              ? `MQTT full quota arriving for ${sn} (latestQuotas replies)`
              : `MQTT get_reply for ${sn} carried no quota: ${JSON.stringify(data).slice(0, 300)}`);
          }
        }

        const message: DeviceMessage = {
          sn,
          topic,
          data,
          timestamp: new Date(),
        };

        this.emit("message", message);
      } catch (error) {
        console.error("Failed to parse MQTT message:", error);
      }
    });

    // While offline every reconnect attempt fails the same way; report each new
    // error once rather than every few seconds for the length of an outage
    this.client.on("error", (error) => {
      if (error.message === this.lastError) return;
      this.lastError = error.message;
      console.error("MQTT error:", error.message);
      this.emit("error", error);
    });

    this.client.on("close", () => {
      if (!this.connected) return;
      this.connected = false;
      console.log("MQTT connection closed");
      if (Date.now() - this.lastGetAt < 3000 && ++this.getDisconnects === MAX_GET_DISCONNECTS) {
        console.warn("MQTT: the broker drops the connection after latestQuotas requests; relying on pushes alone");
      }
      this.emit("disconnected");
    });

    // Keeps retrying for as long as it takes: devices whose REST quota is refused
    // have no other source
    this.client.on("reconnect", () => {
      this.reconnectAttempts++;
      if (this.reconnectAttempts === 1 || this.reconnectAttempts % 60 === 0) {
        console.log(`MQTT reconnecting... attempt ${this.reconnectAttempts}`);
      }
    });
  }

  private extractSnFromTopic(topic: string): string {
    // Open API topics: /open/{certificateAccount}/{sn}/quota (or /status)
    const open = /^\/open\/[^/]+\/([^/]+)\//.exec(topic);
    if (open) return open[1];
    const parts = topic.split("/");
    return parts[parts.length - 1] || "unknown";
  }

  /**
   * Subscribe to a device's quota pushes and get replies (see mqttQuota.ts), then ask
   * for the full quota. Repeated on reconnect.
   */
  private subscribeQuota(sn: string): void {
    if (!this.client?.connected || !this.credentials) return;
    const base = `/open/${this.credentials.certificateAccount}/${sn}`;
    this.client.subscribe([`${base}/quota`, `${base}/get_reply`], { qos: 1 }, (error) => {
      if (error) {
        console.error(`MQTT subscribe for ${sn} failed: ${error.message}`);
        return;
      }
      console.log(`MQTT subscribed to quota pushes for ${sn}`);
      this.requestLatestQuotas(sn);
    });
  }

  /**
   * Ask the device for its full quota snapshot, answered on get_reply. The push alone
   * is a fixed subset (no AC power, no extra batteries); the EcoFlow app asks the same
   * way. Read-only: it changes nothing on the device.
   */
  private requestLatestQuotas(sn: string): void {
    if (!this.client?.connected || !this.credentials || this.getDisconnects >= MAX_GET_DISCONNECTS) return;
    this.lastGetAt = Date.now();
    const request = { id: Date.now(), version: "1.1", moduleType: 0, operateType: "latestQuotas", params: {}, sn };
    // QoS 0: a QoS 1 publish the broker refused would be queued and resent on every
    // reconnect, so a broker that disconnects for it would never let the session up
    this.client.publish(`/open/${this.credentials.certificateAccount}/${sn}/get`, JSON.stringify(request), { qos: 0 });
  }

  subscribeToDevice(sn: string): void {
    // Devices whose quota the REST API serves are polled; only the ones it refuses
    // are subscribed over MQTT (subscribeQuota).
    if (!this.subscribedDevices.has(sn)) {
      this.subscribedDevices.add(sn);
    }
  }

  unsubscribeFromDevice(sn: string): void {
    this.subscribedDevices.delete(sn);
  }

  disconnect(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this.subscribedDevices.clear();
  }

  isConnected(): boolean {
    return this.client?.connected || false;
  }
}

export const mqttService = new EcoflowMqttService();
