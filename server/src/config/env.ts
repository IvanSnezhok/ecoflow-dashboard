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
