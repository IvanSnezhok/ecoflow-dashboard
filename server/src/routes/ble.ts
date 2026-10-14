import { Router, Request, Response } from "express";
import { bleBridge, BridgeError } from "../services/bleBridge.js";
import { insertLog } from "../db/database.js";

// EcoFlow account for the Bluetooth channel. The bridge needs the account's user ID
// to authenticate with the station; the password is passed through once and never
// stored or logged.
const router = Router();

const REGIONS = new Set(["auto", "api", "api-e", "api-a", "api-j", "api-r", "api-cn"]);

function requireBridge(res: Response): boolean {
  if (bleBridge.enabled) return true;
  res.status(409).json({ error: "BLE bridge is not configured (ECOFLOW_BLE_BRIDGE_URL)" });
  return false;
}

async function respondWithStatus(res: Response) {
  await bleBridge.refresh();
  res.json({ ...bleBridge.overview(), devices: bleBridge.devices() });
}

router.get("/status", async (_req: Request, res: Response) => {
  res.json({ ...bleBridge.overview(), devices: bleBridge.devices() });
});

router.post("/login", async (req: Request, res: Response) => {
  if (!requireBridge(res)) return;
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const region = typeof req.body?.region === "string" && req.body.region ? req.body.region : "auto";
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (!REGIONS.has(region)) {
    res.status(400).json({ error: "Unknown region" });
    return;
  }
  try {
    await bleBridge.login(email, password, region);
    insertLog(null, "COMMAND", "bleLogin", JSON.stringify({ region }), JSON.stringify({ success: true }), true, null);
    await respondWithStatus(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed";
    insertLog(null, "COMMAND", "bleLogin", JSON.stringify({ region }), null, false, message);
    // 401: EcoFlow rejected the login; anything else means it could not be reached
    res.status(error instanceof BridgeError && error.status === 401 ? 401 : 502).json({ error: message });
  }
});

router.post("/user-id", async (req: Request, res: Response) => {
  if (!requireBridge(res)) return;
  const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : String(req.body?.userId ?? "");
  if (!/^\d+$/.test(userId)) {
    res.status(400).json({ error: "User ID must contain only digits" });
    return;
  }
  try {
    await bleBridge.setUserId(userId);
    insertLog(null, "COMMAND", "bleSetUserId", null, JSON.stringify({ success: true }), true, null);
    await respondWithStatus(res);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Request failed" });
  }
});

router.delete("/account", async (_req: Request, res: Response) => {
  if (!requireBridge(res)) return;
  try {
    await bleBridge.forgetUserId();
    insertLog(null, "COMMAND", "bleForgetUserId", null, JSON.stringify({ success: true }), true, null);
    await respondWithStatus(res);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Request failed" });
  }
});

export default router;
