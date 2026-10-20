import type { DeviceState, DeviceWithState } from '@/types/device'

export type PowerStatus = 'charging' | 'discharging' | 'bypass' | 'standby'

/**
 * What the battery is doing. AC input feeding the AC output while the battery rests is
 * bypass: a few watts either way are conversion losses in the station's in/out sums,
 * not charging.
 */
export function powerStatus(state: DeviceState): PowerStatus {
  if (state.acInputWatts > 0 && state.acOutputWatts > 0 && Math.abs(state.batteryWatts) <= 30) return 'bypass'
  if (state.batteryWatts > 0) return 'charging'
  if (state.batteryWatts < 0) return 'discharging'
  return 'standby'
}

export const POWER_STATUS: Record<PowerStatus, { label: string; text: string; badge: string }> = {
  charging: { label: 'Charging', text: 'text-energy-green', badge: 'bg-energy-green/10 text-energy-green' },
  discharging: { label: 'Discharging', text: 'text-energy-blue', badge: 'bg-energy-blue/10 text-energy-blue' },
  bypass: { label: 'Bypass', text: 'text-energy-purple', badge: 'bg-energy-purple/10 text-energy-purple' },
  standby: { label: 'Standby', text: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' },
}

export function formatMinutes(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}

/** "1h 20m to full" while charging, "5h left" while discharging, else null */
export function remainingTime(state: DeviceState, status: PowerStatus): string | null {
  if (status === 'charging' && state.chgRemainTime && state.chgRemainTime > 0) return `${formatMinutes(state.chgRemainTime)} to full`
  if (status === 'discharging' && state.dsgRemainTime && state.dsgRemainTime > 0) return `${formatMinutes(state.dsgRemainTime)} left`
  return null
}

export const socTextColor = (soc: number) =>
  soc <= 20 ? 'text-energy-red' : soc <= 40 ? 'text-energy-yellow' : 'text-energy-green'

export const socBgColor = (soc: number) =>
  soc <= 20 ? 'bg-energy-red' : soc <= 40 ? 'bg-energy-yellow' : 'bg-energy-green'

/** Data that reaches the panel other than the cloud REST quota, shown as a chip */
export function dataSourceChip(device: DeviceWithState): { label: string; title: string } | null {
  if (!device.online) return null
  switch (device.dataSource) {
    case 'ble':
    case 'cloud+ble':
      return device.cloudOnline
        ? { label: 'BLE', title: 'Live data over Bluetooth; cloud connected too' }
        : { label: 'BLE only', title: 'Cloud unreachable; live data over Bluetooth' }
    // The cloud refuses this device's REST quota (e.g. a shared device)
    case 'mqtt':
      return { label: 'MQTT', title: "EcoFlow refuses this device's REST quota; live data from its MQTT push" }
    case 'app':
      return { label: 'APP', title: "EcoFlow refuses this device's REST quota; live data through the EcoFlow app channel (Settings)" }
    default:
      return null
  }
}
