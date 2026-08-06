export type DeviceCategory = "portablePowerStation" | "microinverter" | "smartPlug" | "homeEnergy" | "climate" | "unknown";

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

export interface DeviceProfile {
  id: string;
  category: DeviceCategory;
  matches(productName: string): boolean;
  capabilities: DeviceCapabilities;
  normalizeQuota(quota: Record<string, unknown>): NormalizedDeviceState | null;
}

const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;

const deltaProProfile: DeviceProfile = {
  id: "delta-pro-legacy",
  category: "portablePowerStation",
  // Legacy cmdSet:32 command payloads below are documented for DELTA Pro only.
  matches: (name) => /DELTA[ _-]?PRO/i.test(name) && !/PRO[ _-]?(3|ULTRA)/i.test(name),
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
};

const unknownProfile: DeviceProfile = {
  id: "unclassified-read-only",
  category: "unknown",
  matches: () => true,
  capabilities: { battery: false, acOutput: false, dcOutput: false, solarInput: false, extraBatteries: false, chargeLimits: false },
  normalizeQuota: () => null,
};

const profiles = [deltaProProfile];
export function getDeviceProfile(productName: string): DeviceProfile {
  return profiles.find((profile) => profile.matches(productName)) ?? unknownProfile;
}
