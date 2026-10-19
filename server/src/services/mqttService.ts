import mqtt, { MqttClient } from "mqtt";
import { EventEmitter } from "events";
import { ecoflowApi } from "./ecoflowApi.js";
import { mqttQuotas } from "./mqttQuota.js";
import { config } from "../config/env.js";

/** After a failed start (e.g. no internet at boot), try again this often. */
const CONNECT_RETRY_MS = 60_000;

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
  private quotaSeen = new Set<string>();

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
    });

    this.client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        const sn = this.extractSnFromTopic(topic);

        if (topic.endsWith("/quota") && mqttQuotas.apply(sn, data) && !this.quotaSeen.has(sn)) {
          this.quotaSeen.add(sn);
          console.log(`MQTT quota pushes arriving for ${sn}`);
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

  /** Subscribe to a device's quota pushes (see mqttQuota.ts); repeated on reconnect. */
  private subscribeQuota(sn: string): void {
    if (!this.client?.connected || !this.credentials) return;
    const topic = `/open/${this.credentials.certificateAccount}/${sn}/quota`;
    this.client.subscribe(topic, { qos: 1 }, (error) => {
      if (error) console.error(`MQTT subscribe for ${sn} failed: ${error.message}`);
      else console.log(`MQTT subscribed to quota pushes for ${sn}`);
    });
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
