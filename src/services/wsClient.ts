import { useDeviceStore } from '@/stores/deviceStore'
import type { DeviceState } from '@/types/device'

export interface LiveStatus {
  /** The panel's socket to its server */
  wsConnected: boolean
  /** The server's link to the EcoFlow MQTT broker */
  mqttConnected: boolean
  /** The socket was open and dropped (false while the first one connects) */
  lost: boolean
}

/**
 * MQTT pushes arrive several times a second; the panel applies them at most this often,
 * in one store update for all devices, so the page re-renders once instead of per push.
 */
const LIVE_UPDATE_INTERVAL_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30_000

class WebSocketClient {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private reconnectDelay = 3000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Set by disconnect() (sign-out): a closed socket then stays closed */
  private stopped = false
  private liveUpdates = new Map<string, Partial<DeviceState>>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private status: LiveStatus = { wsConnected: false, mqttConnected: false, lost: false }
  private statusListeners = new Set<() => void>()

  connect(): void {
    this.stopped = false
    this.open()
  }

  private open(): void {
    // Also skip while a socket is still connecting: several components share this client
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    const port = import.meta.env.DEV ? '3001' : window.location.port
    const url = `${protocol}//${host}:${port}/ws`

    const socket = new WebSocket(url)
    this.ws = socket

    socket.onopen = () => {
      this.reconnectAttempts = 0
      this.setStatus({ wsConnected: true, lost: false })
    }

    socket.onclose = () => {
      // A socket closed by sign-out may report after the next one has opened
      if (this.ws !== socket) return
      this.setStatus({ wsConnected: false, mqttConnected: false, lost: true })
      this.scheduleReconnect()
    }

    socket.onmessage = (event) => {
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
        this.setStatus({ mqttConnected: (message.data as { connected: boolean }).connected })
        break
      case 'connection':
        this.setStatus({ mqttConnected: (message.data as { mqtt: boolean }).mqtt })
        break
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

    this.liveUpdates.set(update.sn, { ...this.liveUpdates.get(update.sn), ...changed })
    this.flushTimer ??= setTimeout(() => this.flushLiveUpdates(), LIVE_UPDATE_INTERVAL_MS)
  }

  private flushLiveUpdates(): void {
    this.flushTimer = null
    if (this.liveUpdates.size === 0) return
    const updates = this.liveUpdates
    this.liveUpdates = new Map()
    // The store holds back fields with a command in flight
    useDeviceStore.getState().applyLiveUpdates(updates)
  }

  // Keeps trying while the panel is open (a server restart can take a while)
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), MAX_RECONNECT_DELAY_MS)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  disconnect(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.liveUpdates.clear()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus({ wsConnected: false, mqttConnected: false, lost: false })
  }

  getStatus = (): LiveStatus => this.status

  /** For useSyncExternalStore: every component reads the same status */
  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private setStatus(next: Partial<LiveStatus>): void {
    const status = { ...this.status, ...next }
    if ((Object.keys(status) as (keyof LiveStatus)[]).every((key) => status[key] === this.status[key])) return
    this.status = status
    this.statusListeners.forEach((listener) => listener())
  }
}

export const wsClient = new WebSocketClient()
