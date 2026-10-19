// EcoFlow app channel: the private API the EcoFlow app itself uses, for devices the
// Open API serves only in part. A DELTA Max shared from another account is refused over
// REST (1006) and its Open API MQTT push has 23 fields (no AC power, no extra
// batteries), while the app shows everything. The panel signs in like the app, keeps
// the token (never the password) and reads such devices over the app's MQTT: their
// /app/device/property/<sn> pushes plus the latestQuotas snapshot the app asks for.
// Unofficial: EcoFlow may change it without notice. Read-only: no commands go out here.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import mqtt, { type MqttClient } from "mqtt";
import { config } from "../config/env.js";
import { MqttQuotaStore, mqttQuotas } from "./mqttQuota.js";
import {
  appTopics,
  defaultAppRegion,
  isAppRegion,
  latestQuotasRequest,
  loginBody,
  maskEmail,
  parseAppTopic,
  type AppRegion,
} from "./appChannelProtocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Token and user ID, in the data volume like the BLE user ID */
const ACCOUNT_FILE = path.resolve(__dirname, "../../data/app-account.json");
/** How often each device is asked for its full snapshot, as the app does */
const LATEST_QUOTAS_INTERVAL_MS = 20_000;
/** After a failed connect (no internet, broker refused), try again this often */
const RETRY_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** EcoFlow refused the login, or the saved token: signing in again is needed. */
export class AppAuthError extends Error {}

interface Account {
  userId: string;
  token: string;
  region: AppRegion;
  emailHint: string;
  /** panel: the Settings login; env: ECOFLOW_APP_EMAIL / ECOFLOW_APP_PASSWORD */
  source: "panel" | "env";
  signedInAt: string;
}

export interface AppChannelStatus {
  signedIn: boolean;
  source: Account["source"] | null;
  emailHint: string | null;
  userIdHint: string | null;
  region: AppRegion | null;
  defaultRegion: AppRegion;
  connected: boolean;
  lastError: string | null;
  /** Devices read through the app channel: the ones the Open API refuses over REST */
  devices: string[];
  envConfigured: boolean;
}

/** Quota merged from the app channel, read by ecoflowApi for REST-refused devices */
export const appQuotas = new MqttQuotaStore();

const apiUrl = (region: AppRegion, pathAndQuery: string) => config.app.apiBase.replace("{region}", region) + pathAndQuery;

async function callEcoflow(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`EcoFlow answered ${response.status} ${response.statusText}`);
  const json = (await response.json()) as { code?: unknown; message?: unknown; data?: unknown };
  if (String(json.code) !== "0") {
    throw new AppAuthError(typeof json.message === "string" && json.message ? json.message : `EcoFlow code ${String(json.code)}`);
  }
  return json.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : {};
}

class AppChannel {
  private account: Account | null = null;
  private client: MqttClient | null = null;
  private connected = false;
  private lastError: string | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private seq = Date.now();
  private seen = new Set<string>();

  constructor() {
    mqttQuotas.onWant((sn) => this.subscribe(sn));
  }

  private get defaultRegion(): AppRegion {
    return isAppRegion(config.app.region) ? config.app.region : defaultAppRegion(config.ecoflow.apiEndpoint);
  }

  private get envConfigured(): boolean {
    return Boolean(config.app.email && config.app.password);
  }

  /** On server start: resume the saved sign-in, else sign in from .env when configured. */
  start(): void {
    const saved = this.load();
    if (saved) void this.resume(saved);
    else if (this.envConfigured) void this.signInFromEnv();
  }

  stop(): void {
    this.closeMqtt();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** The Settings login. The password goes to EcoFlow once and is not kept. */
  async login(email: string, password: string, region: AppRegion): Promise<void> {
    const account = await this.authenticate(email, password, region, "panel");
    await this.connect(account);
    this.save(account);
  }

  logout(): void {
    this.stop();
    this.account = null;
    this.lastError = null;
    try {
      fs.unlinkSync(ACCOUNT_FILE);
    } catch { /* already gone */ }
  }

  status(): AppChannelStatus {
    const account = this.account;
    return {
      signedIn: account !== null,
      source: account?.source ?? null,
      emailHint: account?.emailHint ?? null,
      userIdHint: account ? `…${account.userId.slice(-4)}` : null,
      region: account?.region ?? null,
      defaultRegion: this.defaultRegion,
      connected: this.connected,
      lastError: this.lastError,
      devices: mqttQuotas.wantedDevices(),
      envConfigured: this.envConfigured,
    };
  }

  private async authenticate(email: string, password: string, region: AppRegion, source: Account["source"]): Promise<Account> {
    const data = await callEcoflow(apiUrl(region, "/auth/login"), {
      method: "POST",
      headers: { lang: "en_US", "content-type": "application/json" },
      body: JSON.stringify(loginBody(email.trim(), password)),
    });
    const user = data.user as { userId?: unknown } | undefined;
    if (typeof data.token !== "string" || user?.userId === undefined) {
      throw new Error("EcoFlow login answered without a token");
    }
    return {
      userId: String(user.userId),
      token: data.token,
      region,
      emailHint: maskEmail(email),
      source,
      signedInAt: new Date().toISOString(),
    };
  }

  private async signInFromEnv(): Promise<void> {
    try {
      const account = await this.authenticate(config.app.email, config.app.password, this.defaultRegion, "env");
      await this.connect(account);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Reconnect with a saved or current account; a refused token falls back to .env. */
  private async resume(account: Account): Promise<void> {
    try {
      await this.connect(account);
    } catch (error) {
      if (error instanceof AppAuthError && this.envConfigured) return this.signInFromEnv();
      this.account = account;
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof AppAuthError) {
      // Retrying a refused token changes nothing; it takes a new sign-in
      this.lastError = `EcoFlow refused the sign-in (${message}); sign in again in Settings`;
    } else {
      this.lastError = message;
      this.scheduleRetry();
    }
    console.warn(`[AppChannel] ${this.lastError}`);
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.account) void this.resume(this.account);
      else if (this.envConfigured) void this.signInFromEnv();
    }, RETRY_MS);
  }

