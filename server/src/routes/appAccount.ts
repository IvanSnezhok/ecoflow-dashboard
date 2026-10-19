import { Router, Request, Response } from "express";
import { appChannel, AppAuthError } from "../services/appChannel.js";
import { isAppRegion } from "../services/appChannelProtocol.js";
import { insertLog } from "../db/database.js";

// EcoFlow account for the app channel (services/appChannel.ts), which reads devices the
// Open API serves only in part. The password is passed through once to EcoFlow and is
// never stored or logged; only the resulting token is kept.
const router = Router();

router.get("/status", (_req: Request, res: Response) => {
  res.json(appChannel.status());
});

router.post("/login", async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const region = req.body?.region;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (!isAppRegion(region)) {
    res.status(400).json({ error: "Unknown region" });
    return;
  }
  try {
    await appChannel.login(email, password, region);
    insertLog(null, "COMMAND", "appLogin", JSON.stringify({ region }), JSON.stringify({ success: true }), true, null);
    res.json(appChannel.status());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed";
    insertLog(null, "COMMAND", "appLogin", JSON.stringify({ region }), null, false, message);
    // 401: EcoFlow rejected the login; anything else means it could not be reached
    res.status(error instanceof AppAuthError ? 401 : 502).json({ error: message });
  }
});

router.delete("/account", (_req: Request, res: Response) => {
  appChannel.logout();
  insertLog(null, "COMMAND", "appLogout", null, JSON.stringify({ success: true }), true, null);
  res.json(appChannel.status());
});

export default router;
