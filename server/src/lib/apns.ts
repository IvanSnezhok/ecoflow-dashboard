// Apple's push service for the phone app's outage Live Activity (mobile/src/widgets/outage.ios.tsx).
// Ordinary notifications go through Expo (pushService); a Live Activity can only be started
// and refreshed by a push sent straight to APNs, signed with the owner's Apple key.
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { PushLanguage } from "./pushMessages.js";

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** Provider token: ES256 over the team ID and issue time, valid for an hour at Apple */
export function apnsJwt(key: KeyObject | string, keyId: string, teamId: string, nowMs: number): string {
  const head = `${b64url(JSON.stringify({ alg: "ES256", kid: keyId }))}.${b64url(JSON.stringify({ iss: teamId, iat: Math.floor(nowMs / 1000) }))}`;
  const privateKey = typeof key === "string" ? createPrivateKey(key) : key;
  return `${head}.${b64url(sign("sha256", Buffer.from(head), { key: privateKey, dsaEncoding: "ieee-p1363" }))}`;
}

/** Mirrors OutageActivityProps in mobile/src/widgets/types.ts */
export interface OutageActivityProps {
  name: string;
  soc: number | null;
  title: string;
  since: number;
  reserve: string;
  ended: string;
}

function span(minutes: number, language: PushLanguage): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const [h, m] = language === "uk" ? ["год", "хв"] : ["h", "min"];
  if (total < 60) return `${total} ${m}`;
  return rest === 0 ? `${hours} ${h}` : `${hours} ${h} ${rest} ${m}`;
}

/** The same words the app puts on its own Live Activity (mobile/src/lib/widgets.ts) */
export function outageActivityProps(language: PushLanguage, outage: { name: string; soc: number | null; since: number; reserveHours: number | null; over: boolean }): OutageActivityProps {
  const uk = language === "uk";
  const reserve = outage.reserveHours !== null && outage.reserveHours > 0
    ? (uk ? `≈ ${span(outage.reserveHours * 60, language)} на батареї` : `≈ ${span(outage.reserveHours * 60, language)} on battery`)
    : "";
  return {
    name: outage.name,
    soc: outage.soc === null ? null : Math.round(outage.soc),
    title: uk ? "Світла немає" : "No power",
    since: outage.since,
    reserve,
    ended: outage.over ? (uk ? "Світло з’явилось" : "Power is back") : "",
  };
}

export type LiveActivityEvent = "start" | "update" | "end";

/**
 * The `aps` payload expo-widgets expects: `content-state` names the activity the app
 * registered with createLiveActivity and carries its props as a JSON string.
 */
export function liveActivityPayload(event: LiveActivityEvent, props: OutageActivityProps, nowMs: number, alert?: { title: string; body: string }): { aps: Record<string, unknown> } {
  const now = Math.floor(nowMs / 1000);
  const aps: Record<string, unknown> = {
    timestamp: now,
    event,
    "content-state": { name: "OutageActivity", props: JSON.stringify(props) },
  };
  if (event === "start") {
    aps["attributes-type"] = "LiveActivityAttributes";
    aps.attributes = {};
    // Lets APNs hand the app a token for later updates of the activity it starts (iOS 18+)
    aps["input-push-token"] = 1;
    aps.alert = alert ?? { title: props.title, body: props.name };
  }
  // Without a newer update the lock screen marks the reading as out of date after half an hour
  if (event !== "end") aps["stale-date"] = now + 30 * 60;
  // "Power is back" stays for five minutes, then the activity leaves the lock screen
  else aps["dismissal-date"] = now + 5 * 60;
  return { aps };
}

/** APNs device and Live Activity tokens are hex strings */
export const isApnsToken = (token: unknown): token is string => typeof token === "string" && /^[0-9a-f]{32,400}$/i.test(token);
