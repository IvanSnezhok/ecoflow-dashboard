import { create } from 'zustand'
import type { DeviceWithState, DeviceState } from '@/types/device'

interface DeviceStore {
  devices: DeviceWithState[]
  isLoading: boolean
  error: string | null
  setDevices: (devices: DeviceWithState[]) => void
  updateDeviceState: (serialNumber: string, state: Partial<DeviceState>) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  devices: [],
  isLoading: false,
  error: null,

  setDevices: (devices) => set({ devices, isLoading: false, error: null }),

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

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),
}))
