// Panel login: the owner account and the users the owner invites, each with a password
// and an authenticator app (TOTP), and sessions in SQLite behind an httpOnly cookie.
// Every /api route except /api/auth and /api/health, and the /ws socket, need a session.
//
// The first start creates the initial account (panelAuthSeed.ts). Signed in with it, the
// owner must choose a username and password and add an authenticator before anything
// else works (mustChange). Lost the authenticator? Delete server/data/auth.json and
// restart: every session ends, and since the initial account is used once, the setup
// then asks for proof of owning the server: the one-time setup code from the server log
// (also in server/data/auth-setup-code.txt) or the EcoFlow Open API secret key from .env.
//
// Invited users live in server/data/panel-users.json. An invitation is a one-time link
// (7 days) for a role and a set of devices (lib/permissions.ts); the invited person
// picks a username and password and adds an authenticator, as the owner did.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import QRCode from "qrcode";
import { db, getDeviceById, getDeviceBySn, getResilienceSettings } from "../db/database.js";
import { config } from "../config/env.js";
import { parseCookies } from "../lib/cookies.js";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "../lib/password.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../lib/totp.js";
import { canAccessDevice, isOwner, type MemberRole, type PanelRole, type PanelUser } from "../lib/permissions.js";
import { INITIAL_ACCOUNT } from "./panelAuthSeed.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Who is signed in; set by panelAuth.requireAuth */
      panelUser?: PanelUser;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const ACCOUNT_FILE = path.join(DATA_DIR, "auth.json");
const MEMBERS_FILE = path.join(DATA_DIR, "panel-users.json");
const SETUP_CODE_FILE = path.join(DATA_DIR, "auth-setup-code.txt");
/** Written when the initial account is created, so a reset does not bring it back */
const SEEDED_FILE = path.join(DATA_DIR, "auth-seeded");

export const SESSION_COOKIE = "ecoflow_session";
/** Session rows of the owner carry this user id; invited users have their own */
const OWNER_ID = "owner";
/** "Remember me": the session lives 30 days past its last use */
const REMEMBER_MS = 30 * 24 * 3600_000;
/** Otherwise a browser-session cookie, and 12 hours past the last use */
const SESSION_MS = 12 * 3600_000;
/** New credentials must be confirmed with a code from the app within this time */
const PENDING_TTL_MS = 10 * 60_000;
/** An invitation link works once, within this time */
const INVITE_TTL_MS = 7 * 24 * 3600_000;
const MAX_MEMBERS = 50;
const MAX_INVITES = 20;
/** last_seen and the sliding expiry are written at most this often */
const TOUCH_MS = 60_000;
const ISSUER = "EcoFlow panel";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** What signs a person in: the owner's account and each invited user have one */
interface Credentials {
  username: string;
  passwordHash: string;
  /** null for the initial account, which has no authenticator yet */
  totpSecret: string | null;
  /** Step of the last accepted code, so a code works only once */
  lastTotpCounter: number;
}

interface Account extends Credentials {
  /** The initial account: only replacing it is allowed */
  mustChange: boolean;
  createdAt: string;
}

/** An invited user */
interface Member extends Credentials {
  id: string;
  totpSecret: string;
  role: MemberRole;
  devices: string[] | null;
  createdAt: string;
}

interface Invite {
  id: string;
  /** SHA-256 of the link's token; the link itself is shown once, when it is made */
  tokenHash: string;
  role: MemberRole;
  devices: string[] | null;
  createdAt: string;
  expiresAt: string;
}

interface MembersStore {
  members: Member[];
  invites: Invite[];
}

interface SessionRow {
  id_hash: string;
  user_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  remember: number;
  user_agent: string | null;
}

/** New credentials waiting for the first code from the authenticator app */
interface Pending {
  kind: "setup" | "change" | "invite";
  /** change: whose login changes; invite: the invitation being accepted */
  subject: string | null;
  username: string;
  passwordHash: string;
  totpSecret: string;
  expiresAt: number;
}

interface Identity {
  session: SessionRow;
  user: PanelUser;
  /** The owner signed in with the initial account */
  mustChange: boolean;
}

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
  role: PanelRole | null;
  /** Serial numbers the user sees; null = all */
  devices: string[] | null;
  /** Signed in with the initial account: only replacing it is allowed */
  mustChange: boolean;
  /** Whether sign-in asks for a code (not for the initial account) */
  otpRequired: boolean;
  /** Whether the Power reserve page is open to this user */
  powerReserve: boolean;
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

