import { Router, Request, Response } from "express";
import { ecoflowApi } from "../services/ecoflowApi.js";
import { mqttService } from "../services/mqttService.js";
import {
  upsertDevice,
  getDeviceBySn,
  getAllDevices,
  getLatestDeviceState,
  insertDeviceState,
  insertLog,
  getDeviceHistory,
  getLastKnownErrors,
  getErrorHistory,
  type AggregationType,
} from "../db/database.js";

const router = Router();

// Cache for extra battery data (Ecoflow API returns data for one battery at a time)
interface ExtraBatteryCache {
  extraBattery1?: {
    soc: number;
    temp: number;
    vol: number;
    inputWatts: number;
    outputWatts: number;
    cycles: number;
    soh: number;
    fullCap: number;
    remainCap: number;
    connected: boolean;
    lastUpdated: number;
  };
  extraBattery2?: {
    soc: number;
    temp: number;
    vol: number;
    inputWatts: number;
    outputWatts: number;
    cycles: number;
    soh: number;
    fullCap: number;
    remainCap: number;
    connected: boolean;
    lastUpdated: number;
  };
}
const extraBatteryCache: Map<string, ExtraBatteryCache> = new Map();

// Cache for API responses (to handle 1 req/sec polling without overloading Ecoflow API)
interface DevicesCache {
  data: unknown[] | null;
  timestamp: number;
}
let devicesCache: DevicesCache = { data: null, timestamp: 0 };
const CACHE_TTL = 500; // 500ms cache - allows ~2 real API calls per second

