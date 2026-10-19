import { useDeviceStore } from '@/stores/deviceStore'
import type { DeviceState } from '@/types/device'

type MessageHandler = (data: unknown) => void

class WebSocketClient {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 3000
  private handlers: Map<string, Set<MessageHandler>> = new Map()

  connect(): void {
    // Also skip while a socket is still connecting: several components share this client
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    const port = import.meta.env.DEV ? '3001' : window.location.port
    const url = `${protocol}//${host}:${port}/ws`

    console.log(`Connecting to WebSocket: ${url}`)
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('WebSocket connected')
      this.reconnectAttempts = 0
      this.emit('connected', null)
    }

    this.ws.onclose = () => {
      console.log('WebSocket disconnected')
      this.emit('disconnected', null)
      this.scheduleReconnect()
    }

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      this.emit('error', error)
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        this.handleMessage(message)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }
  }

  private handleMessage(message: { type: string; data: unknown }): void {
    switch (message.type) {
      case 'deviceUpdate':
        this.handleDeviceUpdate(message.data)
        break
      case 'mqttStatus':
        this.emit('mqttStatus', message.data)
        break
      case 'connection':
        this.emit('connection', message.data)
        break
      default:
        console.log('Unknown message type:', message.type)
    }
  }

  private handleDeviceUpdate(data: unknown): void {
    const update = data as {
      sn: string
      data: Record<string, unknown>
    }

    if (!update.sn || !update.data) return

    // MQTT pushes only the keys that changed (usually inside `params`); apply just
    // those, so a partial message never resets SOC or power to 0
    // A get_reply (full snapshot) nests the values under data, or data.quotaMap
    const reply = update.data.data as Record<string, unknown> | undefined
    const raw = (update.data.params ?? reply?.quotaMap ?? reply ?? update.data) as Record<string, unknown>
    const num = (...keys: string[]) => {
      for (const key of keys) {
        const value = raw[key]
        if (typeof value === 'number' && Number.isFinite(value)) return value
      }
      return undefined
    }
    const soc = num('pd.soc', 'bmsMaster.soc', 'soc')
    const wattsIn = num('pd.wattsInSum', 'wattsInSum')
    const wattsOut = num('pd.wattsOutSum', 'wattsOutSum')
    const fields: Partial<DeviceState> = {
      batterySoc: soc !== undefined && soc > 0 ? soc : undefined,
      batteryWatts: wattsIn !== undefined && wattsOut !== undefined ? wattsIn - wattsOut : undefined,
      acInputWatts: num('inv.inputWatts', 'acInWatts'),
      solarInputWatts: num('mppt.inWatts', 'pvInWatts'),
      acOutputWatts: num('inv.outputWatts', 'acOutWatts'),
      dcOutputWatts: num('mppt.outWatts', 'dcOutWatts'),
      temperature: num('inv.outTemp', 'bmsMaster.temp', 'temp'),
    }
    const changed = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined)
    ) as Partial<DeviceState>
    if (Object.keys(changed).length === 0) return

    // Use updateDeviceStateFromServer to respect pending commands
    useDeviceStore.getState().updateDeviceStateFromServer(update.sn, {
      ...changed,
      timestamp: new Date().toISOString(),
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1)

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    setTimeout(() => this.connect(), delay)
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  on(event: string, handler: MessageHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
  }

  off(event: string, handler: MessageHandler): void {
    this.handlers.get(event)?.delete(handler)
  }

  private emit(event: string, data: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(data))
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

export const wsClient = new WebSocketClient()
