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
