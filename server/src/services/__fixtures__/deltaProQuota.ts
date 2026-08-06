import type { NormalizedDeviceState } from "../deviceProfiles.js";

// Redacted contract fixture for the documented legacy DELTA Pro quota schema.
// Add one fixture per model before changing it from read-only to supported.
export const deltaProQuotaFixture = {
  "pd.soc": 82,
  "pd.wattsInSum": 1200,
  "pd.wattsOutSum": 300,
  "bmsMaster.soc": 82,
  "bmsMaster.temp": 24,
  "inv.inputWatts": 1000,
  "inv.outputWatts": 250,
  "inv.outTemp": 25,
  "inv.cfgAcEnabled": 1,
  "mppt.inWatts": 200,
  "mppt.outWatts": 50,
  "mppt.carState": 1,
  "ems.maxChargeSoc": 90,
  "ems.minDsgSoc": 10,
  "inv.cfgSlowChgWatts": 1800,
} as const;

export const deltaProNormalizedFixture: Partial<NormalizedDeviceState> = {
  batterySoc: 82, batteryWatts: 900, acInputWatts: 1000, solarInputWatts: 200,
  acOutputWatts: 250, dcOutputWatts: 50, temperature: 25, acOutEnabled: true,
  dcOutEnabled: true, maxChgSoc: 90, minDsgSoc: 10, acChargingPower: 1800,
  fastChargingEnabled: false,
};
