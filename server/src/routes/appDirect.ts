import { Router, type Request, type Response } from "express";
import { panelAuth } from "../services/panelAuth.js";

// The phone app's independent mode (mobile/src/lib/direct.ts): the owner's phone keeps the
// EcoFlow Open API keys and reads the stations straight from the EcoFlow cloud while the
// panel cannot be reached. Owner only, and the password is asked again: the keys control
// the stations.
const router = Router();

// A wrong password costs a wait that doubles, so the keys cannot be fished for from a stolen session
let failures = 0;
let blockedUntil = 0;

router.post("/", async (req: Request, res: Response) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const accessKey = process.env.ECOFLOW_ACCESS_KEY;
  const secretKey = process.env.ECOFLOW_SECRET_KEY;
  if (!accessKey || !secretKey) {
    res.status(409).json({ error: "The panel has no EcoFlow API keys" });
    return;
  }
  if (Date.now() < blockedUntil) {
    res.status(429).json({ error: "Too many attempts, try again later" });
    return;
  }
  if (!password || !(await panelAuth.ownerPasswordOk(password))) {
    failures += 1;
    if (failures >= 3) blockedUntil = Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** (failures - 3));
    res.status(403).json({ error: "Wrong password" });
    return;
  }
  failures = 0;
  console.log(`[Auth] EcoFlow keys handed to the phone app of ${req.panelUser!.username}`);
  res.json({ accessKey, secretKey, endpoint: process.env.ECOFLOW_API_ENDPOINT || "https://api-e.ecoflow.com" });
});

export default router;
