/**
 * Builds the durable chart sample (one device_states row) from an EcoFlow quota.
 *
 * The quota API sometimes answers with a partial payload (only some modules), and
 * MQTT pushes only the keys that changed. Writing `|| 0` for a missing key is what
 * drew the sudden "drops to 0%" on the battery chart, so every metric here is
 * `null` when the quota does not carry it; SQLite AVG() and the charts skip nulls.
 */

export interface StateSample {
  batterySoc: number | null;
  batteryWatts: number | null;
  acInputWatts: number | null;
  solarInputWatts: number | null;
  acOutputWatts: number | null;
  dcOutputWatts: number | null;
  temperature: number | null;
  bmsMasterVol: number | null;
  extraBattery1Soc: number | null;
  extraBattery1Temp: number | null;
  extraBattery1Vol: number | null;
  extraBattery2Soc: number | null;
  extraBattery2Temp: number | null;
  extraBattery2Vol: number | null;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** First key that is present, so a real 0 W reading is kept as 0. */
const firstOf = (q: Record<string, unknown>, ...keys: string[]): number | null => {
  for (const key of keys) {
    const value = num(q[key]);
    if (value !== null) return value;
  }
  return null;
};

/** A battery SOC of exactly 0 is what an uninitialised BMS field reports; treat it as missing. */
const soc = (value: number | null): number | null =>
  value !== null && value > 0 && value <= 100 ? Math.round(value) : null;

function extraBattery(q: Record<string, unknown>, prefix: string) {
  const fullCap = num(q[`${prefix}.fullCap`]);
  const vol = num(q[`${prefix}.vol`]);
  let level = num(q[`${prefix}.soc`]);
  if (level === null) {
    const remainCap = num(q[`${prefix}.remainCap`]);
    if (remainCap !== null && fullCap) level = (remainCap / fullCap) * 100;
  }
  return {
    soc: soc(level),
    temp: firstOf(q, `${prefix}.temp`, `${prefix}.minCellTemp`),
    vol: vol || null,
  };
}

export function buildStateSample(q: Record<string, unknown>): StateSample {
  const wattsIn = num(q["pd.wattsInSum"]);
  const wattsOut = num(q["pd.wattsOutSum"]);
  const mpptAmp = num(q["mppt.inAmp"]);
  const mpptVol = num(q["mppt.inVol"]);
  const extra1 = extraBattery(q, "bmsSlave1");
  const extra2 = extraBattery(q, "bmsSlave2");

  return {
    batterySoc: soc(num(q["pd.soc"]) || num(q["bmsMaster.soc"])),
    batteryWatts: wattsIn !== null || wattsOut !== null ? (wattsIn ?? 0) - (wattsOut ?? 0) : null,
    acInputWatts: num(q["inv.inputWatts"]),
    solarInputWatts:
      num(q["mppt.inWatts"]) ??
      (mpptAmp !== null && mpptVol !== null ? Math.round((mpptAmp * mpptVol) / 1000) : null),
    acOutputWatts: num(q["inv.outputWatts"]),
    dcOutputWatts: firstOf(q, "mppt.outWatts", "pd.carWatts"),
    temperature: num(q["inv.outTemp"]) || num(q["bmsMaster.temp"]),
    bmsMasterVol: num(q["bmsMaster.vol"]) || null,
    extraBattery1Soc: extra1.soc,
    extraBattery1Temp: extra1.temp,
    extraBattery1Vol: extra1.vol,
    extraBattery2Soc: extra2.soc,
    extraBattery2Temp: extra2.temp,
    extraBattery2Vol: extra2.vol,
  };
}

/** A sample without SOC and without any power reading carries nothing worth charting. */
export function isUsefulSample(sample: StateSample): boolean {
  return (
    sample.batterySoc !== null ||
    sample.acInputWatts !== null ||
    sample.acOutputWatts !== null ||
    sample.solarInputWatts !== null
  );
}
