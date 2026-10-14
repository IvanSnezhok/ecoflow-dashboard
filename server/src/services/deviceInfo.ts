// Technical/network details pulled out of an EcoFlow quota snapshot.
//
// The public Open API quota carries firmware versions, battery pack serials and the
// Wi-Fi RSSI, but (for the DELTA Pro at least) no MAC address or SSID. Those two are
// looked up by key name so a model that does report them shows them without changes.

export interface FirmwareEntry {
  module: string;
  version: string;
}

export interface BatteryPackInfo {
  label: string;
  serialNumber: string | null;
  firmware: string | null;
}

export interface WifiInfo {
  /** dBm; null when the device does not report it (it sends 0 then). */
  rssi: number | null;
  ssid: string | null;
  macAddress: string | null;
  firmware: string | null;
}

export interface DeviceTechnicalInfo {
  serialNumber: string;
  productName: string;
  model: number | null;
  firmware: FirmwareEntry[];
  batteryPacks: BatteryPackInfo[];
  wifi: WifiInfo;
  /** ISO timestamp of the snapshot, or null when it is live. */
  recordedAt: string | null;
}

const FIRMWARE_FIELDS: Array<[key: string, module: string]> = [
  ["pd.sysVer", "Main controller (PD)"],
  ["inv.sysVer", "Inverter"],
  ["mppt.swVer", "MPPT"],
  ["bmsMaster.sysVer", "Main BMS"],
];

const PACK_PREFIXES: Array<[prefix: string, label: string]> = [
  ["bmsMaster", "Main battery"],
  ["bmsSlave1", "Extra battery 1"],
  ["bmsSlave2", "Extra battery 2"],
];

/** EcoFlow packs versions as one 32-bit int, one byte per part: 16908444 → "1.2.2.156". */
export function formatPackedVersion(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");
}

/** Pack serials arrive as NUL-padded char-code arrays; all-"0" means unset. */
export function decodeCharCodes(value: unknown): string | null {
  let text: string | null = null;
  if (typeof value === "string") text = value;
  else if (Array.isArray(value) && value.every((c) => typeof c === "number")) {
    text = String.fromCharCode(...value.filter((c) => c > 0 && c < 128));
  }
  text = text?.replace(/[^\x20-\x7e]/g, "").trim() ?? null;
  if (!text || /^0+$/.test(text)) return null;
  return text;
}

function firstStringByKey(q: Record<string, unknown>, pattern: RegExp): string | null {
  for (const [key, value] of Object.entries(q)) {
    if (!pattern.test(key)) continue;
    const text = decodeCharCodes(value);
    if (text) return text;
  }
  return null;
}

function formatMac(value: string): string {
  const hex = value.replace(/[^0-9a-f]/gi, "");
  return hex.length === 12 ? hex.toUpperCase().match(/../g)!.join(":") : value;
}

export function extractTechnicalInfo(
  serialNumber: string,
  productName: string,
  q: Record<string, unknown>,
  recordedAt: string | null = null,
): DeviceTechnicalInfo {
  const firmware: FirmwareEntry[] = [];
  for (const [key, module] of FIRMWARE_FIELDS) {
    const version = formatPackedVersion(q[key]);
    if (version) firmware.push({ module, version });
  }

  const batteryPacks: BatteryPackInfo[] = [];
  for (const [prefix, label] of PACK_PREFIXES) {
    const pack = {
      label,
      serialNumber: decodeCharCodes(q[`${prefix}.packSn`]),
      firmware: formatPackedVersion(q[`${prefix}.sysVer`]),
    };
    if (pack.serialNumber || pack.firmware) batteryPacks.push(pack);
  }

  const rawRssi = q["pd.wifiRssi"] ?? q["wifiRssi"];
  const rssi = typeof rawRssi === "number" && rawRssi !== 0 ? rawRssi : null;
  const mac = firstStringByKey(q, /(^|\.)(wifi)?mac(addr(ess)?)?$/i);

  return {
    serialNumber,
    productName,
    model: typeof q["pd.model"] === "number" ? (q["pd.model"] as number) : null,
    firmware,
    batteryPacks,
    wifi: {
      rssi,
      ssid: firstStringByKey(q, /(^|\.)(wifi)?ssid$/i),
      macAddress: mac ? formatMac(mac) : null,
      firmware: formatPackedVersion(q["pd.wifiVer"]),
    },
    recordedAt,
  };
}
