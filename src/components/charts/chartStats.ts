import type { HistoryDataPoint } from '@/types/device'

export type PowerKey = 'acInputWatts' | 'solarInputWatts' | 'acOutputWatts' | 'dcOutputWatts'

export interface PowerSummary {
  /** Most recent non-empty total, W */
  current: number | null
  peak: number
  average: number
  /** Energy over the visible range, Wh */
  energyWh: number
}

// Longest interval a sample is assumed to represent when integrating energy;
// beyond this the data has a gap and counts for nothing.
const MAX_INTEGRATION_STEP_MS = 30 * 60_000

function totalOf(point: HistoryDataPoint, keys: PowerKey[]): number | null {
  let total = 0
  let seen = false
  for (const key of keys) {
    const value = point[key]
    if (value !== null && value !== undefined) {
      total += value
      seen = true
    }
  }
  return seen ? total : null
}

export function summarizePower(data: HistoryDataPoint[], keys: PowerKey[]): PowerSummary {
  let peak = 0
  let sum = 0
  let count = 0
  let energyWh = 0
  let current: number | null = null

  for (let i = 0; i < data.length; i++) {
    const total = totalOf(data[i], keys)
    if (total === null) continue
    current = total
    peak = Math.max(peak, total)
    sum += total
    count++

    const next = data[i + 1]
    if (next) {
      const stepMs = new Date(next.timestamp).getTime() - new Date(data[i].timestamp).getTime()
      if (stepMs > 0 && stepMs <= MAX_INTEGRATION_STEP_MS) energyWh += total * (stepMs / 3_600_000)
    }
  }

  return { current, peak, average: count > 0 ? Math.round(sum / count) : 0, energyWh }
}

export function formatWatts(watts: number): string {
  return Math.abs(watts) >= 1000 ? `${(watts / 1000).toFixed(watts >= 10_000 ? 0 : 1)}kW` : `${Math.round(watts)}W`
}

export function formatEnergy(wh: number): string {
  return wh >= 1000 ? `${(wh / 1000).toFixed(wh >= 10_000 ? 0 : 1)} kWh` : `${Math.round(wh)} Wh`
}
