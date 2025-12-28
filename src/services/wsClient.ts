import { useDeviceStore } from '@/stores/deviceStore'

type MessageHandler = (data: unknown) => void

class WebSocketClient {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 3000
  private handlers: Map<string, Set<MessageHandler>> = new Map()

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
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
      data: Record<string, number>
    }

    if (!update.sn || !update.data) return

    const deviceStore = useDeviceStore.getState()
    // Use updateDeviceStateFromServer to respect pending commands
    deviceStore.updateDeviceStateFromServer(update.sn, {
      batterySoc: update.data.soc || 0,
      batteryWatts: (update.data.wattsInSum || 0) - (update.data.wattsOutSum || 0),
      acInputWatts: update.data.acInWatts || 0,
      solarInputWatts: update.data.pvInWatts || 0,
      acOutputWatts: update.data.acOutWatts || 0,
      dcOutputWatts: update.data.dcOutWatts || 0,
      temperature: update.data.temp || 0,
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
