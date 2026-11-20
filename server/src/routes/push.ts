import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { DEFAULT_PUSH_PREFS, isExpoPushToken } from "../lib/pushMessages.js";
import { panelAuth } from "../services/panelAuth.js";
import { isApnsToken, pushService } from "../services/pushService.js";

// The phone app's push registration (services/pushService.ts). Any signed-in user may
// register their own phone; what they hear about follows their role and devices.
const router = Router();

const registerSchema = z.object({
  token: z.string().refine(isExpoPushToken, "Not an Expo push token"),
  platform: z.string().max(20).default(""),
  language: z.enum(["uk", "en"]).default("en"),
  prefs: z.object({
    grid: z.boolean(),
    lowBattery: z.boolean(),
    offline: z.boolean(),
    threshold: z.number().int().min(5).max(80),
  }).default(DEFAULT_PUSH_PREFS),
});

router.post("/register", (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  const session = panelAuth.socketUser(req);
  if (!parsed.success || !session) {
    res.status(400).json({ error: parsed.success ? "Sign in required" : parsed.error.issues[0]?.message ?? "Invalid registration" });
    return;
  }
  const { token, platform, language, prefs } = parsed.data;
  pushService.register(session, token, platform, language, prefs);
  res.json({ registered: true, language, prefs });
});

router.post("/unregister", (req: Request, res: Response) => {
  const token = (req.body as { token?: unknown } | undefined)?.token;
  if (isExpoPushToken(token) && pushService.registration(req.panelUser!.id, token)) pushService.unregister(token);
  res.json({ registered: false });
});

router.post("/status", (req: Request, res: Response) => {
  const token = (req.body as { token?: unknown } | undefined)?.token;
  const registration = isExpoPushToken(token) ? pushService.registration(req.panelUser!.id, token) : null;
  res.json(registration ? { registered: true, ...registration, liveActivity: pushService.liveActivityReady } : { registered: false });
});

const apnsToken = z.string().refine(isApnsToken, "Not a Live Activity token").nullable().optional();
const liveActivitySchema = z.object({ token: z.string().refine(isExpoPushToken), startToken: apnsToken, activityToken: apnsToken });

// iPhone: the tokens that let the server start and refresh the outage Live Activity
router.post("/live-activity", (req: Request, res: Response) => {
  const parsed = liveActivitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid tokens" });
    return;
  }
  const { token, startToken, activityToken } = parsed.data;
  if (!pushService.setLiveActivityTokens(req.panelUser!.id, token, { startToken, activityToken })) {
    res.status(404).json({ error: "This phone is not registered for notifications" });
    return;
  }
  res.json({ saved: true, ready: pushService.liveActivityReady });
});

router.post("/test", async (req: Request, res: Response) => {
  const token = (req.body as { token?: unknown } | undefined)?.token;
  const registration = isExpoPushToken(token) ? pushService.registration(req.panelUser!.id, token) : null;
  if (!registration || !isExpoPushToken(token)) {
    res.status(404).json({ error: "This phone is not registered for notifications" });
    return;
  }
  const refusal = await pushService.sendTest(token, registration.language);
  if (refusal) res.status(502).json({ error: refusal });
  else res.json({ sent: true });
});

export default router;
