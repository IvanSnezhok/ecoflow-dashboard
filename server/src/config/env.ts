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
}
