// Sends Live Activity pushes to Apple (lib/apns.ts). Configured by the owner's APNs key:
// APNS_KEY_ID, APNS_TEAM_ID and the .p8 key in APNS_KEY (its text, "\n" allowed) or
// APNS_KEY_FILE (default server/data/apns-key.p8). Without them nothing is sent and the
// app's Live Activity works only while the app is opened.
import { createPrivateKey, type KeyObject } from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";
import path from "node:path";
import { apnsJwt, liveActivityPayload, type LiveActivityEvent, type OutageActivityProps } from "../lib/apns.js";

const BUNDLE_ID = process.env.APNS_BUNDLE_ID || "app.ecoflowpanel.mobile";
// APNS_HOST only points tests at a mock; APNS_SANDBOX=1 is for development builds
const HOST = process.env.APNS_HOST || (process.env.APNS_SANDBOX === "1" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
/** Apple refuses a provider token older than an hour and one renewed more often than every 20 min */
const JWT_LIFE_MS = 45 * 60_000;

class ApnsService {
  private key: KeyObject | null | undefined;
  private jwt: { token: string; at: number } | null = null;
  private lastError: string | null = null;

  private loadKey(): KeyObject | null {
    if (this.key !== undefined) return this.key;
    this.key = null;
    if (!process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID) return null;
    try {
      const file = process.env.APNS_KEY_FILE || path.join(process.cwd(), "data", "apns-key.p8");
      const pem = process.env.APNS_KEY ? process.env.APNS_KEY.replace(/\\n/g, "\n") : fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (pem) this.key = createPrivateKey(pem);
    } catch (error) {
      console.error("[APNs] The key could not be read:", error instanceof Error ? error.message : error);
    }
    return this.key;
  }

  get configured(): boolean {
    return this.loadKey() !== null;
  }

  private providerToken(key: KeyObject, now: number): string {
    if (!this.jwt || now - this.jwt.at > JWT_LIFE_MS) {
      this.jwt = { token: apnsJwt(key, process.env.APNS_KEY_ID!, process.env.APNS_TEAM_ID!, now), at: now };
    }
    return this.jwt.token;
  }

  /**
   * One Live Activity push. Resolves to "ok", "gone" (the token no longer exists: forget it)
   * or "failed".
   */
  async liveActivity(token: string, event: LiveActivityEvent, props: OutageActivityProps, alert?: { title: string; body: string }): Promise<"ok" | "gone" | "failed"> {
    const key = this.loadKey();
    if (!key) return "failed";
    const now = Date.now();
    const body = JSON.stringify(liveActivityPayload(event, props, now, alert));
    try {
      const status = await new Promise<{ code: number; text: string }>((resolve, reject) => {
        const client = http2.connect(HOST);
        const fail = (error: Error) => {
          client.destroy();
          reject(error);
        };
        client.on("error", fail);
        client.setTimeout(15_000, () => fail(new Error("APNs did not answer")));
        const request = client.request({
          ":method": "POST",
          ":path": `/3/device/${token}`,
          authorization: `bearer ${this.providerToken(key, now)}`,
          "apns-topic": `${BUNDLE_ID}.push-type.liveactivity`,
          "apns-push-type": "liveactivity",
          // A start or an end is shown at once; a level update can wait for a good moment
          "apns-priority": event === "update" ? "5" : "10",
          "apns-expiration": String(Math.floor(now / 1000) + 600),
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        });
        let code = 0;
        let text = "";
        request.on("response", (headers) => {
          code = Number(headers[":status"]);
        });
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          text += chunk;
        });
        request.on("end", () => {
          client.close();
          resolve({ code, text });
        });
        request.on("error", fail);
        request.end(body);
      });
      if (status.code === 200) {
        this.lastError = null;
        return "ok";
      }
      let reason = status.text;
      try {
        reason = (JSON.parse(status.text) as { reason?: string }).reason ?? status.text;
      } catch {
        // Not JSON: keep the text
      }
      if (status.code === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "ExpiredToken") return "gone";
      throw new Error(`APNs answered ${status.code} ${reason}`.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastError) console.error("[APNs] Could not send:", message);
      this.lastError = message;
      return "failed";
    }
  }
}

export const apnsService = new ApnsService();
