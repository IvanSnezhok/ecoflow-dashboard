// Panel login: one owner account with a password and an authenticator app (TOTP), and
// sessions in SQLite behind an httpOnly cookie. Every /api route except /api/auth and
// /api/health, and the /ws socket, need a session.
//
// Until the account exists the panel is open to whoever reaches it first, so the setup
// asks for proof of owning the server: the one-time setup code from the server log
// (also in server/data/auth-setup-code.txt) or the EcoFlow Open API secret key from
// .env. Lost the authenticator? Delete server/data/auth.json and restart: a new setup
// code appears and every session ends.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import QRCode from "qrcode";
import { db } from "../db/database.js";
import { config } from "../config/env.js";
import { parseCookies } from "../lib/cookies.js";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "../lib/password.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../lib/totp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const ACCOUNT_FILE = path.join(DATA_DIR, "auth.json");
const SETUP_CODE_FILE = path.join(DATA_DIR, "auth-setup-code.txt");

export const SESSION_COOKIE = "ecoflow_session";
/** "Remember me": the session lives 30 days past its last use */
const REMEMBER_MS = 30 * 24 * 3600_000;
/** Otherwise a browser-session cookie, and 12 hours past the last use */
const SESSION_MS = 12 * 3600_000;
/** A started setup must be confirmed with a code within this time */
const SETUP_TTL_MS = 10 * 60_000;
/** last_seen and the sliding expiry are written at most this often */
const TOUCH_MS = 60_000;
const ISSUER = "EcoFlow panel";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface Account {
  username: string;
  passwordHash: string;
  totpSecret: string;
  /** Step of the last accepted code, so a code works only once */
  lastTotpCounter: number;
  createdAt: string;
}

interface SessionRow {
  id_hash: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  remember: number;
  user_agent: string | null;
}

interface PendingSetup {
  username: string;
  passwordHash: string;
  totpSecret: string;
  expiresAt: number;
}

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  remember: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

/** A refused request: status and a message safe to show */
export class AuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
  }
}

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest();
/** Equal-time comparison of strings of any length */
const sameText = (a: string, b: string) => crypto.timingSafeEqual(sha256(a), sha256(b));
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashSessionId = (id: string) => sha256(id).toString("hex");

