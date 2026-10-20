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
