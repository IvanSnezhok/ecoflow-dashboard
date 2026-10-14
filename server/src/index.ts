import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { config } from "./config/env.js";
import {
  initDatabase,
  insertDeviceState,
  getDeviceBySn,
  upsertDevice,
  insertLog,
  cleanupOldData,
  cleanupAutomationLogs,
  recordConnectionState,
} from "./db/database.js";
import { mqttService } from "./services/mqttService.js";
import { ecoflowApi } from "./services/ecoflowApi.js";
import { bleBridge } from "./services/bleBridge.js";
import { getDeviceProfile } from "./services/deviceProfiles.js";
import { buildStateSample, isUsefulSample } from "./services/stateSample.js";
import { processDeviceAutomation, buildDeviceMetrics } from "./services/automationEngine.js";
import devicesRouter from "./routes/devices.js";
import logsRouter from "./routes/logs.js";
import { automationRouter } from "./routes/automation.js";
import systemRouter from "./routes/systemRoutes.js";
import { resilienceRouter } from "./routes/resilience.js";
import { processResilienceAutomation } from "./services/resilienceService.js";

const app = express();
const server = createServer(app);

// Initialize database
initDatabase();

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'", "https:", "data:"],
      },
    },
  })
);
app.use(cors({ origin: config.server.corsOrigin }));
app.use(express.json());

// Log all requests
app.use((req, _res, next) => {
  console.log(`[Express] ${req.method} ${req.path}`, req.body || "");
  next();
});

// Rate limiting - increased to support 1 req/sec polling + chart requests
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 180, // 180 requests per minute (3/sec) - allows polling + charts
  message: { error: "Too many requests, please try again later" },
});

const controlLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 control commands per minute
  message: { error: "Too many control commands, please wait" },
});

// Apply rate limiters
app.use("/api", apiLimiter);
app.use("/api/devices/:sn/ac-output", controlLimiter);
app.use("/api/devices/:sn/dc-output", controlLimiter);
app.use("/api/devices/:sn/charge-limit", controlLimiter);

// Routes
app.use("/api/devices", devicesRouter);
app.use("/api/logs", logsRouter);
app.use("/api/automation", automationRouter);
app.use("/api/system", systemRouter);
app.use("/api/resilience", resilienceRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    mqtt: mqttService.isConnected() ? "connected" : "disconnected",
  });
});

// Serve static files from the frontend build
const frontendDistPath = path.join(__dirname, "../../dist");
app.use(express.static(frontendDistPath));

// Serve index.html for all non-API routes (SPA support)
app.get("*", (req, res) => {
  // Don't serve index.html for API routes or WebSocket
  if (!req.path.startsWith("/api") && !req.path.startsWith("/ws")) {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  }
});

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set<WebSocket>();
let backgroundCollectionInProgress = false;

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");
  clients.add(ws);

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
    clients.delete(ws);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    clients.delete(ws);
  });

  // Send initial connection status
  ws.send(
    JSON.stringify({
      type: "connection",
      data: { mqtt: mqttService.isConnected() },
    }),
  );
});

// Forward MQTT messages to WebSocket clients
mqttService.on("message", (message) => {
  const wsMessage = JSON.stringify({
    type: "deviceUpdate",
    data: message,
  });

  // Save to database. MQTT pushes only the keys that changed (usually wrapped in
  // `params`), so a message without SOC/power must not become a row of zeros.
  const device = getDeviceBySn(message.sn) as { id: number } | undefined;
  if (device && message.data) {
    const raw = message.data as Record<string, unknown>;
    const params = (raw.params && typeof raw.params === "object" ? raw.params : raw) as Record<string, unknown>;
    const sample = buildStateSample(params);
    if (sample.batterySoc !== null) {
      insertDeviceState(device.id, { ...sample, rawData: JSON.stringify(params) });
    }
  }

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(wsMessage);
    }
  });
});

