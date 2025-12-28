import mqtt, { MqttClient } from "mqtt";
import { EventEmitter } from "events";
import { ecoflowApi } from "./ecoflowApi.js";
import { config } from "../config/env.js";

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
  private maxReconnectAttempts = 10;

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
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on("connect", () => {
      console.log("MQTT connected");
      this.reconnectAttempts = 0;
      this.emit("connected");

      // Resubscribe to previously subscribed devices
      this.subscribedDevices.forEach((sn) => {
        this.subscribeToDevice(sn);
      });
    });

    this.client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        const sn = this.extractSnFromTopic(topic);

        const message: DeviceMessage = {
          sn,
          topic,
          data,
          timestamp: new Date(),
        };

        this.emit("message", message);
        console.log(
          `MQTT message from ${sn}:`,
          JSON.stringify(data).slice(0, 200),
        );
      } catch (error) {
        console.error("Failed to parse MQTT message:", error);
      }
    });

    this.client.on("error", (error) => {
      console.error("MQTT error:", error);
      this.emit("error", error);
    });

    this.client.on("close", () => {
      console.log("MQTT connection closed");
      this.emit("disconnected");
    });

    this.client.on("reconnect", () => {
      this.reconnectAttempts++;
      console.log(`MQTT reconnecting... attempt ${this.reconnectAttempts}`);

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error("Max reconnect attempts reached");
        this.client?.end();
      }
    });
  }

  private extractSnFromTopic(topic: string): string {
    // Topic format: /app/device/property/{sn}
    const parts = topic.split("/");
    return parts[parts.length - 1] || "unknown";
  }

  subscribeToDevice(sn: string): void {
    // Note: MQTT subscription is not supported with Ecoflow Developer API credentials
    // The official Developer API only provides MQTT connection but doesn't allow topic subscriptions
    // Real-time updates are handled via REST API polling instead
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
