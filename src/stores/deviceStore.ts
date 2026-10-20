import { create } from 'zustand'
import type { DeviceWithState, DeviceState } from '@/types/device'

interface PendingCommand {
  field: string
  value: unknown
  expiresAt: number
}

const PENDING_COMMAND_TTL = 10000 // 10 seconds

interface DeviceStore {
  devices: DeviceWithState[]
  pendingCommands: Record<string, PendingCommand[]>
  isLoading: boolean
  error: string | null
  setDevices: (devices: DeviceWithState[]) => void
  updateDeviceState: (serialNumber: string, state: Partial<DeviceState>) => void
  /** Live MQTT fields per device (wsClient), applied in one update */
  applyLiveUpdates: (updates: Map<string, Partial<DeviceState>>) => void
  /** A device list poll: metadata and state, in one update */
  mergeDevicesFromServer: (devices: DeviceWithState[]) => void
  setPendingCommand: (serialNumber: string, field: string, value: unknown) => void
  removePendingCommand: (serialNumber: string, field: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

/**
 * Takes the server's values except for a field whose command is still in flight: that
 * one keeps its optimistic value until the server reports the commanded value.
 */
function acceptServerFields(incoming: Partial<DeviceState>, pending: PendingCommand[] | undefined, now: number) {
  const active = (pending ?? []).filter((cmd) => cmd.expiresAt > now)
  const accepted: Record<string, unknown> = {}
  const confirmed = new Set<string>()
  for (const [key, value] of Object.entries(incoming)) {
    const cmd = active.find((c) => c.field === key)
    if (!cmd || cmd.value === value) {
      accepted[key] = value
      if (cmd) confirmed.add(key)
    }
  }
  return {
    accepted: accepted as Partial<DeviceState>,
    remaining: active.filter((cmd) => !confirmed.has(cmd.field)),
  }
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  devices: [],
  pendingCommands: {},
  isLoading: false,
  error: null,

  setDevices: (devices) => set({ devices, isLoading: false, error: null }),

  // Direct state update (for optimistic updates from user actions)
  updateDeviceState: (serialNumber, newState) =>
    set((state) => ({
      devices: state.devices.map((device) =>
        device.serialNumber === serialNumber
          ? {
              ...device,
              state: device.state
                ? { ...device.state, ...newState }
                : null,
            }
          : device
      ),
    })),

  applyLiveUpdates: (updates) =>
    set((store) => {
      const now = Date.now()
      const pendingCommands = { ...store.pendingCommands }
      let changed = false
      const devices = store.devices.map((device) => {
        const update = updates.get(device.serialNumber)
        if (!update || !device.state) return device
        const { accepted, remaining } = acceptServerFields(update, pendingCommands[device.serialNumber], now)
        pendingCommands[device.serialNumber] = remaining
        const current = device.state as unknown as Record<string, unknown>
        // A push repeating the values on screen is not worth a re-render
        if (Object.entries(accepted).every(([key, value]) => current[key] === value)) return device
        changed = true
        return { ...device, state: { ...device.state, ...accepted, timestamp: new Date(now).toISOString() } }
      })
      return changed ? { devices, pendingCommands } : { pendingCommands }
    }),

  mergeDevicesFromServer: (serverDevices) =>
    set((store) => {
      const now = Date.now()
      const pendingCommands = { ...store.pendingCommands }
      const devices = serverDevices.map((serverDevice) => {
        const sn = serverDevice.serialNumber
        const existing = store.devices.find((device) => device.serialNumber === sn)
        if (!serverDevice.state) {
          pendingCommands[sn] = []
          return serverDevice
        }
        const { remaining } = acceptServerFields(serverDevice.state, pendingCommands[sn], now)
        pendingCommands[sn] = remaining
        // A field still waiting for its command keeps the optimistic value on screen
        const state: Record<string, unknown> = { ...serverDevice.state }
        const shown = existing?.state as unknown as Record<string, unknown> | null | undefined
        for (const cmd of remaining) {
          if (shown && cmd.field in shown) state[cmd.field] = shown[cmd.field]
        }
        return { ...serverDevice, state: state as unknown as DeviceState }
      })
      return { devices, pendingCommands, isLoading: false, error: null }
    }),

  setPendingCommand: (serialNumber, field, value) =>
    set((state) => {
      const existing = state.pendingCommands[serialNumber] || []
      // Remove any existing pending for this field
      const filtered = existing.filter(cmd => cmd.field !== field)
      return {
        pendingCommands: {
          ...state.pendingCommands,
          [serialNumber]: [
            ...filtered,
            { field, value, expiresAt: Date.now() + PENDING_COMMAND_TTL },
          ],
        },
      }
    }),

  removePendingCommand: (serialNumber, field) =>
    set((state) => {
      const existing = state.pendingCommands[serialNumber] || []
      return {
        pendingCommands: {
          ...state.pendingCommands,
          [serialNumber]: existing.filter(cmd => cmd.field !== field),
        },
      }
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),
}))
