/**
 * Which non-zero DELTA Pro error fields are real problems and which are status.
 * Keep in sync with src/utils/errorCodes.ts (the UI's descriptions).
 *
 * - bms*.errCode is an enum, not a bitmask. 5, 6 and 23 show up in normal
 *   operation: 6 = charge complete at 100 %, 23 = charging stopped at the user's
 *   max-charge limit (observed in community dumps), 5 = standby/charge-stop
 *   state (seen in normal operation, undocumented).
 * - mppt.faultCode is byte-coded (solar | car 12 V << 8 | DC 24 V << 16); 4096
 *   (0x1000) is a steady value seen in normal use and not a fault.
 */
export const BMS_STATUS_CODES = new Set([5, 6, 23]);
export const MPPT_STATUS_CODES = new Set([4096]);

/** Field family: "bms", "extraBattery1", "extraBattery2", "inv", "mppt", ... */
export function isStatusCode(field: string, code: number): boolean {
  switch (field) {
    case "bms":
    case "extraBattery1":
    case "extraBattery2":
      return BMS_STATUS_CODES.has(code);
    case "mppt":
      return MPPT_STATUS_CODES.has(code);
    default:
      return false;
  }
}

/** Non-zero and not a known status code */
export function isRealErrorCode(field: string, code: number | undefined | null): boolean {
  return typeof code === "number" && code !== 0 && !isStatusCode(field, code);
}
