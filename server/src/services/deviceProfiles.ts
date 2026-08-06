export type DeviceCategory = "portablePowerStation" | "microinverter" | "smartPlug" | "homeEnergy" | "climate" | "unknown";
export type ProfileStatus = "supported" | "read-only";

export interface DeviceCapabilities {
  battery: boolean;
  acOutput: boolean;
  dcOutput: boolean;
  solarInput: boolean;
  extraBatteries: boolean;
  chargeLimits: boolean;
  chargingPower?: { min: number; max: number; step: number };
}

export interface NormalizedDeviceState {
  batterySoc: number;
  batteryWatts: number;
  acInputWatts: number;
  solarInputWatts: number;
  acOutputWatts: number;
  dcOutputWatts: number;
  temperature: number;
  acOutEnabled: boolean;
  dcOutEnabled: boolean;
  maxChgSoc?: number;
  minDsgSoc?: number;
  acChargingPower?: number;
  fastChargingEnabled?: boolean;
}

export type DeviceAction =
  | { type: "setAcOutput"; enabled: boolean }
  | { type: "setDcOutput"; enabled: boolean }
  | { type: "setMaxChargeSoc"; value: number }
  | { type: "setMinDischargeSoc"; value: number }
  | { type: "setAcChargingPower"; value: number };

export interface LegacyDeltaCommand { transport: "legacy-delta"; id: number; params: Record<string, number>; }
export interface DeviceProfile {
  id: string;
  category: DeviceCategory;
  status: ProfileStatus;
  documentationUrl: string;
  matches(productName: string): boolean;
  /** Refuse a product-name match if its observed schema is incompatible. */
  hasExpectedQuota?(quota: Record<string, unknown>): boolean;
  capabilities: DeviceCapabilities;
  normalizeQuota(quota: Record<string, unknown>): NormalizedDeviceState | null;
  buildCommand?(action: DeviceAction): LegacyDeltaCommand;
}

const noPowerStationControls: DeviceCapabilities = {
  battery: false, acOutput: false, dcOutput: false, solarInput: false,
  extraBatteries: false, chargeLimits: false,
};
const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;

const deltaProProfile: DeviceProfile = {
  id: "delta-pro-legacy",
  category: "portablePowerStation",
  status: "supported",
  documentationUrl: "https://developer.ecoflow.com/",
  // Legacy cmdSet:32 payloads have been verified only for the original DELTA Pro.
  matches: (name) => /DELTA[ _-]?PRO/i.test(name) && !/PRO[ _-]?(3|ULTRA)/i.test(name),
  hasExpectedQuota: (q) => "bmsMaster.soc" in q && "inv.outputWatts" in q,
  capabilities: {
    battery: true, acOutput: true, dcOutput: true, solarInput: true,
    extraBatteries: true, chargeLimits: true,
    chargingPower: { min: 200, max: 2900, step: 100 },
  },
  normalizeQuota: (q) => ({
    batterySoc: number(q["pd.soc"]) || number(q["bmsMaster.soc"]),
    batteryWatts: number(q["pd.wattsInSum"]) - number(q["pd.wattsOutSum"]),
    acInputWatts: number(q["inv.inputWatts"]),
    solarInputWatts: number(q["mppt.inWatts"]) || (number(q["mppt.inAmp"]) * number(q["mppt.inVol"])) / 1000,
    acOutputWatts: number(q["inv.outputWatts"]),
    dcOutputWatts: number(q["mppt.outWatts"]) || number(q["pd.carWatts"]),
    temperature: number(q["inv.outTemp"]) || number(q["bmsMaster.temp"]),
    acOutEnabled: number(q["inv.cfgAcEnabled"]) === 1 || number(q["inv.acOutState"]) === 1,
    dcOutEnabled: number(q["mppt.carState"]) === 1 || number(q["pd.carState"]) === 1,
    maxChgSoc: number(q["ems.maxChargeSoc"]) || undefined,
    minDsgSoc: number(q["ems.minDsgSoc"]),
    acChargingPower: number(q["inv.cfgSlowChgWatts"]) || undefined,
    fastChargingEnabled: number(q["inv.cfgFastChgWatts"]) > 0,
  }),
  buildCommand: (action): LegacyDeltaCommand => {
    switch (action.type) {
      case "setAcOutput": return { transport: "legacy-delta", id: 66, params: { enabled: action.enabled ? 1 : 0, xboost: 0 } };
      case "setDcOutput": return { transport: "legacy-delta", id: 81, params: { enabled: action.enabled ? 1 : 0 } };
      case "setMaxChargeSoc": return { transport: "legacy-delta", id: 49, params: { maxChgSoc: action.value } };
      case "setMinDischargeSoc": return { transport: "legacy-delta", id: 51, params: { minDsgSoc: action.value } };
      case "setAcChargingPower": return { transport: "legacy-delta", id: 69, params: { slowChgPower: action.value } };
    }
  },
};

function readOnlyProfile(id: string, category: DeviceCategory, matcher: RegExp): DeviceProfile {
  return {
    id, category, status: "read-only", documentationUrl: "https://developer.ecoflow.com/",
    matches: (name) => matcher.test(name), capabilities: noPowerStationControls,
    normalizeQuota: () => null,
  };
}

// These published EcoFlow families are deliberately classified, but not mapped or
// controllable until a documented quota fixture and command adapter are added.
const profiles: DeviceProfile[] = [
  deltaProProfile,
  readOnlyProfile("delta-modern-read-only", "portablePowerStation", /DELTA.*(?:2|3|MAX|ULTRA)/i),
  readOnlyProfile("river-read-only", "portablePowerStation", /RIVER/i),
  readOnlyProfile("powerstream-read-only", "microinverter", /POWERSTREAM/i),
  readOnlyProfile("smart-plug-read-only", "smartPlug", /SMART[ _-]?PLUG/i),
  readOnlyProfile("home-energy-read-only", "homeEnergy", /POWEROCEAN|POWER[ _-]?KITS|SMART[ _-]?HOME|BKW|STREAM/i),
  readOnlyProfile("climate-read-only", "climate", /GLACIER|WAVE/i),
];

const unknownProfile: DeviceProfile = {
  id: "unclassified-read-only", category: "unknown", status: "read-only",
  documentationUrl: "https://developer.ecoflow.com/", matches: () => true,
  capabilities: noPowerStationControls, normalizeQuota: () => null,
};

export function getDeviceProfile(productName: string, quota?: Record<string, unknown>): DeviceProfile {
  const profile = profiles.find((candidate) => candidate.matches(productName));
  if (!profile) return unknownProfile;
  return quota && profile.hasExpectedQuota && !profile.hasExpectedQuota(quota) ? unknownProfile : profile;
}

export function getSupportedCommand(productName: string, action: DeviceAction): LegacyDeltaCommand {
  const profile = getDeviceProfile(productName);
  if (profile.status !== "supported" || !profile.buildCommand) {
    throw new Error("This command is not supported for this device profile");
  }
  return profile.buildCommand(action);
}
