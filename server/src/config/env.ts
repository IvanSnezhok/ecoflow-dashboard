import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

export const config = {
  ecoflow: {
    accessKey: requireEnv('ECOFLOW_ACCESS_KEY'),
    secretKey: requireEnv('ECOFLOW_SECRET_KEY'),
    apiEndpoint: process.env.ECOFLOW_API_ENDPOINT || 'https://api-e.ecoflow.com',
    mqttBroker: process.env.ECOFLOW_MQTT_BROKER || 'mqtt-e.ecoflow.com',
  },
  // EcoFlow app channel (services/appChannel.ts). Optional: with these set the panel signs
  // in by itself and again whenever the token expires; the Settings login works without.
  app: {
    email: process.env.ECOFLOW_APP_EMAIL || '',
    password: process.env.ECOFLOW_APP_PASSWORD || '',
    region: process.env.ECOFLOW_APP_REGION || '',
    // {region} is replaced; override only to test against a local mock
    apiBase: process.env.ECOFLOW_APP_API_BASE || 'https://{region}.ecoflow.com',
  },
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
  updates: {
    enabled: process.env.DASHBOARD_UPDATES_ENABLED === 'true',
    branch: process.env.DASHBOARD_UPDATE_BRANCH || 'main',
    systemdService: process.env.DASHBOARD_SYSTEMD_SERVICE || '',
    // 'git'        — the server runs straight from a git worktree and updates itself.
    // 'host-agent' — the server runs in a container; it drops a request file into the
    //                shared data volume and a host-side systemd unit does the work.
    mode: process.env.DASHBOARD_UPDATE_MODE === 'host-agent' ? 'host-agent' : 'git',
  },
  retention: {
    // 0 disables pruning entirely and keeps the full history.
    days: parseInt(process.env.DASHBOARD_RETENTION_DAYS || '0', 10),
  },
}