  /** Fetch the app's MQTT certificate with the token and connect to the broker. */
  private async connect(account: Account): Promise<void> {
    const cert = await callEcoflow(
      apiUrl(account.region, `/iot-auth/app/certification?userId=${encodeURIComponent(account.userId)}`),
      { headers: { lang: "en_US", authorization: `Bearer ${account.token}` } },
    );
    if (!cert.url || !cert.certificateAccount || !cert.certificatePassword) {
      throw new Error("EcoFlow answered without MQTT credentials");
    }

    this.closeMqtt();
    this.account = account;
    this.lastError = null;
    const client = mqtt.connect(`mqtts://${String(cert.url)}:${Number(cert.port) || 8883}`, {
      // The app's client ID format; the broker refuses others for app certificates
      clientId: `ANDROID_${randomUUID().replace(/-/g, "").toUpperCase()}_${account.userId}`,
      username: String(cert.certificateAccount),
      password: String(cert.certificatePassword),
      keepalive: 60,
      reconnectPeriod: 15_000,
      connectTimeout: 30_000,
    });
    this.client = client;

    client.on("connect", () => {
      this.connected = true;
      this.lastError = null;
      console.log(`[AppChannel] Connected as ${account.emailHint}`);
      for (const sn of mqttQuotas.wantedDevices()) this.subscribe(sn);
      this.refreshTimer ??= setInterval(() => {
        for (const sn of mqttQuotas.wantedDevices()) this.requestLatestQuotas(sn);
      }, LATEST_QUOTAS_INTERVAL_MS);
    });

    client.on("message", (topic, payload) => {
      const parsed = parseAppTopic(topic, account.userId);
      if (!parsed) return;
      let message: unknown;
      try {
        message = JSON.parse(payload.toString());
      } catch {
        return;
      }
      appQuotas.sample(parsed.sn, topic, message);
      const full = parsed.kind === "getReply" ? appQuotas.applyReply(parsed.sn, message) : appQuotas.apply(parsed.sn, message);
      const key = `${parsed.sn}:${parsed.kind}`;
      if (full && !this.seen.has(key)) {
        this.seen.add(key);
        console.log(`[AppChannel] ${parsed.kind === "getReply" ? "Full snapshots" : "Pushes"} arriving for ${parsed.sn}`);
      }
    });

    client.on("error", (error) => {
      if (error.message === this.lastError) return;
      this.lastError = error.message;
      console.error(`[AppChannel] MQTT error: ${error.message}`);
      // 5 = not authorised: the certificate went stale; fetch a new one later
      if ((error as { code?: number }).code === 5) {
        this.closeMqtt();
        this.scheduleRetry();
      }
    });

    client.on("close", () => {
      this.connected = false;
    });
  }

  private closeMqtt(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.client?.end(true);
    this.client = null;
    this.connected = false;
  }

  /** Subscribe to a device's pushes and snapshot replies, then ask for a snapshot. */
  private subscribe(sn: string): void {
    const client = this.client;
    const account = this.account;
    if (!client?.connected || !account) return;
    const topics = appTopics(account.userId, sn);
    // One topic per request, so a refusal of one does not hide the other
    for (const topic of [topics.data, topics.getReply]) {
      client.subscribe(topic, { qos: 1 }, (error) => {
        if (error) console.error(`[AppChannel] Subscribe to ${topic.replace(account.userId, "<user>")} failed: ${error.message}`);
      });
    }
    this.requestLatestQuotas(sn);
  }

  private requestLatestQuotas(sn: string): void {
    const client = this.client;
    const account = this.account;
    if (!client?.connected || !account) return;
    // QoS 0, as in mqttService.ts: a refused QoS 1 publish is resent on every reconnect
    client.publish(appTopics(account.userId, sn).get, JSON.stringify(latestQuotasRequest(++this.seq)), { qos: 0 });
  }

  private load(): Account | null {
    try {
      const saved = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf8")) as Partial<Account>;
      if (typeof saved.userId !== "string" || typeof saved.token !== "string" || !isAppRegion(saved.region)) return null;
      return {
        userId: saved.userId,
        token: saved.token,
        region: saved.region,
        emailHint: saved.emailHint ?? "",
        source: "panel",
        signedInAt: saved.signedInAt ?? "",
      };
    } catch {
      return null;
    }
  }

  private save(account: Account): void {
    fs.mkdirSync(path.dirname(ACCOUNT_FILE), { recursive: true });
    const tmp = `${ACCOUNT_FILE}.tmp`;
    // The token reads the account's devices: owner-only file
    fs.writeFileSync(tmp, JSON.stringify(account), { mode: 0o600 });
    fs.renameSync(tmp, ACCOUNT_FILE);
  }
}

export const appChannel = new AppChannel();
