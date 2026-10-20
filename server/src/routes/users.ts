import { Router, Request, Response } from "express";
import { panelAuth, AuthError } from "../services/panelAuth.js";
import { insertLog } from "../db/database.js";
import { isMemberRole, parseDeviceList } from "../lib/permissions.js";

// Invited users and invitations (services/panelAuth.ts). Mounted behind requireOwner.
const router = Router();

function fail(res: Response, error: unknown) {
  if (error instanceof AuthError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[Users]", error);
  res.status(500).json({ error: "Request failed" });
}

const log = (operation: string, details: Record<string, unknown>) =>
  insertLog(null, "COMMAND", operation, JSON.stringify(details), JSON.stringify({ success: true }), true, null);

router.get("/", (_req: Request, res: Response) => {
  res.json(panelAuth.listMembers());
});

// The link carries a token shown only in this answer; the panel builds the URL from it
router.post("/invites", (req: Request, res: Response) => {
  const role = req.body?.role;
  const devices = parseDeviceList(req.body?.devices);
  if (!isMemberRole(role) || devices === undefined) {
    res.status(400).json({ error: "Choose a role and all devices or at least one device" });
    return;
  }
  try {
    const created = panelAuth.createInvite(role, devices);
    log("panelInviteCreated", { role, devices: devices ?? "all" });
    res.json(created);
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/invites/:id", (req: Request, res: Response) => {
  try {
    panelAuth.revokeInvite(req.params.id);
    log("panelInviteRevoked", { id: req.params.id });
    res.json(panelAuth.listMembers());
  } catch (error) {
    fail(res, error);
  }
});

router.patch("/:id", (req: Request, res: Response) => {
  const changes: { role?: "operator" | "viewer"; devices?: string[] | null } = {};
  if (req.body?.role !== undefined) {
    if (!isMemberRole(req.body.role)) {
      res.status(400).json({ error: "Unknown role" });
      return;
    }
    changes.role = req.body.role;
  }
  if (req.body?.devices !== undefined) {
    const devices = parseDeviceList(req.body.devices);
    if (devices === undefined) {
      res.status(400).json({ error: "Choose all devices or at least one device" });
      return;
    }
    changes.devices = devices;
  }
  try {
    const username = panelAuth.updateMember(req.params.id, changes);
    log("panelUserUpdated", { username, ...changes });
    res.json(panelAuth.listMembers());
  } catch (error) {
    fail(res, error);
  }
});

router.post("/:id/sign-out", (req: Request, res: Response) => {
  try {
    log("panelUserSignedOut", { username: panelAuth.signOutMember(req.params.id) });
    res.json(panelAuth.listMembers());
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/:id", (req: Request, res: Response) => {
  try {
    log("panelUserRemoved", { username: panelAuth.removeMember(req.params.id) });
    res.json(panelAuth.listMembers());
  } catch (error) {
    fail(res, error);
  }
});

export default router;
