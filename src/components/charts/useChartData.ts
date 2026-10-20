import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ChartPeriod, DateRange, HistoryDataPoint } from '@/types/device'

interface UseChartDataResult {
  data: HistoryDataPoint[]
  isLoading: boolean
  isFetching: boolean
  error: string | null
  /** Epoch ms of the last successful fetch (0 before the first one) */
  updatedAt: number
  refetch: () => void
}

type MetricKey = Exclude<keyof HistoryDataPoint, 'timestamp'>

const METRIC_KEYS: MetricKey[] = [
  'batterySoc', 'batteryWatts', 'acInputWatts', 'solarInputWatts', 'acOutputWatts',
  'dcOutputWatts', 'temperature', 'bmsMasterVol', 'extraBattery1Soc', 'extraBattery1Temp',
  'extraBattery1Vol', 'extraBattery2Soc', 'extraBattery2Temp', 'extraBattery2Vol',
]
const SOC_KEYS: MetricKey[] = ['batterySoc', 'extraBattery1Soc', 'extraBattery2Soc']

/**
 * How often an open chart re-reads history. The backend stores one sample per
 * device every 10 s, so short windows refresh often and long ones (where a new
 * bucket appears every 5-15 min) refresh rarely.
 */
function getRefetchIntervalMs(period: ChartPeriod, customRange?: DateRange | null): number | false {
  switch (period) {
    case '10m':
    case '1h':
      return 10_000
    case '24h':
      return 30_000
    case '7d':
    case '30d':
      return 60_000
    case 'custom':
      // A custom range that ends in the past never changes
      if (!customRange) return false
      return Date.now() - new Date(customRange.to).getTime() < 5 * 60_000 ? 60_000 : false
    default:
      return false
  }
}

/**
 * Distance between points after which the line is broken instead of drawn across.
 * Raw samples nominally come every 10 s but the two writers (background collector
 * and /devices route) share one slot, so 20-30 s spacing is normal, not a gap.
 */
function getGapThresholdMs(aggregation: string): number {
  switch (aggregation) {
    case 'none':
      return 2 * 60_000
    case '1min':
      return 5 * 60_000
    case '5min':
      return 20 * 60_000
    case '15min':
      return 60 * 60_000
    case '1hour':
      return 3 * 60 * 60_000
    case '6hour':
      return 18 * 60 * 60_000
    default:
      return 5 * 60_000
  }
}

/**
 * SQLite returns UTC timestamps without a zone ("2026-01-01 10:00:00" or
 * "2026-01-01T10:00:00"). `new Date()` reads those as *local* time, which shifted
 * every chart by the browser's UTC offset (3 h in Kyiv) and made the newest data
 * look hours old. Mark them as UTC explicitly.
 */
export function parseServerTimestamp(timestamp: string): number {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(timestamp)) return new Date(timestamp).getTime()
  return new Date(`${timestamp.replace(' ', 'T')}Z`).getTime()
}

function createEmptyDataPoint(timeMs: number): HistoryDataPoint {
  const point = { timestamp: new Date(timeMs).toISOString() } as HistoryDataPoint
  for (const key of METRIC_KEYS) point[key] = null
  return point
}

/**
 * Removes single-sample SOC glitches (e.g. 80 → 3 → 80) that are physically
 * impossible: SOC cannot jump that far and immediately return. Real drops persist
 * across neighbouring samples and are kept.
 */
function removeSocSpikes(points: HistoryDataPoint[]): void {
  const MAX_JUMP = 15
  for (const key of SOC_KEYS) {
    for (let i = 1; i < points.length - 1; i++) {
      const value = points[i][key]
      if (value === null) continue
      let prev: number | null = null
      for (let j = i - 1; j >= 0 && prev === null; j--) prev = points[j][key]
      let next: number | null = null
      for (let j = i + 1; j < points.length && next === null; j++) next = points[j][key]
      if (prev === null || next === null) continue
      if (Math.abs(prev - next) <= MAX_JUMP / 3 && Math.abs(value - prev) > MAX_JUMP && Math.abs(value - next) > MAX_JUMP) {
        points[i][key] = null
      }
    }
  }
}

/**
 * Within a continuous stretch a metric can be missing from one sample (partial
 * quota). Carry the previous reading forward so lines don't flicker; across a real
 * gap insert empty points so the line breaks honestly.
 */
function prepareChartData(rawPoints: HistoryDataPoint[], aggregation: string): HistoryDataPoint[] {
  const points = rawPoints.map((p) => ({
    ...p,
    timestamp: new Date(parseServerTimestamp(p.timestamp)).toISOString(),
  }))
  removeSocSpikes(points)

  const gapMs = getGapThresholdMs(aggregation)
  const result: HistoryDataPoint[] = []
  const last: Partial<Record<MetricKey, { value: number; at: number }>> = {}

  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    const time = new Date(point.timestamp).getTime()

    if (i > 0) {
      const prevTime = new Date(points[i - 1].timestamp).getTime()
      if (time - prevTime > gapMs) {
        result.push(createEmptyDataPoint(prevTime + 1000))
        result.push(createEmptyDataPoint(time - 1000))
      }
    }

    for (const key of METRIC_KEYS) {
      const value = point[key]
      if (value !== null && value !== undefined) {
        last[key] = { value, at: time }
      } else {
        const previous = last[key]
        if (previous && time - previous.at <= gapMs) point[key] = previous.value
      }
    }
    result.push(point)
  }

  return result
}

export function useChartData(
  serialNumber: string,
  period: ChartPeriod,
  customRange?: DateRange | null
): UseChartDataResult {
  const query = useQuery({
    queryKey: ['deviceHistory', serialNumber, period, customRange?.from, customRange?.to],
    queryFn: async () => {
      const response = await api.getDeviceHistory(
        serialNumber,
        period,
        period === 'custom' && customRange ? customRange : undefined
      )
      return prepareChartData(response.data.dataPoints, response.data.aggregation)
    },
    staleTime: 5_000,
    refetchInterval: getRefetchIntervalMs(period, customRange),
    // Pick up where we left off as soon as the tab is shown again
    refetchOnWindowFocus: true,
    // Keep the old chart on screen while a new period loads instead of a spinner flash
    placeholderData: keepPreviousData,
    enabled: !!serialNumber && (period !== 'custom' || !!customRange),
  })

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    updatedAt: query.dataUpdatedAt,
    refetch: () => { query.refetch() },
  }
}
