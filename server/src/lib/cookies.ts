/** name=value pairs of a Cookie header; malformed parts are skipped. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    const name = index > 0 ? part.slice(0, index).trim() : "";
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch { /* not URI-encoded as we write it; skip */ }
  }
  return cookies;
}

/** Subprotocol a phone app offers on /ws next to its session token (a socket cannot send headers in every runtime). */
export const SESSION_SUBPROTOCOL = "ecoflow-session";

/**
 * The session id of a request: `Authorization: Bearer` or the token offered after
 * SESSION_SUBPROTOCOL (the phone app, which keeps the id in the device keychain), else
 * the browser's cookie. An explicit token wins over a cookie left in the app's cookie jar.
 */
export function sessionIdFrom(headers: Record<string, string | string[] | undefined>, cookieName: string): string | null {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const bearer = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(one(headers.authorization).trim());
  if (bearer) return bearer[1];
  const offered = one(headers["sec-websocket-protocol"]).split(",").map((part) => part.trim());
  if (offered[0] === SESSION_SUBPROTOCOL && /^[A-Za-z0-9_-]{20,200}$/.test(offered[1] ?? "")) return offered[1];
  return parseCookies(one(headers.cookie))[cookieName] || null;
}
