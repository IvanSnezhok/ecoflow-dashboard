// Who may do what in the panel. The owner (the account from the first setup) manages
// everything. People the owner invites see only the devices they were given: a viewer
// only looks, an operator also switches outputs and changes charge settings on them.

export type PanelRole = "owner" | "operator" | "viewer";
export type MemberRole = Exclude<PanelRole, "owner">;

export interface PanelUser {
  /** "owner", or an invited user's id */
  id: string;
  username: string;
  role: PanelRole;
  /** Serial numbers the user may see; null = every device, also ones added later */
  devices: string[] | null;
}

export const isOwner = (user: PanelUser) => user.role === "owner";

/** Outputs, charge limits and the other device commands, on the user's devices */
export const canControl = (user: PanelUser) => user.role !== "viewer";

export function canAccessDevice(user: PanelUser, sn: string): boolean {
  return user.role === "owner" || user.devices === null || user.devices.includes(sn);
}

export const isMemberRole = (value: unknown): value is MemberRole => value === "operator" || value === "viewer";

const SERIAL = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * Device access from a request: null for every device, else unique serial numbers.
 * undefined when the value is not one of those or names no device.
 */
export function parseDeviceList(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return undefined;
  if (!value.every((sn) => typeof sn === "string" && SERIAL.test(sn))) return undefined;
  return [...new Set(value as string[])];
}
