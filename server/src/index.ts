import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'

import { config } from './config/env.js'
import { initDatabase, insertDeviceState, getDeviceBySn, upsertDevice, insertLog } from './db/database.js'
import { mqttService } from './services/mqttService.js'
import { ecoflowApi } from './services/ecoflowApi.js'
import devicesRouter from './routes/devices.js'
import logsRouter from './routes/logs.js'

const app = express()
const server = createServer(app)

// Initialize database
initDatabase()

// Middleware
app.use(helmet())
app.use(cors({ origin: config.server.corsOrigin }))
app.use(express.json())

// Rate limiting - increased to support 1 req/sec polling + chart requests
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 180, // 180 requests per minute (3/sec) - allows polling + charts
  message: { error: 'Too many requests, please try again later' },
})

const controlLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 control commands per minute
  message: { error: 'Too many control commands, please wait' },
})

// Apply rate limiters
app.use('/api', apiLimiter)
app.use('/api/devices/:sn/ac-output', controlLimiter)
app.use('/api/devices/:sn/dc-output', controlLimiter)
app.use('/api/devices/:sn/charge-limit', controlLimiter)

// Routes
app.use('/api/devices', devicesRouter)
app.use('/api/logs', logsRouter)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    mqtt: mqttService.isConnected() ? 'connected' : 'disconnected',
  })
})

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  console.log('WebSocket client connected')
  clients.add(ws)

  ws.on('close', () => {
    console.log('WebSocket client disconnected')
    clients.delete(ws)
  })

  ws.on('error', (error) => {
    console.error('WebSocket error:', error)
    clients.delete(ws)
  })

  // Send initial connection status
  ws.send(JSON.stringify({
    type: 'connection',
    data: { mqtt: mqttService.isConnected() },
  }))
})

// Forward MQTT messages to WebSocket clients
mqttService.on('message', (message) => {
  const wsMessage = JSON.stringify({
    type: 'deviceUpdate',
    data: message,
  })

  // Save to database
  const device = getDeviceBySn(message.sn) as { id: number } | undefined
  if (device && message.data) {
    const data = message.data as Record<string, number>
    insertDeviceState(device.id, {
      batterySoc: data.soc || 0,
      batteryWatts: (data.wattsInSum || 0) - (data.wattsOutSum || 0),
      acInputWatts: data.acInWatts || 0,
      solarInputWatts: data.pvInWatts || 0,
      acOutputWatts: data.acOutWatts || 0,
      dcOutputWatts: data.dcOutWatts || 0,
      temperature: data.temp || 0,
      rawData: JSON.stringify(message.data),
    })
  }

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(wsMessage)
    }
  })
})

mqttService.on('connected', () => {
  const wsMessage = JSON.stringify({
    type: 'mqttStatus',
    data: { connected: true },
  })
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(wsMessage)
    }
  })
  insertLog(null, 'CONNECTION', 'mqttConnect', null, null, true, null)
})

mqttService.on('disconnected', () => {
  const wsMessage = JSON.stringify({
    type: 'mqttStatus',
    data: { connected: false },
  })
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(wsMessage)
    }
  })
  insertLog(null, 'CONNECTION', 'mqttDisconnect', null, null, true, null)
})

mqttService.on('error', (error) => {
  insertLog(null, 'ERROR', 'mqttError', null, null, false, error.message)
})

// Start server
const PORT = config.server.port

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`)

  // Connect to MQTT
  try {
    await mqttService.connect()
    console.log('MQTT service started')
  } catch (error) {
    console.error('Failed to start MQTT service:', error)
    console.log('Server will continue without real-time updates')
  }

  // Background data collection every 5 seconds (independent of frontend polling)
  console.log('Starting background data collection...')
  setInterval(async () => {
    try {
      const devices = await ecoflowApi.getDeviceList()
      for (const device of devices) {
        if (device.online === 1) {
          try {
            const quota = await ecoflowApi.getDeviceQuota(device.sn)
            const q = quota as Record<string, unknown>

            const deviceId = upsertDevice(
              device.sn,
              device.productName,
              device.deviceName,
              true
            )

            insertDeviceState(deviceId, {
              batterySoc: (q['pd.soc'] as number) || (q['bmsMaster.soc'] as number) || 0,
              batteryWatts: ((q['pd.wattsInSum'] as number) || 0) - ((q['pd.wattsOutSum'] as number) || 0),
              acInputWatts: (q['inv.inputWatts'] as number) || 0,
              solarInputWatts: (q['mppt.inWatts'] as number) || 0,
              acOutputWatts: (q['inv.outputWatts'] as number) || 0,
              dcOutputWatts: (q['mppt.outWatts'] as number) || (q['pd.carWatts'] as number) || 0,
              temperature: (q['inv.outTemp'] as number) || (q['bmsMaster.temp'] as number) || 0,
              rawData: JSON.stringify(quota),
            })
          } catch (err) {
            // Quota fetch failed - device might be temporarily unreachable
          }
        }
      }
    } catch (error) {
      console.error('Background collection error:', error)
    }
  }, 5000) // Every 5 seconds
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...')
  mqttService.disconnect()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...')
  mqttService.disconnect()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})
