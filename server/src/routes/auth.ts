import { Router, Request, Response } from "express";
import { panelAuth, AuthError } from "../services/panelAuth.js";
import { insertLog } from "../db/database.js";

// Panel login (services/panelAuth.ts). Mounted before the /api guard, so these work
// without a session; the session list needs one.
const router = Router();

const text = (value: unknown) => (typeof value === "string" ? value : "");

function fail(res: Response, error: unknown) {
  if (error instanceof AuthError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[Auth]", error);
  res.status(500).json({ error: "Sign-in failed" });
}

router.get("/status", (req: Request, res: Response) => {
  res.json(panelAuth.status(req));
});

router.post("/setup/start", async (req: Request, res: Response) => {
  try {
    res.json(await panelAuth.startSetup(text(req.body?.setupSecret), text(req.body?.username), text(req.body?.password)));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/setup/finish", (req: Request, res: Response) => {
  try {
    const status = panelAuth.finishSetup(text(req.body?.setupId), text(req.body?.otp), req.body?.remember === true, req, res);
    insertLog(null, "COMMAND", "panelLoginSetup", JSON.stringify({ username: status.username }), JSON.stringify({ success: true }), true, null);
    res.json(status);
  } catch (error) {
    fail(res, error);
  }
});

router.post("/login", async (req: Request, res: Response) => {
  const username = text(req.body?.username).trim();
  const remember = req.body?.remember === true;
  try {
    const status = await panelAuth.login(username, text(req.body?.password), text(req.body?.otp), remember, req, res);
    insertLog(null, "COMMAND", "panelLogin", JSON.stringify({ username, remember }), JSON.stringify({ success: true }), true, null);
    res.json(status);
  } catch (error) {
    // Failed attempts are kept, so guessing shows up in the Logs page
    insertLog(null, "COMMAND", "panelLogin", JSON.stringify({ username, remember }), null, false, error instanceof Error ? error.message : "failed");
    fail(res, error);
  }
});

// New username, password and authenticator: right after signing in with the initial
// account, or later from Settings (then with the current password and a code)
router.post("/change/start", panelAuth.requireSession, async (req: Request, res: Response) => {
  try {
    res.json(await panelAuth.startChange(
      req,
      { password: text(req.body?.currentPassword), otp: text(req.body?.currentOtp) },
      text(req.body?.username),
      text(req.body?.password),
    ));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/change/finish", panelAuth.requireSession, (req: Request, res: Response) => {
  try {
    const status = panelAuth.finishChange(req, text(req.body?.setupId), text(req.body?.otp));
    insertLog(null, "COMMAND", "panelLoginChange", JSON.stringify({ username: status.username }), JSON.stringify({ success: true }), true, null);
    res.json(status);
  } catch (error) {
    fail(res, error);
  }
});

// Accepting an invitation (routes/users.ts makes them). The token from the link travels
// in the body, so it stays out of the request log (lib/redact.ts masks it there too).
router.post("/invite/check", (req: Request, res: Response) => {
  try {
    res.json(panelAuth.inviteDetails(text(req.body?.token)));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/invite/start", async (req: Request, res: Response) => {
  try {
    res.json(await panelAuth.startInvite(text(req.body?.token), text(req.body?.username), text(req.body?.password)));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/invite/finish", (req: Request, res: Response) => {
  try {
    const status = panelAuth.finishInvite(text(req.body?.setupId), text(req.body?.otp), req.body?.remember === true, req, res);
    insertLog(null, "COMMAND", "panelInviteAccepted", JSON.stringify({ username: status.username, role: status.role }), JSON.stringify({ success: true }), true, null);
    res.json(status);
  } catch (error) {
    fail(res, error);
  }
});

router.post("/logout", (req: Request, res: Response) => {
  panelAuth.logout(req, res);
  // The session row is gone, so this reads as signed out
  res.json(panelAuth.status(req));
});

router.get("/sessions", panelAuth.requireAuth, (req: Request, res: Response) => {
  res.json(panelAuth.sessions(req));
});

router.post("/sessions/revoke-others", panelAuth.requireAuth, (req: Request, res: Response) => {
  panelAuth.revokeOtherSessions(req);
  insertLog(null, "COMMAND", "panelRevokeSessions", null, JSON.stringify({ success: true }), true, null);
  res.json(panelAuth.sessions(req));
});

export default router;
