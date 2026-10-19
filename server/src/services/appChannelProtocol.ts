// The EcoFlow app's private API, as used by appChannel.ts: login body, MQTT topics and
// the latestQuotas request. Mirrors tolwi/hassio-ecoflow-cloud (private_api.py) and
// rabits/ha-ef-ble (eflib/login.py). Kept free of I/O so it can be tested.

/** Login hosts <region>.ecoflow.com for an e-mail account (api-cn takes phone numbers). */
export const APP_REGIONS = ["api-e", "api", "api-a", "api-j", "api-r"] as const;
export type AppRegion = (typeof APP_REGIONS)[number];

export const isAppRegion = (value: unknown): value is AppRegion => APP_REGIONS.includes(value as AppRegion);

/** The Open API endpoint's region (api-e.ecoflow.com -> api-e): the account usually lives there too. */
export function defaultAppRegion(apiEndpoint: string): AppRegion {
  try {
    const region = new URL(apiEndpoint).hostname.split(".")[0];
    return isAppRegion(region) ? region : "api";
  } catch {
    return "api";
  }
}

/** POST /auth/login body; the app sends the password base64-encoded. */
export function loginBody(email: string, password: string): Record<string, unknown> {
  return {
    email,
    password: Buffer.from(password, "utf8").toString("base64"),
    scene: "IOT_APP",
    appVersion: "1.0.0",
    oauth: { bundleId: "com.ef.EcoFlow" },
    userType: "ECOFLOW",
  };
}

export function appTopics(userId: string, sn: string) {
  return {
    /** The device's pushes, keyed like the REST quota ("pd.soc") under params */
    data: `/app/device/property/${sn}`,
    get: `/app/${userId}/${sn}/thing/property/get`,
    getReply: `/app/${userId}/${sn}/thing/property/get_reply`,
  };
}

/** The device and message kind of an app topic, or null for anything else. */
export function parseAppTopic(topic: string, userId: string): { sn: string; kind: "data" | "getReply" } | null {
  const parts = topic.split("/");
  // "", "app", "device", "property", sn
  if (parts.length === 5 && parts[1] === "app" && parts[2] === "device" && parts[3] === "property" && parts[4]) {
    return { sn: parts[4], kind: "data" };
  }
  // "", "app", userId, sn, "thing", "property", "get_reply"
  if (parts.length === 7 && parts[1] === "app" && parts[2] === userId && parts[4] === "thing" && parts[6] === "get_reply" && parts[3]) {
    return { sn: parts[3], kind: "getReply" };
  }
  return null;
}

/**
 * The full-snapshot request the app sends; the reply carries data.quotaMap. "from" is
 * what tolwi/hassio-ecoflow-cloud sends, which EcoFlow accepts.
 */
export function latestQuotasRequest(id: number): Record<string, unknown> {
  return { from: "HomeAssistant", id: String(id), version: "1.1", moduleType: 0, operateType: "latestQuotas", params: {} };
}

/** "ivan@example.com" -> "iv…@example.com", for showing which account is signed in. */
export function maskEmail(email: string): string {
  const [name, domain = ""] = email.trim().split("@");
  return `${name.slice(0, 2)}…@${domain}`;
}