function isHttps(req: Request): boolean {
  // The port is published on 127.0.0.1 only, so the header comes from the tunnel
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

class PanelAuth {
  private account: Account | null = null;
  private setupCode: string | null = null;
  private pending = new Map<string, PendingSetup>();

  constructor() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        remember INTEGER NOT NULL,
        user_agent TEXT
      )
    `);
  }

  /** On server start: load the account, or announce the setup code. */
  start(): void {
    this.account = this.loadAccount();
    db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(Date.now());
    setInterval(() => db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(Date.now()), 3600_000).unref();
    if (this.account) {
      fs.rmSync(SETUP_CODE_FILE, { force: true });
      return;
    }
    this.setupCode = this.readOrCreateSetupCode();
    console.log("==================================================================");
    console.log(`[Auth] The panel login is not set up. Setup code: ${this.setupCode}`);
    console.log(`[Auth] (also in ${SETUP_CODE_FILE}); or use ECOFLOW_SECRET_KEY from .env`);
    console.log("==================================================================");
  }

  status(req: IncomingMessage): AuthStatus {
    const session = this.account ? this.sessionFor(req) : null;
    return {
      configured: this.account !== null,
      authenticated: session !== null,
      username: session ? this.account!.username : null,
    };
  }

  /** Step 1 of the setup: check the proof and the credentials, hand out the TOTP secret. */
  async startSetup(setupSecret: string, username: string, password: string) {
    if (this.account) throw new AuthError("The panel login is already set up", 409);
    const proof = setupSecret.trim();
    const byCode = this.setupCode !== null && normalizeCode(proof).length > 0 && sameText(normalizeCode(proof), normalizeCode(this.setupCode));
    const byKey = config.ecoflow.secretKey.length > 0 && sameText(proof, config.ecoflow.secretKey);
    if (!byCode && !byKey) throw new AuthError("Wrong setup code or secret key", 403);
    const name = username.trim();
    if (name.length < 1 || name.length > 64) throw new AuthError("The username must be 1 to 64 characters", 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }

    const now = Date.now();
    for (const [id, setup] of this.pending) if (setup.expiresAt < now) this.pending.delete(id);
    if (this.pending.size >= 5) throw new AuthError("Too many setups in progress; try again in a few minutes", 429);

    const totpSecret = generateTotpSecret();
    const setupId = crypto.randomBytes(16).toString("hex");
    this.pending.set(setupId, { username: name, passwordHash: await hashPassword(password), totpSecret, expiresAt: now + SETUP_TTL_MS });
    const uri = otpauthUri(totpSecret, name, ISSUER);
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return {
      setupId,
      secret: totpSecret,
      otpauthUri: uri,
      qrCode: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    };
  }

  /** Step 2: the first code from the app proves it is set up; the account is saved. */
  finishSetup(setupId: string, otp: string, remember: boolean, req: Request, res: Response): AuthStatus {
    if (this.account) throw new AuthError("The panel login is already set up", 409);
    const setup = this.pending.get(setupId);
    if (!setup || setup.expiresAt < Date.now()) throw new AuthError("The setup expired; start again", 410);
    const counter = verifyTotp(setup.totpSecret, otp, Date.now());
    if (counter === null) throw new AuthError("Wrong code; check the time on your phone and try again", 401);

    const account: Account = {
      username: setup.username,
      passwordHash: setup.passwordHash,
      totpSecret: setup.totpSecret,
      lastTotpCounter: counter,
      createdAt: new Date().toISOString(),
    };
    this.saveAccount(account);
    this.pending.clear();
    this.setupCode = null;
    fs.rmSync(SETUP_CODE_FILE, { force: true });
    // Sessions from an earlier account (before a reset) end here
    db.prepare("DELETE FROM auth_sessions").run();
    this.createSession(remember, req, res);
    return { configured: true, authenticated: true, username: account.username };
  }

  async login(username: string, password: string, otp: string, remember: boolean, req: Request, res: Response): Promise<AuthStatus> {
    const account = this.account;
    if (!account) throw new AuthError("The panel login is not set up yet", 409);
    // Check all three every time, so the answer does not tell which one was wrong
    const nameOk = sameText(username.trim(), account.username);
    const passwordOk = await verifyPassword(password, account.passwordHash);
    const counter = verifyTotp(account.totpSecret, otp, Date.now(), account.lastTotpCounter);
    if (!nameOk || !passwordOk || counter === null) throw new AuthError("Wrong username, password or code");

    this.saveAccount({ ...account, lastTotpCounter: counter });
    this.createSession(remember, req, res);
    return { configured: true, authenticated: true, username: account.username };
  }

  logout(req: Request, res: Response): void {
    const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (id) db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(hashSessionId(id));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  sessions(req: IncomingMessage): SessionInfo[] {
    const current = this.sessionFor(req)?.id_hash;
    const rows = db.prepare("SELECT * FROM auth_sessions WHERE expires_at >= ? ORDER BY last_seen_at DESC").all(Date.now()) as SessionRow[];
    return rows.map((row) => ({
      id: row.id_hash.slice(0, 8),
      current: row.id_hash === current,
      remember: row.remember === 1,
      createdAt: new Date(row.created_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      userAgent: row.user_agent,
    }));
  }

  /** Sign out every other browser and device. */
  revokeOtherSessions(req: IncomingMessage): void {
    const current = this.sessionFor(req)?.id_hash;
    db.prepare("DELETE FROM auth_sessions WHERE id_hash != ?").run(current ?? "");
  }

  /** The valid session behind a request's cookie, extending it with use. */
  sessionFor(req: IncomingMessage): SessionRow | null {
    if (!this.account) return null;
    const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!id) return null;
    const row = db.prepare("SELECT * FROM auth_sessions WHERE id_hash = ?").get(hashSessionId(id)) as SessionRow | undefined;
    const now = Date.now();
    if (!row || row.expires_at < now) return null;
    if (now - row.last_seen_at > TOUCH_MS) {
      row.last_seen_at = now;
      row.expires_at = now + (row.remember ? REMEMBER_MS : SESSION_MS);
      db.prepare("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?").run(row.last_seen_at, row.expires_at, row.id_hash);
    }
    return row;
  }

  /** Express guard for /api: 401 without a valid session. */
  requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (this.sessionFor(req)) {
      next();
      return;
    }
    res.status(401).json({ error: "Sign in required", authRequired: true });
  };

  private createSession(remember: boolean, req: Request, res: Response): void {
    const id = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 200) || null;
    db.prepare("INSERT INTO auth_sessions (id_hash, created_at, last_seen_at, expires_at, remember, user_agent) VALUES (?, ?, ?, ?, ?, ?)")
      .run(hashSessionId(id), now, now, now + (remember ? REMEMBER_MS : SESSION_MS), remember ? 1 : 0, userAgent);
    res.cookie(SESSION_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps(req),
      path: "/",
      // Without "Remember me" the cookie ends with the browser session
      ...(remember ? { maxAge: REMEMBER_MS } : {}),
    });
  }

  private loadAccount(): Account | null {
    try {
      const saved = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf8")) as Partial<Account>;
      if (!saved.username || !saved.passwordHash || !saved.totpSecret) return null;
      return {
        username: saved.username,
        passwordHash: saved.passwordHash,
        totpSecret: saved.totpSecret,
        lastTotpCounter: saved.lastTotpCounter ?? -1,
        createdAt: saved.createdAt ?? "",
      };
    } catch {
      return null;
    }
  }

  private saveAccount(account: Account): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${ACCOUNT_FILE}.tmp`;
    // The password hash and the authenticator secret: owner-only file
    fs.writeFileSync(tmp, JSON.stringify(account, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, ACCOUNT_FILE);
    this.account = account;
  }

  private readOrCreateSetupCode(): string {
    try {
      const saved = fs.readFileSync(SETUP_CODE_FILE, "utf8").trim();
      if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(saved)) return saved;
    } catch { /* first start */ }
    const pick = () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    const code = `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETUP_CODE_FILE, `${code}\n`, { mode: 0o600 });
    return code;
  }
}

export const panelAuth = new PanelAuth();