mqttService.on("connected", () => {
  const wsMessage = JSON.stringify({
    type: "mqttStatus",
    data: { connected: true },
  });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(wsMessage);
    }
  });
  insertLog(null, "CONNECTION", "mqttConnect", null, null, true, null);
});

mqttService.on("disconnected", () => {
  const wsMessage = JSON.stringify({
    type: "mqttStatus",
    data: { connected: false },
  });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(wsMessage);
    }
  });
  insertLog(null, "CONNECTION", "mqttDisconnect", null, null, true, null);
});

mqttService.on("error", (error) => {
  insertLog(null, "ERROR", "mqttError", null, null, false, error.message);
});

// Start server
const PORT = config.server.port;

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);

  // Connect to MQTT
  try {
    await mqttService.connect();
    console.log("MQTT service started");
  } catch (error) {
    console.error("Failed to start MQTT service:", error);
    console.log("Server will continue without real-time updates");
  }

  // Retention is enforced server-side; the UI must not be the cleanup scheduler.
  // DASHBOARD_RETENTION_DAYS=0 (the default) keeps the full history untouched.
  if (config.retention.days > 0) {
    const pruneOldData = () => {
      cleanupOldData(config.retention.days);
      cleanupAutomationLogs(config.retention.days);
    };
    pruneOldData();
    setInterval(pruneOldData, 24 * 60 * 60 * 1000);
  } else {
    console.log("Data retention pruning disabled (DASHBOARD_RETENTION_DAYS=0)");
  }

  // Direct Bluetooth channel through the ble-bridge container, when configured
  bleBridge.start();

  // Background data collection every 10 seconds (independent of frontend polling)
  console.log("Starting background data collection...");
  setInterval(async () => {
    if (backgroundCollectionInProgress) return;
    backgroundCollectionInProgress = true;
    try {
      const devices = await ecoflowApi.getDeviceList();
      for (const device of devices) {
        // Track how long the Wi-Fi/cloud connection holds. Devices first appear in the
        // database through the /devices route, so unknown ones are picked up later.
        const known = getDeviceBySn(device.sn) as { id: number } | undefined;
        // The cloud's own flag: `online` is also true while BLE alone carries the data.
        if (known) recordConnectionState(known.id, (device.cloudOnline ?? device.online) === 1);

        if (device.online === 1) {
          try {
            const quota = await ecoflowApi.getDeviceQuota(device.sn);
            const q = quota as Record<string, unknown>;
            // Passing the quota also rejects partial payloads (no bmsMaster.soc /
            // inv.outputWatts): those were stored as SOC 0 and drew false dips on the
            // battery chart, and could trip SOC-based automation rules.
            const profile = getDeviceProfile(device.productName, q);
            // Do not record invented portable-power-station metrics or run power
            // automation for products that have no verified profile yet.
            if (profile.id === "unclassified-read-only") continue;

            const deviceId = upsertDevice(
              device.sn,
              device.productName,
              device.deviceName,
              true,
            );

            // Same sample builder as the /devices route, so whichever path wins the
            // 10 s slot writes voltage and extra-battery columns too.
            const sample = buildStateSample(q);
            if (isUsefulSample(sample)) {
              insertDeviceState(deviceId, { ...sample, rawData: JSON.stringify(quota) });
            }

            // Process automation rules for this device
            try {
              const metrics = buildDeviceMetrics(
                deviceId,
                device.sn,
                device.online === 1,
                q,
              );
              await processDeviceAutomation(metrics);
              await processResilienceAutomation(metrics, q);
            } catch (automationErr) {
              console.error(
                `Automation error for ${device.sn}:`,
                automationErr,
              );
            }
          } catch (err) {
            // Quota fetch failed - device might be temporarily unreachable
          }
        }
      }
    } catch (error) {
      console.error("Background collection error:", error);
    } finally {
      backgroundCollectionInProgress = false;
    }
  }, 10_000); // One durable sample per device every 10 seconds
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  mqttService.disconnect();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  mqttService.disconnect();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
