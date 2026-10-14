const SENSITIVE_KEY = /pass(word)?|secret|token/i;

/** Copy of a request body safe for logs: credential fields are masked. */
export function redactBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? "***" : value]),
  );
}