// Get all devices with their latest state
router.get("/", async (_req: Request, res: Response) => {
  try {
    // Return cached data if fresh
    if (devicesCache.data && Date.now() - devicesCache.timestamp < CACHE_TTL) {
      return res.json(devicesCache.data);
    }

    // Fetch devices from Ecoflow API
    const apiDevices = await ecoflowApi.getDeviceList();

    // Update local database
    const devices = await Promise.all(
      apiDevices.map(async (apiDevice) => {
        const deviceId = upsertDevice(
          apiDevice.sn,
          apiDevice.productName,
          apiDevice.deviceName,
          apiDevice.online === 1,
        );

        // Get quota for online devices
        let state = null;
        if (apiDevice.online === 1) {
          try {
            const quota = await ecoflowApi.getDeviceQuota(apiDevice.sn);

            // Defensive check - skip if quota is invalid
            if (!quota || typeof quota !== "object") {
              console.warn(`Invalid quota response for ${apiDevice.sn}`);
              return {
                serialNumber: apiDevice.sn,
                deviceType: apiDevice.productName,
                name: apiDevice.deviceName,
                online: apiDevice.online === 1,
                lastSeen: new Date().toISOString(),
                state: null,
              };
            }

            const q = quota as Record<string, unknown>;

            // Helper function to parse extra battery data
            const parseExtraBattery = (prefix: string) => {
              // Check if battery is connected by presence of any battery data
              const fullCap = q[`${prefix}.fullCap`] as number | undefined;
              const vol = q[`${prefix}.vol`] as number | undefined;

              // If no capacity or voltage data, battery is not connected
              if (!fullCap && !vol) {
                return undefined;
              }

              // Get SOC - try direct value first
              let soc = q[`${prefix}.soc`] as number | undefined;

              // If no direct SOC, try to calculate from remainCap/fullCap
              if (soc === undefined || soc === null) {
                const remainCap = q[`${prefix}.remainCap`] as
                  | number
                  | undefined;
                if (remainCap && fullCap && fullCap > 0) {
                  soc = Math.round((remainCap / fullCap) * 100);
                }
              }

              // Temperature - fallback to minCellTemp if temp is missing
              const temp =
                (q[`${prefix}.temp`] as number) ??
                (q[`${prefix}.minCellTemp`] as number) ??
                0;

              // SOH - fallback to cycleSoh
              const soh =
                (q[`${prefix}.soh`] as number) ??
                (q[`${prefix}.cycleSoh`] as number) ??
                100;

              return {
                soc: soc ?? 0,
                temp,
                vol: vol ?? 0,
                inputWatts: (q[`${prefix}.inputWatts`] as number) ?? 0,
                outputWatts: (q[`${prefix}.outputWatts`] as number) ?? 0,
                cycles: (q[`${prefix}.cycles`] as number) ?? 0,
                soh,
                fullCap: fullCap ?? 0,
                remainCap: (q[`${prefix}.remainCap`] as number) ?? 0,
                connected: true,
                errCode: (q[`${prefix}.errCode`] as number) ?? 0,
              };
            };

            // Extract relevant state data using Ecoflow's dot-notation fields
            state = {
              serialNumber: apiDevice.sn,
              batterySoc:
                (q["pd.soc"] as number) || (q["bmsMaster.soc"] as number) || 0,
              batteryWatts:
                ((q["pd.wattsInSum"] as number) || 0) -
                ((q["pd.wattsOutSum"] as number) || 0),
              acInputWatts: (q["inv.inputWatts"] as number) || 0,
              solarInputWatts:
                (q["mppt.inWatts"] as number) ||
                (((q["mppt.inAmp"] as number) || 0) *
                  ((q["mppt.inVol"] as number) || 0)) /
                  1000 ||
                0,
              acOutputWatts: (q["inv.outputWatts"] as number) || 0,
              dcOutputWatts:
                (q["mppt.outWatts"] as number) ||
                (q["pd.carWatts"] as number) ||
                0,
              temperature:
                (q["inv.outTemp"] as number) ||
                (q["bmsMaster.temp"] as number) ||
                0,
              acOutEnabled:
                (q["inv.cfgAcEnabled"] as number) === 1 ||
                (q["inv.acOutState"] as number) === 1,
              dcOutEnabled:
                (q["mppt.carState"] as number) === 1 ||
                (q["pd.carState"] as number) === 1,
              timestamp: new Date().toISOString(),
              // ETA in minutes
              chgRemainTime: (q["ems.chgRemainTime"] as number) || undefined,
              dsgRemainTime: (q["ems.dsgRemainTime"] as number) || undefined,
              // Error codes
              errorCodes: {
                bmsMasterErrCode: (q["bmsMaster.errCode"] as number) ?? 0,
                invErrCode: (q["inv.errCode"] as number) ?? 0,
                mpptFaultCode: (q["mppt.faultCode"] as number) ?? 0,
                overloadState: (q["pd.iconOverloadState"] as number) ?? 0,
                emsIsNormal: (q["ems.emsIsNormalFlag"] as number) === 1,
              },
              // Extra batteries (bmsSlave1 and bmsSlave2)
              // Ecoflow API returns data for one battery at a time, so we cache and merge
              extraBattery1: (() => {
                const parsed = parseExtraBattery("bmsSlave1");
                if (parsed) {
                  // Update cache with fresh data
                  const cache = extraBatteryCache.get(apiDevice.sn) || {};
                  cache.extraBattery1 = { ...parsed, lastUpdated: Date.now() };
                  extraBatteryCache.set(apiDevice.sn, cache);
                  return parsed;
                }
                // Return cached data if available (within 5 minutes)
                const cached = extraBatteryCache.get(
                  apiDevice.sn,
                )?.extraBattery1;
                if (cached && Date.now() - cached.lastUpdated < 5 * 60 * 1000) {
                  const { lastUpdated, ...batteryData } = cached;
                  return batteryData;
                }
                return undefined;
              })(),
              extraBattery2: (() => {
                const parsed = parseExtraBattery("bmsSlave2");
                if (parsed) {
                  // Update cache with fresh data
                  const cache = extraBatteryCache.get(apiDevice.sn) || {};
                  cache.extraBattery2 = { ...parsed, lastUpdated: Date.now() };
                  extraBatteryCache.set(apiDevice.sn, cache);
                  return parsed;
                }
                // Return cached data if available (within 5 minutes)
                const cached = extraBatteryCache.get(
                  apiDevice.sn,
                )?.extraBattery2;
                if (cached && Date.now() - cached.lastUpdated < 5 * 60 * 1000) {
                  const { lastUpdated, ...batteryData } = cached;
                  return batteryData;
                }
                return undefined;
              })(),
              // Charge settings from device
              maxChgSoc: (q["ems.maxChargeSoc"] as number) || undefined,
              minDsgSoc: (q["ems.minDsgSoc"] as number) || undefined,
              acChargingPower: (q["inv.cfgSlowChgWatts"] as number) || undefined,
              fastChargingEnabled: ((q["inv.cfgFastChgWatts"] as number) || 0) > 0,
            };

            // Save state to database (including new chart data)
            insertDeviceState(deviceId, {
              batterySoc: state.batterySoc,
              batteryWatts: state.batteryWatts,
              acInputWatts: state.acInputWatts,
              solarInputWatts: state.solarInputWatts,
              acOutputWatts: state.acOutputWatts,
              dcOutputWatts: state.dcOutputWatts,
              temperature: state.temperature,
              rawData: JSON.stringify(quota),
              // New fields for detailed charts
              bmsMasterVol: (q["bmsMaster.vol"] as number) || null,
              extraBattery1Soc: state.extraBattery1?.soc ?? null,
              extraBattery1Temp: state.extraBattery1?.temp ?? null,
              extraBattery1Vol: state.extraBattery1?.vol ?? null,
              extraBattery2Soc: state.extraBattery2?.soc ?? null,
              extraBattery2Temp: state.extraBattery2?.temp ?? null,
              extraBattery2Vol: state.extraBattery2?.vol ?? null,
            });

            // Subscribe to MQTT updates
            mqttService.subscribeToDevice(apiDevice.sn);
          } catch (error) {
            console.error(`Failed to get quota for ${apiDevice.sn}:`, error);
          }
        }

        // For offline devices, get last known errors from DB
        let lastKnownErrors = null;
        if (apiDevice.online !== 1) {
          const errors = getLastKnownErrors(deviceId);
          if (errors) {
            // Check if there are any actual errors
            const hasErrors =
              errors.bmsMasterErrCode !== 0 ||
              errors.invErrCode !== 0 ||
              errors.mpptFaultCode !== 0 ||
              errors.overloadState !== 0 ||
              !errors.emsIsNormal ||
              (errors.bmsSlave1ErrCode && errors.bmsSlave1ErrCode !== 0) ||
              (errors.bmsSlave2ErrCode && errors.bmsSlave2ErrCode !== 0);

            if (hasErrors) {
              lastKnownErrors = errors;
            }
          }
        }

        return {
          serialNumber: apiDevice.sn,
          deviceType: apiDevice.productName,
          name: apiDevice.deviceName,
          online: apiDevice.online === 1,
          lastSeen: new Date().toISOString(),
          state,
          lastKnownErrors,
        };
      }),
    );

    // Update cache
    devicesCache = { data: devices, timestamp: Date.now() };

    insertLog(
      null,
      "API_CALL",
      "getDevices",
      null,
      JSON.stringify({ count: devices.length }),
      true,
      null,
    );
    res.json(devices);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    insertLog(null, "API_CALL", "getDevices", null, null, false, message);
    res.status(500).json({ error: message });
  }
});

