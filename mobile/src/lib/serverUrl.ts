/**
 * The panel's address as the user may type it ("panel.example.com", "https://x/api/")
 * turned into an origin-style base without a trailing slash; null when it is not a URL.
 * Without a scheme it is https, except for local addresses, which panels serve over http.
 */
export function normalizeServerUrl(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(text) || /^[^/]+\.local(:|\/|$)/i.test(text);
    text = `${local ? 'http' : 'https'}://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** wss://host/ws for https://host */
export function socketUrl(serverUrl: string): string {
  return `${serverUrl.replace(/^http/i, 'ws')}/ws`;
}
