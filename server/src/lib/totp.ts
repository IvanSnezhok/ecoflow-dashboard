// Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s): what Google
// Authenticator, Aegis, 1Password and the like generate for the panel login.
import crypto from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 as authenticator apps expect it. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The code for one 30-second step (HOTP of the step counter, RFC 4226). */
export function totpAt(secret: string, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const totpCounter = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * The step counter a code belongs to, allowing one step of clock drift either way, or
 * null. A counter at or below `usedCounter` is refused, so a code works only once.
 */
export function verifyTotp(secret: string, code: string, nowMs: number, usedCounter = -1): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const now = totpCounter(nowMs);
  for (const counter of [now, now - 1, now + 1]) {
    if (counter <= usedCounter) continue;
    const expected = totpAt(secret, counter);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return counter;
  }
  return null;
}

/** otpauth:// link for the QR code an authenticator app scans. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
