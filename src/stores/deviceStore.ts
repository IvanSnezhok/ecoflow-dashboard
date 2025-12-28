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
  updateDeviceStateFromServer: (serialNumber: string, state: Partial<DeviceState>) => void
  updateDeviceFromServer: (device: DeviceWithState) => void
  setPendingCommand: (serialNumber: string, field: string, value: unknown) => void
  removePendingCommand: (serialNumber: string, field: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
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

  // State update from server (respects pending commands)
  updateDeviceStateFromServer: (serialNumber, newState) => {
    const { pendingCommands } = get()
    const devicePending = pendingCommands[serialNumber] || []
    const now = Date.now()

    // Filter out expired pending commands
    const activePending = devicePending.filter(cmd => cmd.expiresAt > now)

    // Build filtered state that respects pending commands
    const filteredState: Record<string, unknown> = {}
    const confirmedFields: string[] = []

    for (const [key, value] of Object.entries(newState)) {
      const pendingCmd = activePending.find(cmd => cmd.field === key)

      if (pendingCmd) {
        // Check if server value matches pending value (command confirmed)
        if (pendingCmd.value === value) {
          confirmedFields.push(key)
          filteredState[key] = value
        }
        // Otherwise skip this field (keep optimistic value)
      } else {
        // No pending command for this field, accept server value
        filteredState[key] = value
      }
    }

    // Update pending commands (remove confirmed ones)
    const remainingPending = activePending.filter(
      cmd => !confirmedFields.includes(cmd.field)
    )

    set((state) => ({
      devices: state.devices.map((device) =>
        device.serialNumber === serialNumber
          ? {
              ...device,
              state: device.state
                ? { ...device.state, ...filteredState } as DeviceState
                : null,
            }
          : device
      ),
      pendingCommands: {
        ...state.pendingCommands,
        [serialNumber]: remainingPending,
      },
    }))
  },

  // Update device from server (metadata + state respecting pending commands)
  updateDeviceFromServer: (serverDevice) => {
    const { pendingCommands } = get()
    const devicePending = pendingCommands[serverDevice.serialNumber] || []
    const now = Date.now()

    // Filter out expired pending commands
    const activePending = devicePending.filter(cmd => cmd.expiresAt > now)

    // Build filtered state that respects pending commands
    let filteredState: DeviceState | null = null
    const confirmedFields: string[] = []

    if (serverDevice.state) {
      const stateObj: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(serverDevice.state)) {
        const pendingCmd = activePending.find(cmd => cmd.field === key)
        if (pendingCmd) {
          if (pendingCmd.value === value) {
            confirmedFields.push(key)
            stateObj[key] = value
          }
          // Otherwise skip (keep optimistic value from existing state)
        } else {
          stateObj[key] = value
        }
      }
      filteredState = stateObj as unknown as DeviceState
    }

    // Update pending commands (remove confirmed ones)
    const remainingPending = activePending.filter(
      cmd => !confirmedFields.includes(cmd.field)
    )

    set((state) => ({
      devices: state.devices.map((device) =>
        device.serialNumber === serverDevice.serialNumber
          ? {
              ...serverDevice,
              // Merge filtered state with existing state to preserve pending fields
              state: device.state && filteredState
                ? { ...device.state, ...filteredState }
                : filteredState,
            }
          : device
      ),
      pendingCommands: {
        ...state.pendingCommands,
        [serverDevice.serialNumber]: remainingPending,
      },
    }))
  },

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
