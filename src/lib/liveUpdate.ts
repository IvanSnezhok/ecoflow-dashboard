// Reading a live MQTT message, with no browser dependency: the panel's socket client
// (services/wsClient.ts) and the phone app (mobile/) both use it.
import type { DeviceState } from '@/types/device'

/** The state fields one `deviceUpdate` message carries; empty when it has none of them. */
export function liveFieldsOf(message: Record<string, unknown>): Partial<DeviceState> {
  // MQTT pushes only the keys that changed (usually inside `params`); apply just
  // those, so a partial message never resets SOC or power to 0
  // A get_reply (full snapshot) nests the values under data, or data.quotaMap
  const reply = message.data as Record<string, unknown> | undefined
  const raw = (message.params ?? reply?.quotaMap ?? reply ?? message) as Record<string, unknown>
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
  if (fields.acInputWatts !== undefined) fields.acInputReported = true
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Partial<DeviceState>
}