// Get single device with state
router.get("/:sn", async (req: Request, res: Response) => {
  try {
    const { sn } = req.params;
    const device = getDeviceBySn(sn) as
      | {
          id: number;
          serial_number: string;
          device_type: string;
          name: string;
          online: number;
        }
      | undefined;

    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    let state = null;
    if (device.online) {
      const quota = await ecoflowApi.getDeviceQuota(sn);
      state = {
        serialNumber: sn,
        batterySoc: quota.soc || 0,
        batteryWatts: (quota.wattsInSum || 0) - (quota.wattsOutSum || 0),
        acInputWatts: (quota as Record<string, number>).acInWatts || 0,
        solarInputWatts: (quota as Record<string, number>).pvInWatts || 0,
        acOutputWatts: (quota as Record<string, number>).acOutWatts || 0,
        dcOutputWatts: (quota as Record<string, number>).dcOutWatts || 0,
        temperature: (quota as Record<string, number>).temp || 0,
        acOutEnabled: (quota as Record<string, number>).acOutState === 1,
        dcOutEnabled: (quota as Record<string, number>).dcOutState === 1,
        timestamp: new Date().toISOString(),
      };
    }

    res.json({
      serialNumber: device.serial_number,
      deviceType: device.device_type,
      name: device.name,
      online: device.online === 1,
      state,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// Control AC output
router.post("/:sn/ac-output", async (req: Request, res: Response) => {
  try {
    const { sn } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    const device = getDeviceBySn(sn) as { id: number } | undefined;
    const deviceId = device?.id || null;

    await ecoflowApi.setAcOutput(sn, enabled);

    insertLog(
      deviceId,
      "COMMAND",
      "setAcOutput",
      JSON.stringify({ sn, enabled }),
      JSON.stringify({ success: true }),
      true,
      null,
    );

    res.json({
      success: true,
      message: `AC output ${enabled ? "enabled" : "disabled"}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const device = getDeviceBySn(req.params.sn) as { id: number } | undefined;
    insertLog(
      device?.id || null,
      "COMMAND",
      "setAcOutput",
      JSON.stringify({ sn: req.params.sn, enabled: req.body.enabled }),
      null,
      false,
      message,
    );
    res.status(500).json({ error: message });
  }
});

// Control DC output
router.post("/:sn/dc-output", async (req: Request, res: Response) => {
  try {
    const { sn } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    const device = getDeviceBySn(sn) as { id: number } | undefined;
    const deviceId = device?.id || null;

    await ecoflowApi.setDcOutput(sn, enabled);

    insertLog(
      deviceId,
      "COMMAND",
      "setDcOutput",
      JSON.stringify({ sn, enabled }),
      JSON.stringify({ success: true }),
      true,
      null,
    );

    res.json({
      success: true,
      message: `DC output ${enabled ? "enabled" : "disabled"}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const device = getDeviceBySn(req.params.sn) as { id: number } | undefined;
    insertLog(
      device?.id || null,
      "COMMAND",
      "setDcOutput",
      JSON.stringify({ sn: req.params.sn, enabled: req.body.enabled }),
      null,
      false,
      message,
    );
    res.status(500).json({ error: message });
  }
});

// Set charge limits (both max and min together)
router.post("/:sn/charge-limit", async (req: Request, res: Response) => {
  try {
    const { sn } = req.params;
    const { maxSoc, minSoc } = req.body;

    if (typeof maxSoc !== "number" || typeof minSoc !== "number") {
      res.status(400).json({ error: "maxSoc and minSoc must be numbers" });
      return;
    }

    if (maxSoc < 50 || maxSoc > 100 || minSoc < 0 || minSoc > 30) {
      res
        .status(400)
        .json({ error: "maxSoc must be 50-100, minSoc must be 0-30" });
      return;
    }

    const device = getDeviceBySn(sn) as { id: number } | undefined;
    const deviceId = device?.id || null;

    await ecoflowApi.setChargeLimit(sn, maxSoc, minSoc);

    insertLog(
      deviceId,
      "COMMAND",
      "setChargeLimit",
      JSON.stringify({ sn, maxSoc, minSoc }),
      JSON.stringify({ success: true }),
      true,
      null,
    );

    res.json({
      success: true,
      message: `Charge limit set: ${minSoc}% - ${maxSoc}%`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const device = getDeviceBySn(req.params.sn) as { id: number } | undefined;
    insertLog(
      device?.id || null,
      "COMMAND",
      "setChargeLimit",
      JSON.stringify({ sn: req.params.sn, ...req.body }),
      null,
      false,
      message,
    );
    res.status(500).json({ error: message });
  }
});

// Set max charge SOC
router.post("/:sn/max-charge-soc", async (req: Request, res: Response) => {
  console.log("[Route] POST /max-charge-soc called", req.params, req.body);
  try {
    const { sn } = req.params;
    const { maxSoc } = req.body;

    if (typeof maxSoc !== "number") {
      res.status(400).json({ error: "maxSoc must be a number" });
      return;
    }

    if (maxSoc < 50 || maxSoc > 100) {
      res.status(400).json({ error: "maxSoc must be 50-100" });
      return;
    }

    const device = getDeviceBySn(sn) as { id: number } | undefined;
    const deviceId = device?.id || null;

    await ecoflowApi.setMaxChargeSoc(sn, maxSoc);

    insertLog(
      deviceId,
      "COMMAND",
      "setMaxChargeSoc",
      JSON.stringify({ sn, maxSoc }),
      JSON.stringify({ success: true }),
      true,
      null,
    );

    res.json({ success: true, message: `Max charge SOC set to ${maxSoc}%` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const device = getDeviceBySn(req.params.sn) as { id: number } | undefined;
    insertLog(
      device?.id || null,
      "COMMAND",
      "setMaxChargeSoc",
      JSON.stringify({ sn: req.params.sn, ...req.body }),
      null,
      false,
      message,
    );
    res.status(500).json({ error: message });
  }
});

// Set min discharge SOC
router.post("/:sn/min-discharge-soc", async (req: Request, res: Response) => {
  try {
    const { sn } = req.params;
    const { minSoc } = req.body;

    if (typeof minSoc !== "number") {
      res.status(400).json({ error: "minSoc must be a number" });
      return;
    }

    if (minSoc < 0 || minSoc > 30) {
      res.status(400).json({ error: "minSoc must be 0-30" });
      return;
    }

    const device = getDeviceBySn(sn) as { id: number } | undefined;
    const deviceId = device?.id || null;

    await ecoflowApi.setMinDischargeSoc(sn, minSoc);

    insertLog(
      deviceId,
      "COMMAND",
      "setMinDischargeSoc",
      JSON.stringify({ sn, minSoc }),
      JSON.stringify({ success: true }),
      true,
      null,
    );

    res.json({ success: true, message: `Min discharge SOC set to ${minSoc}%` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const device = getDeviceBySn(req.params.sn) as { id: number } | undefined;
    insertLog(
      device?.id || null,
      "COMMAND",
      "setMinDischargeSoc",
      JSON.stringify({ sn: req.params.sn, ...req.body }),
      null,
      false,
      message,
    );
    res.status(500).json({ error: message });
  }
});

// Set AC charging power
router.post("/:sn/charging-power", async (req: Request, res: Response) => {
  try {
    const { sn } = req.params;
    const { watts } = req.body;

    if (typeof watts !== "number") {
      res.status(400).json({ error: "watts must be a number" });
      return;
    }

    if (watts < 200 || watts > 2900) {
      res.status(400).json({ error: "watts must be 200-2900" });
      return;
    }

    const device = getDeviceBySn(sn) as { id: number } | undefined;
    const deviceId = device?.id || null;

    await ecoflowApi.setAcChargingPower(sn, watts);

    insertLog(
      deviceId,
      "COMMAND",
      "setAcChargingPower",
      JSON.stringify({ sn, watts }),
      JSON.stringify({ success: true }),
      true,
      null,
    );

    res.json({ success: true, message: `AC charging power set to ${watts}W` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const device = getDeviceBySn(req.params.sn) as { id: number } | undefined;
    insertLog(
      device?.id || null,
      "COMMAND",
      "setAcChargingPower",
      JSON.stringify({ sn: req.params.sn, ...req.body }),
      null,
      false,
      message,
    );
    res.status(500).json({ error: message });
  }
});

// Get device history for charts
type ChartPeriod = "10m" | "1h" | "24h" | "7d" | "30d";

function calculateTimeRange(period: ChartPeriod): {
  from: string;
  to: string;
  aggregation: AggregationType;
} {
  const now = new Date();
  const to = now.toISOString();
  let from: Date;
  let aggregation: AggregationType;

  switch (period) {
    case "10m":
      from = new Date(now.getTime() - 10 * 60 * 1000);
      aggregation = "none"; // ~600 points at 1/sec
      break;
    case "1h":
      from = new Date(now.getTime() - 60 * 60 * 1000);
      aggregation = "none"; // ~3600 points - shows every second
      break;
    case "24h":
      from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      aggregation = "1min"; // ~1440 points
      break;
    case "7d":
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      aggregation = "5min"; // ~2016 points
      break;
    case "30d":
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      aggregation = "15min"; // ~2880 points
      break;
    default:
      from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      aggregation = "1min";
  }

  return { from: from.toISOString(), to, aggregation };
}

router.get("/:sn/history", async (req: Request, res: Response) => {
  try {
    const { sn } = req.params;
    const { period = "24h", from: customFrom, to: customTo } = req.query as {
      period?: ChartPeriod;
      from?: string;
      to?: string;
    };

    const device = getDeviceBySn(sn) as { id: number } | undefined;

    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    let from: string;
    let to: string;
    let aggregation: AggregationType;

    if (period === "custom" && customFrom && customTo) {
      // Custom date range
      from = customFrom;
      to = customTo;
      // Calculate appropriate aggregation based on range duration
      const durationMs = new Date(customTo).getTime() - new Date(customFrom).getTime();
      const durationHours = durationMs / (1000 * 60 * 60);

      if (durationHours <= 1) {
        aggregation = "none";
      } else if (durationHours <= 24) {
        aggregation = "1min";
      } else if (durationHours <= 168) {
        // 7 days
        aggregation = "5min";
      } else {
        aggregation = "15min";
      }
    } else {
      // Preset period
      const timeRange = calculateTimeRange(period as ChartPeriod);
      from = timeRange.from;
      to = timeRange.to;
      aggregation = timeRange.aggregation;
    }

    const dataPoints = getDeviceHistory({
      deviceId: device.id,
      from,
      to,
      aggregation,
    });

    res.json({
      deviceSn: sn,
      period,
      from,
      to,
      aggregation,
      dataPoints,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// Get device error history
router.get("/:sn/errors", async (req: Request, res: Response) => {
  try {
    const { sn } = req.params;
    const { limit = "100" } = req.query as { limit?: string };

    const device = getDeviceBySn(sn) as { id: number } | undefined;

    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const errors = getErrorHistory(device.id, Number(limit));

    res.json({
      deviceSn: sn,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
