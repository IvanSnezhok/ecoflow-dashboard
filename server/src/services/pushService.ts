// Push notifications for the phone app (mobile/): power lost and restored, battery low,
// station offline. A phone registers its Expo push token under its panel session; the
// messages go out through Expo's push service, which relays them to APNs and FCM.
import { db } from "../db/database.js";
import { canAccessDevice } from "../lib/permissions.js";
import {
  DEFAULT_PUSH_PREFS, isExpoPushToken, lowBatteryStep, pushText,
  type PushEvent, type PushLanguage, type PushPrefs,
} from "../lib/pushMessages.js";
import { isApnsToken, outageActivityProps } from "../lib/apns.js";
import { apnsService } from "./apnsService.js";
import { panelAuth } from "./panelAuth.js";

const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL || "https://exp.host/--/api/v2/push/send";
/** A station must stay unreachable this long before "offline" is sent */
const OFFLINE_AFTER_MS = 5 * 60_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS push_devices (
    token TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL,
    user_id TEXT NOT NULL,
    platform TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    prefs TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

// iPhone Live Activity tokens (hex, from ActivityKit): one that can start the outage
// activity remotely, and one for the activity that is running
const columns = (db.prepare("PRAGMA table_info(push_devices)").all() as { name: string }[]).map((column) => column.name);
for (const column of ["la_start_token", "la_activity_token"]) {
  if (!columns.includes(column)) db.exec(`ALTER TABLE push_devices ADD COLUMN ${column} TEXT`);
}

/** A level update of a running outage activity goes out at most this often... */
const ACTIVITY_UPDATE_MS = 3 * 60_000;
/** ...and at least this often, so the lock screen does not mark it as out of date */
const ACTIVITY_KEEPALIVE_MS = 20 * 60_000;

interface Row {
  la_start_token: string | null;
  la_activity_token: string | null;
  token: string;
  session_hash: string;
  user_id: string;
  language: string;
  prefs: string;
}

interface Target {
  userId: string;
  startToken?: string | null;
  activityToken?: string | null;
  token: string;
  language: PushLanguage;
  prefs: PushPrefs;
}

function parsePrefs(text: string): PushPrefs {
  try {
    return { ...DEFAULT_PUSH_PREFS, ...(JSON.parse(text) as Partial<PushPrefs>) };
  } catch {
    return DEFAULT_PUSH_PREFS;
  }
}

class PushService {
  /** Per station: when it went unreachable, and whether "offline" was sent */
  private reach = new Map<string, { seenOnline: boolean; offlineSince: number | null; notified: boolean }>();
  /** Per phone and station: whether "battery low" may be sent (lowBatteryStep) */
  private lowArmed = new Map<string, boolean>();
  private lastError: string | null = null;
  /** What the running outage activities last showed: level and when it was sent */
  private activity: { soc: number; at: number } | null = null;

  /** The phone's Live Activity tokens; null forgets one, undefined keeps it */
  setLiveActivityTokens(userId: string, token: string, tokens: { startToken?: string | null; activityToken?: string | null }): boolean {
    if (!this.registration(userId, token)) return false;
    if (tokens.startToken !== undefined) db.prepare("UPDATE push_devices SET la_start_token = ? WHERE token = ?").run(tokens.startToken, token);
    if (tokens.activityToken !== undefined) db.prepare("UPDATE push_devices SET la_activity_token = ? WHERE token = ?").run(tokens.activityToken, token);
    return true;
  }

  /** Whether the server can start and refresh a Live Activity (the owner's APNs key is set) */
  get liveActivityReady(): boolean {
    return apnsService.configured;
  }

  register(session: { sessionHash: string; userId: string }, token: string, platform: string, language: PushLanguage, prefs: PushPrefs): void {
    const now = Date.now();
    db.prepare(`
      INSERT INTO push_devices (token, session_hash, user_id, platform, language, prefs, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET session_hash = excluded.session_hash, user_id = excluded.user_id,
        platform = excluded.platform, language = excluded.language, prefs = excluded.prefs, updated_at = excluded.updated_at
    `).run(token, session.sessionHash, session.userId, platform.slice(0, 20), language, JSON.stringify(prefs), now, now);
  }

  unregister(token: string): void {
    db.prepare("DELETE FROM push_devices WHERE token = ?").run(token);
  }

  /** The registration of a token, if it belongs to this session's user */
  registration(userId: string, token: string): { language: PushLanguage; prefs: PushPrefs } | null {
    const row = db.prepare("SELECT * FROM push_devices WHERE token = ? AND user_id = ?").get(token, userId) as Row | undefined;
    return row ? { language: row.language === "uk" ? "uk" : "en", prefs: parsePrefs(row.prefs) } : null;
  }

  /**
   * Phones that may hear about a station: their session is still valid and their user
   * may see the device (or Power reserve, for grid events). A phone whose session
   * ended is forgotten here.
   */
  private targets(serialNumber: string, grid: boolean): Target[] {
    const rows = db.prepare("SELECT * FROM push_devices").all() as Row[];
    const targets: Target[] = [];
    for (const row of rows) {
      const user = panelAuth.sessionUser(row.session_hash, row.user_id);
      if (!user) {
        this.unregister(row.token);
        continue;
      }
      if (grid ? !panelAuth.canViewPowerReserve(user) : !canAccessDevice(user, serialNumber)) continue;
      targets.push({ userId: row.user_id, startToken: row.la_start_token, activityToken: row.la_activity_token, token: row.token, language: row.language === "uk" ? "uk" : "en", prefs: parsePrefs(row.prefs) });
    }
    return targets;
  }

  /** The resilience device's grid reading changed between on and off */
  gridChanged(serialNumber: string, name: string, state: "on" | "off", details: { soc: number; reserveHours: number | null; outageMinutes: number | null; since: number | null }): void {
    const event: PushEvent = state === "off"
      ? { kind: "gridOff", name, soc: Math.round(details.soc), reserveHours: details.reserveHours }
      : { kind: "gridOn", name, outageMinutes: details.outageMinutes };
    const targets = this.targets(serialNumber, true).filter((target) => target.prefs.grid);
    void this.gridActivity(targets, event, state, { name, soc: details.soc, reserveHours: details.reserveHours, since: details.since ?? Date.now() })
      .then((started) => this.send(targets.filter((target) => !started.has(target.token)), event, { url: "/power" }, "grid"));
  }

  /**
   * iPhones with a Live Activity: power lost starts it (the push carries the alert, so
   * those phones are returned and get no second notification), power restored ends it.
   */
  private async gridActivity(targets: Target[], event: PushEvent, state: "on" | "off", outage: { name: string; soc: number; reserveHours: number | null; since: number }): Promise<Set<string>> {
    const started = new Set<string>();
    if (!apnsService.configured) return started;
    this.activity = state === "off" ? { soc: Math.round(outage.soc), at: Date.now() } : null;
    await Promise.all(targets.map(async (target) => {
      const apnsToken = state === "off" ? target.startToken : target.activityToken;
      if (!apnsToken) return;
      const props = outageActivityProps(target.language, { ...outage, over: state === "on" });
      const result = await apnsService.liveActivity(apnsToken, state === "off" ? "start" : "end", props, pushText(event, target.language));
      if (result === "ok" && state === "off") started.add(target.token);
      if (result === "gone" || state === "on") this.setLiveActivityTokens(target.userId, target.token, state === "off" ? { startToken: null } : { activityToken: null });
    }));
    if (started.size > 0) console.log(`[Push] outage Live Activity started on ${started.size} iPhone(s)`);
    return started;
  }

  /** Every resilience pass while the power is out: refreshes the level on running outage activities */
  outageTick(serialNumber: string, name: string, outage: { soc: number; reserveHours: number | null; since: number | null }, now = Date.now()): void {
    if (!apnsService.configured) return;
    const soc = Math.round(outage.soc);
    const last = this.activity;
    if (last && (soc === last.soc ? now - last.at < ACTIVITY_KEEPALIVE_MS : now - last.at < ACTIVITY_UPDATE_MS)) return;
    this.activity = { soc, at: now };
    for (const target of this.targets(serialNumber, true)) {
      if (!target.prefs.grid || !target.activityToken) continue;
      const props = outageActivityProps(target.language, { name, soc, reserveHours: outage.reserveHours, since: outage.since ?? now, over: false });
      void apnsService.liveActivity(target.activityToken, "update", props).then((result) => {
        if (result === "gone") this.setLiveActivityTokens(target.userId, target.token, { activityToken: null });
      });
    }
  }

  /** Every pass of the background collector: one station's reachability and level */
  observeDevice(serialNumber: string, name: string, online: boolean, soc: number | null, now = Date.now()): void {
    const reach = this.reach.get(serialNumber) ?? { seenOnline: false, offlineSince: null, notified: false };
    this.reach.set(serialNumber, reach);
    const url = `/device/${encodeURIComponent(serialNumber)}`;
    if (online) {
      if (reach.notified) {
        void this.send(this.targets(serialNumber, false).filter((target) => target.prefs.offline), { kind: "online", name }, { url }, "reach");
      }
      reach.seenOnline = true;
      reach.offlineSince = null;
      reach.notified = false;
    } else if (reach.seenOnline) {
      // A station that was already offline when the server started stays silent
      reach.offlineSince ??= now;
      if (!reach.notified && now - reach.offlineSince >= OFFLINE_AFTER_MS) {
        reach.notified = true;
        void this.send(this.targets(serialNumber, false).filter((target) => target.prefs.offline), { kind: "offline", name }, { url }, "reach");
      }
    }

    if (!online || soc === null || !(soc > 0)) return;
    const due: Target[] = [];
    for (const target of this.targets(serialNumber, false)) {
      if (!target.prefs.lowBattery) continue;
      const key = `${target.token}|${serialNumber}|${target.prefs.threshold}`;
      const step = lowBatteryStep(soc, target.prefs.threshold, this.lowArmed.get(key));
      this.lowArmed.set(key, step.armed);
      if (step.notify) due.push(target);
    }
    if (due.length > 0) void this.send(due, { kind: "lowBattery", name, soc: Math.round(soc) }, { url }, "battery");
  }

  /** A test message to one phone; resolves to Expo's refusal, if any */
  async sendTest(token: string, language: PushLanguage): Promise<string | null> {
    return this.send([{ userId: "", token, language, prefs: DEFAULT_PUSH_PREFS }], { kind: "test" }, { url: "/" }, "test");
  }

  private async send(targets: Target[], event: PushEvent, data: Record<string, string>, channel: string): Promise<string | null> {
    if (targets.length === 0) return null;
    const messages = targets.map((target) => ({
      to: target.token,
      ...pushText(event, target.language),
      data: { ...data, kind: event.kind },
      sound: "default",
      priority: "high",
      channelId: "alerts",
      // A newer message of the same kind replaces the older one on the lock screen
      collapseId: channel,
    }));
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(15_000),
      });
      const answer = (await response.json()) as { data?: { status: string; message?: string; details?: { error?: string } }[]; errors?: { message?: string }[] };
      if (!response.ok || !Array.isArray(answer.data)) throw new Error(answer.errors?.[0]?.message ?? `Expo push answered ${response.status}`);
      let refusal: string | null = null;
      answer.data.forEach((ticket, index) => {
        if (ticket.status === "ok") return;
        refusal ??= ticket.message ?? ticket.details?.error ?? "refused";
        // The app was removed or its token replaced
        if (ticket.details?.error === "DeviceNotRegistered") this.unregister(targets[index].token);
      });
      this.lastError = null;
      console.log(`[Push] ${event.kind} sent to ${targets.length} phone(s)${refusal ? `, refused: ${refusal}` : ""}`);
      return refusal;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Each new failure once: the collector calls this every 10 s
      if (message !== this.lastError) console.error("[Push] Could not send:", message);
      this.lastError = message;
      return message;
    }
  }
}

export const pushService = new PushService();
export { isApnsToken, isExpoPushToken };