export interface MemberInfo {
  id: string;
  username: string;
  role: MemberRole;
  devices: string[] | null;
  createdAt: string;
  /** Last use of any of the user's sessions; null when signed out everywhere */
  lastSeenAt: string | null;
  sessions: number;
}

export interface InviteInfo {
  id: string;
  role: MemberRole;
  devices: string[] | null;
  createdAt: string;
  expiresAt: string;
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
const hashInviteToken = (token: string) => sha256(token.trim()).toString("hex");

function isHttps(req: Request): boolean {
  // The port is published on 127.0.0.1 only, so the header comes from the tunnel
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

const inviteInfo = ({ id, role, devices, createdAt, expiresAt }: Invite): InviteInfo => ({ id, role, devices, createdAt, expiresAt });

class PanelAuth {
  private account: Account | null = null;
  private store: MembersStore = { members: [], invites: [] };
  private setupCode: string | null = null;
  private pending = new Map<string, Pending>();

  constructor() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        remember INTEGER NOT NULL,
        user_agent TEXT,
        user_id TEXT NOT NULL DEFAULT '${OWNER_ID}'
      )
    `);
    const columns = db.prepare("PRAGMA table_info(auth_sessions)").all() as Array<{ name: string }>;
    // Sessions from before invited users all belong to the owner
    if (!columns.some((column) => column.name === "user_id")) {
      db.exec(`ALTER TABLE auth_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT '${OWNER_ID}'`);
    }
  }

  /** On server start: load the accounts, create the initial one, or announce the setup code. */
  start(): void {
    this.account = this.loadAccount();
    this.store = this.loadMembers();
    db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(Date.now());
    setInterval(() => db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(Date.now()), 3600_000).unref();
    if (!this.account && !fs.existsSync(SEEDED_FILE)) {
      this.saveAccount({
        username: INITIAL_ACCOUNT.username,
        passwordHash: INITIAL_ACCOUNT.passwordHash,
        totpSecret: null,
        lastTotpCounter: -1,
        mustChange: true,
        createdAt: new Date().toISOString(),
      });
      fs.writeFileSync(SEEDED_FILE, `${new Date().toISOString()}\n`, { mode: 0o600 });
      db.prepare("DELETE FROM auth_sessions").run();
      console.log(`[Auth] Created the initial panel account "${INITIAL_ACCOUNT.username}"; the first sign-in must replace it`);
    }
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
    const identity = this.identify(req);
    const user = identity?.user ?? null;
    return {
      configured: this.account !== null,
      authenticated: identity !== null,
      username: user?.username ?? null,
      role: user?.role ?? null,
      devices: user?.devices ?? null,
      mustChange: identity?.mustChange ?? false,
      otpRequired: this.account?.totpSecret != null,
      powerReserve: identity !== null && !identity.mustChange && this.canViewPowerReserve(identity.user),
    };
  }

  /** Setup without an account (after a reset): check the proof of owning the server. */
  async startSetup(setupSecret: string, username: string, password: string) {
    if (this.account) throw new AuthError("The panel login is already set up", 409);
    const proof = setupSecret.trim();
    const byCode = this.setupCode !== null && normalizeCode(proof).length > 0 && sameText(normalizeCode(proof), normalizeCode(this.setupCode));
    const byKey = config.ecoflow.secretKey.length > 0 && sameText(proof, config.ecoflow.secretKey);
    if (!byCode && !byKey) throw new AuthError("Wrong setup code or secret key", 403);
    return this.prepare("setup", OWNER_ID, username, password);
  }

  finishSetup(setupId: string, otp: string, remember: boolean, req: Request, res: Response): AuthStatus {
    if (this.account) throw new AuthError("The panel login is already set up", 409);
    const { credentials } = this.confirm("setup", setupId, otp);
    this.assertUsernameFree(credentials.username, OWNER_ID);
    this.saveAccount({ ...credentials, mustChange: false, createdAt: new Date().toISOString() });
    this.setupCode = null;
    fs.rmSync(SETUP_CODE_FILE, { force: true });
    // Sessions from an earlier account (before a reset) end here
    db.prepare("DELETE FROM auth_sessions").run();
    this.createSession(OWNER_ID, remember, req, res);
    return this.status(req);
  }

  /**
   * New username, password and authenticator for whoever is signed in. The initial account
   * changes right away; any other proves itself with its password and a code.
   */
  async startChange(req: IncomingMessage, current: { password: string; otp: string }, username: string, password: string) {
    const identity = this.identify(req);
    if (!identity) throw new AuthError("Sign in required");
    const userId = identity.user.id;
    if (!identity.mustChange) {
      const passwordOk = await verifyPassword(current.password, this.credentialsOf(userId)?.passwordHash ?? "");
      // Read after the wait: a code accepted meanwhile must not work twice
      const credentials = this.credentialsOf(userId);
      const counter = credentials?.totpSecret ? verifyTotp(credentials.totpSecret, current.otp, Date.now(), credentials.lastTotpCounter) : null;
      if (!passwordOk || counter === null) throw new AuthError("Wrong current password or code", 403);
      this.recordCounter(userId, counter);
    }
    if (identity.mustChange && sameText(username.trim(), INITIAL_ACCOUNT.username)) {
      throw new AuthError(`Choose a username other than "${INITIAL_ACCOUNT.username}"`, 400);
    }
    return this.prepare("change", userId, username, password);
  }

  /** Save the new credentials; the user's other sessions end, this one stays. */
  finishChange(req: IncomingMessage, setupId: string, otp: string): AuthStatus {
    const identity = this.identify(req);
    if (!identity) throw new AuthError("Sign in required");
    const userId = identity.user.id;
    const { credentials } = this.confirm("change", setupId, otp, userId);
    this.assertUsernameFree(credentials.username, userId);
    if (userId === OWNER_ID) {
      this.saveAccount({ ...credentials, mustChange: false, createdAt: new Date().toISOString() });
    } else {
      this.updateMembers((member) => (member.id === userId ? { ...member, ...credentials, totpSecret: credentials.totpSecret! } : member));
    }
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND id_hash != ?").run(userId, identity.session.id_hash);
    return this.status(req);
  }

  async login(username: string, password: string, otp: string, remember: boolean, req: Request, res: Response): Promise<AuthStatus> {
    const account = this.account;
    if (!account) throw new AuthError("The panel login is not set up yet", 409);
    const name = username.trim();
    const member = this.store.members.find((candidate) => candidate.username === name);
    const userId = sameText(name, account.username) ? OWNER_ID : member?.id ?? null;
    // Check every part each time, so the answer does not tell which one was wrong: an
    // unknown name is checked against the owner's password hash
    const passwordOk = await verifyPassword(password, (userId === OWNER_ID ? account : member ?? account).passwordHash);
    // Read after the wait: a code accepted meanwhile must not work twice
    const credentials = userId ? this.credentialsOf(userId) : null;
    const counter = !credentials ? null
      : credentials.totpSecret ? verifyTotp(credentials.totpSecret, otp, Date.now(), credentials.lastTotpCounter)
        : credentials.lastTotpCounter;
    if (!userId || !passwordOk || counter === null) throw new AuthError("Wrong username, password or code");

    this.recordCounter(userId, counter);
    this.createSession(userId, remember, req, res);
    return this.status(req);
  }

  logout(req: Request, res: Response): void {
    const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (id) db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(hashSessionId(id));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  /** The signed-in user's own sessions. */
  sessions(req: IncomingMessage): SessionInfo[] {
    const identity = this.identify(req);
    if (!identity) return [];
    const rows = db.prepare("SELECT * FROM auth_sessions WHERE user_id = ? AND expires_at >= ? ORDER BY last_seen_at DESC")
      .all(identity.user.id, Date.now()) as SessionRow[];
    return rows.map((row) => ({
      id: row.id_hash.slice(0, 8),
      current: row.id_hash === identity.session.id_hash,
      remember: row.remember === 1,
      createdAt: new Date(row.created_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      userAgent: row.user_agent,
    }));
  }

  /** Sign out the user's other browsers and devices. */
  revokeOtherSessions(req: IncomingMessage): void {
    const identity = this.identify(req);
    if (!identity) return;
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND id_hash != ?").run(identity.user.id, identity.session.id_hash);
  }

  // ----- Invited users (owner only; routes/users.ts) -----

  listMembers(): { members: MemberInfo[]; invites: InviteInfo[] } {
    this.pruneInvites();
    const activity = new Map(
      (db.prepare("SELECT user_id, MAX(last_seen_at) AS last_seen, COUNT(*) AS count FROM auth_sessions WHERE expires_at >= ? GROUP BY user_id")
        .all(Date.now()) as Array<{ user_id: string; last_seen: number; count: number }>)
        .map((row) => [row.user_id, row]),
    );
    return {
      members: this.store.members.map((member) => {
        const seen = activity.get(member.id);
        return {
          id: member.id,
          username: member.username,
          role: member.role,
          devices: member.devices,
          createdAt: member.createdAt,
          lastSeenAt: seen ? new Date(seen.last_seen).toISOString() : null,
          sessions: seen?.count ?? 0,
        };
      }),
      invites: this.store.invites.map(inviteInfo),
    };
  }

  /** A new invitation; the token for the link is returned only here. */
  createInvite(role: MemberRole, devices: string[] | null): { invite: InviteInfo; token: string } {
    this.pruneInvites();
    if (this.store.invites.length >= MAX_INVITES) throw new AuthError("Too many open invitations; revoke some first", 409);
    if (this.store.members.length >= MAX_MEMBERS) throw new AuthError(`The panel has the maximum of ${MAX_MEMBERS} users`, 409);
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const invite: Invite = {
      id: crypto.randomBytes(6).toString("hex"),
      tokenHash: hashInviteToken(token),
      role,
      devices,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    };
    this.saveMembers({ ...this.store, invites: [...this.store.invites, invite] });
    return { invite: inviteInfo(invite), token };
  }

  revokeInvite(id: string): void {
    if (!this.store.invites.some((invite) => invite.id === id)) throw new AuthError("Invitation not found", 404);
    this.saveMembers({ ...this.store, invites: this.store.invites.filter((invite) => invite.id !== id) });
  }

  /** New role or devices; the user's open pages pick them up on the next request. */
  updateMember(id: string, changes: { role?: MemberRole; devices?: string[] | null }): string {
    const member = this.requireMember(id);
    this.updateMembers((candidate) => (candidate.id === id ? { ...candidate, ...changes } : candidate));
    return member.username;
  }

  /** End every session of an invited user. */
  signOutMember(id: string): string {
    const member = this.requireMember(id);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(id);
    return member.username;
  }

  removeMember(id: string): string {
    const member = this.requireMember(id);
    this.saveMembers({ ...this.store, members: this.store.members.filter((candidate) => candidate.id !== id) });
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(id);
    return member.username;
  }

  // ----- Accepting an invitation (open routes, rate-limited) -----

  /** What an invitation link grants, for the page that accepts it. */
  inviteDetails(token: string) {
    const invite = this.findInvite(token);
    return {
      role: invite.role,
      devices: invite.devices?.map((sn) => ({ serialNumber: sn, name: (getDeviceBySn(sn) as { name?: string } | undefined)?.name ?? sn })) ?? null,
      expiresAt: invite.expiresAt,
    };
  }

  async startInvite(token: string, username: string, password: string) {
    const invite = this.findInvite(token);
    if (this.store.members.length >= MAX_MEMBERS) throw new AuthError(`The panel has the maximum of ${MAX_MEMBERS} users`, 409);
    return this.prepare("invite", invite.id, username, password);
  }

  /** The new user is saved, the invitation used up, and the new user signed in. */
  finishInvite(setupId: string, otp: string, remember: boolean, req: Request, res: Response): AuthStatus {
    const { subject, credentials } = this.confirm("invite", setupId, otp);
    this.pruneInvites();
    const invite = this.store.invites.find((candidate) => candidate.id === subject);
    if (!invite) throw new AuthError("This invitation is no longer valid; ask for a new link", 410);
    this.assertUsernameFree(credentials.username, null);
    const member: Member = {
      id: crypto.randomBytes(8).toString("hex"),
      ...credentials,
      totpSecret: credentials.totpSecret!,
      role: invite.role,
      devices: invite.devices,
      createdAt: new Date().toISOString(),
    };
    this.saveMembers({
      members: [...this.store.members, member],
      invites: this.store.invites.filter((candidate) => candidate.id !== invite.id),
    });
    this.createSession(member.id, remember, req, res);
    return this.status(req);
  }

  // ----- Request checks -----

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

  /** A session that may use the panel: not the initial account waiting to be replaced. */
  isAuthorized(req: IncomingMessage): boolean {
    const identity = this.identify(req);
    return identity !== null && !identity.mustChange;
  }

  /** The session and user behind a live socket, for the checks on each message. */
  socketUser(req: IncomingMessage): { sessionHash: string; userId: string } | null {
    const identity = this.identify(req);
    return identity && !identity.mustChange ? { sessionHash: identity.session.id_hash, userId: identity.user.id } : null;
  }

  /** The user of a live socket while its session is valid. */
  sessionUser(sessionHash: string, userId: string): PanelUser | null {
    const row = db.prepare("SELECT expires_at FROM auth_sessions WHERE id_hash = ? AND user_id = ?").get(sessionHash, userId) as
      | { expires_at: number }
      | undefined;
    return row && row.expires_at >= Date.now() ? this.userById(userId) : null;
  }

  userById(id: string): PanelUser | null {
    if (id === OWNER_ID) return this.account ? { id: OWNER_ID, username: this.account.username, role: "owner", devices: null } : null;
    const member = this.store.members.find((candidate) => candidate.id === id);
    return member ? { id: member.id, username: member.username, role: member.role, devices: member.devices } : null;
  }

  /** The Power reserve page follows one device: open to whoever may see that device. */
  canViewPowerReserve(user: PanelUser): boolean {
    if (isOwner(user)) return true;
    const deviceId = getResilienceSettings()?.device_id;
    const device = deviceId ? (getDeviceById(deviceId) as { serial_number: string } | undefined) : undefined;
    return device !== undefined && canAccessDevice(user, device.serial_number);
  }

  /** Express guard for /api: 401 without a session, or while the initial account must change. */
  requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const identity = this.identify(req);
    if (identity && !identity.mustChange) {
      req.panelUser = identity.user;
      next();
      return;
    }
    res.status(401).json({ error: identity ? "Replace the initial login first" : "Sign in required", authRequired: true });
  };

  /** Guard for the auth routes that only need a session, the initial account's included. */
  requireSession = (req: Request, res: Response, next: NextFunction): void => {
    if (this.identify(req)) {
      next();
      return;
    }
    res.status(401).json({ error: "Sign in required", authRequired: true });
  };

  /** After requireAuth: panel settings, users, logs and automation are the owner's. */
  requireOwner = (req: Request, res: Response, next: NextFunction): void => {
    if (req.panelUser && isOwner(req.panelUser)) {
      next();
      return;
    }
    res.status(403).json({ error: "Only the panel owner can do this" });
  };

  /** After requireAuth: Power reserve can be read by whoever sees its device, changed by the owner. */
  requirePowerReserve = (req: Request, res: Response, next: NextFunction): void => {
    const user = req.panelUser;
    if (user && (req.method === "GET" ? this.canViewPowerReserve(user) : isOwner(user))) {
      next();
      return;
    }
    res.status(403).json({ error: "Only the panel owner can do this" });
  };

  // ----- Internals -----

  private identify(req: IncomingMessage): Identity | null {
    const session = this.sessionFor(req);
    if (!session) return null;
    const user = this.userById(session.user_id);
    if (!user) {
      // The user was removed
      db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(session.id_hash);
      return null;
    }
    return { session, user, mustChange: user.id === OWNER_ID && this.account!.mustChange };
  }

  private credentialsOf(userId: string): Credentials | null {
    if (userId === OWNER_ID) return this.account;
    return this.store.members.find((member) => member.id === userId) ?? null;
  }

  private recordCounter(userId: string, counter: number): void {
    if (userId === OWNER_ID) {
      if (this.account && counter !== this.account.lastTotpCounter) this.saveAccount({ ...this.account, lastTotpCounter: counter });
      return;
    }
    this.updateMembers((member) => (member.id === userId ? { ...member, lastTotpCounter: counter } : member));
  }

  private requireMember(id: string): Member {
    const member = this.store.members.find((candidate) => candidate.id === id);
    if (!member) throw new AuthError("User not found", 404);
    return member;
  }

  private findInvite(token: string): Invite {
    this.pruneInvites();
    const tokenHash = hashInviteToken(token);
    const invite = token.trim().length > 0 ? this.store.invites.find((candidate) => sameText(candidate.tokenHash, tokenHash)) : undefined;
    if (!invite) throw new AuthError("This invitation link is not valid or has expired; ask for a new one", 410);
    return invite;
  }

  private pruneInvites(): void {
    const now = new Date().toISOString();
    if (this.store.invites.some((invite) => invite.expiresAt < now)) {
      this.saveMembers({ ...this.store, invites: this.store.invites.filter((invite) => invite.expiresAt >= now) });
    }
  }

  /** Usernames are unique across the owner and invited users, ignoring case. */
  private assertUsernameFree(username: string, exceptId: string | null): void {
    const name = username.toLowerCase();
    const taken = (exceptId !== OWNER_ID && this.account?.username.toLowerCase() === name)
      || this.store.members.some((member) => member.id !== exceptId && member.username.toLowerCase() === name);
    if (taken) throw new AuthError("This username is taken; choose another", 409);
  }

  private async prepare(kind: Pending["kind"], subject: string | null, username: string, password: string) {
    const name = username.trim();
    if (name.length < 1 || name.length > 64) throw new AuthError("The username must be 1 to 64 characters", 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }
    this.assertUsernameFree(name, kind === "invite" ? null : subject);
    const now = Date.now();
    for (const [id, pending] of this.pending) if (pending.expiresAt < now) this.pending.delete(id);
    if (this.pending.size >= 10) throw new AuthError("Too many changes in progress; try again in a few minutes", 429);

    const totpSecret = generateTotpSecret();
    const setupId = crypto.randomBytes(16).toString("hex");
    this.pending.set(setupId, { kind, subject, username: name, passwordHash: await hashPassword(password), totpSecret, expiresAt: now + PENDING_TTL_MS });
    const uri = otpauthUri(totpSecret, name, ISSUER);
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return {
      setupId,
      secret: totpSecret,
      otpauthUri: uri,
      qrCode: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    };
  }

  /** The first code from the app proves it is set up; returns the credentials to save. */
  private confirm(kind: Pending["kind"], setupId: string, otp: string, subject?: string): { subject: string | null; credentials: Credentials } {
    const pending = this.pending.get(setupId);
    if (!pending || pending.kind !== kind || (subject !== undefined && pending.subject !== subject) || pending.expiresAt < Date.now()) {
      throw new AuthError("This step expired; start again", 410);
    }
    const counter = verifyTotp(pending.totpSecret, otp, Date.now());
    if (counter === null) throw new AuthError("Wrong code; check the time on your phone and try again", 401);
    this.pending.delete(setupId);
    return {
      subject: pending.subject,
      credentials: { username: pending.username, passwordHash: pending.passwordHash, totpSecret: pending.totpSecret, lastTotpCounter: counter },
    };
  }

  private createSession(userId: string, remember: boolean, req: Request, res: Response): void {
    const id = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 200) || null;
    db.prepare("INSERT INTO auth_sessions (id_hash, user_id, created_at, last_seen_at, expires_at, remember, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(hashSessionId(id), userId, now, now, now + (remember ? REMEMBER_MS : SESSION_MS), remember ? 1 : 0, userAgent);
    // req.headers.cookie is read again by status(): point it at the new session
    req.headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(id)}`;
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
      if (!saved.username || !saved.passwordHash) return null;
      return {
        username: saved.username,
        passwordHash: saved.passwordHash,
        totpSecret: saved.totpSecret ?? null,
        lastTotpCounter: saved.lastTotpCounter ?? -1,
        // Without an authenticator the account is the initial one, whatever the file says
        mustChange: saved.mustChange === true || !saved.totpSecret,
        createdAt: saved.createdAt ?? "",
      };
    } catch {
      return null;
    }
  }

  private saveAccount(account: Account): void {
    // The password hash and the authenticator secret: owner-only file
    this.writePrivate(ACCOUNT_FILE, account);
    this.account = account;
  }

  private loadMembers(): MembersStore {
    try {
      const saved = JSON.parse(fs.readFileSync(MEMBERS_FILE, "utf8")) as Partial<MembersStore>;
      return {
        members: (saved.members ?? []).filter((member) => member.id && member.username && member.passwordHash && member.totpSecret),
        invites: (saved.invites ?? []).filter((invite) => invite.id && invite.tokenHash),
      };
    } catch {
      return { members: [], invites: [] };
    }
  }

  private updateMembers(update: (member: Member) => Member): void {
    this.saveMembers({ ...this.store, members: this.store.members.map(update) });
  }

  private saveMembers(store: MembersStore): void {
    // Password hashes and authenticator secrets of the invited users
    this.writePrivate(MEMBERS_FILE, store);
    this.store = store;
  }

  private writePrivate(file: string, value: unknown): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
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
