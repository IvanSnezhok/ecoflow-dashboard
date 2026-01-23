import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ChartPeriod, DateRange, HistoryDataPoint } from '@/types/device'

interface UseChartDataResult {
  data: HistoryDataPoint[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

// Get expected interval between data points in milliseconds based on period
function getExpectedIntervalMs(period: ChartPeriod): number {
  switch (period) {
    case '10m':
      return 10 * 1000 // 10 seconds
    case '1h':
      return 30 * 1000 // 30 seconds
    case '24h':
      return 60 * 1000 // 1 minute
    case '7d':
      return 5 * 60 * 1000 // 5 minutes
    case '30d':
      return 15 * 60 * 1000 // 15 minutes
    case 'custom':
    default:
      return 60 * 1000 // 1 minute default
  }
}

// Create an empty data point with null values
function createEmptyDataPoint(timestamp: string): HistoryDataPoint {
  return {
    timestamp,
    batterySoc: null,
    batteryWatts: null,
    acInputWatts: null,
    solarInputWatts: null,
    acOutputWatts: null,
    dcOutputWatts: null,
    temperature: null,
    bmsMasterVol: null,
    extraBattery1Soc: null,
    extraBattery1Temp: null,
    extraBattery1Vol: null,
    extraBattery2Soc: null,
    extraBattery2Temp: null,
    extraBattery2Vol: null,
  }
}

// Fill in gaps in the data with null values
function fillDataGaps(
  dataPoints: HistoryDataPoint[],
  period: ChartPeriod
): HistoryDataPoint[] {
  if (dataPoints.length < 2) {
    return dataPoints
  }

  const intervalMs = getExpectedIntervalMs(period)
  // Allow for 50% tolerance before considering it a gap
  const gapThresholdMs = intervalMs * 1.5

  const result: HistoryDataPoint[] = []

  for (let i = 0; i < dataPoints.length; i++) {
    const currentPoint = dataPoints[i]
    result.push(currentPoint)

    if (i < dataPoints.length - 1) {
      const nextPoint = dataPoints[i + 1]
      const currentTime = new Date(currentPoint.timestamp).getTime()
      const nextTime = new Date(nextPoint.timestamp).getTime()
      const timeDiff = nextTime - currentTime

      // If there's a significant gap, insert null points
      if (timeDiff > gapThresholdMs) {
        // Add one null point right after current (to break the line)
        const gapStartTime = currentTime + intervalMs
        result.push(createEmptyDataPoint(new Date(gapStartTime).toISOString()))

        // Add one null point right before next (to resume the line)
        const gapEndTime = nextTime - intervalMs
        if (gapEndTime > gapStartTime) {
          result.push(createEmptyDataPoint(new Date(gapEndTime).toISOString()))
        }
      }
    }
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
      // Fill in gaps in the data
      return fillDataGaps(response.data.dataPoints, period)
    },
    // Shorter stale time for real-time periods, longer for historical
    staleTime: period === '10m' ? 30000 : period === 'custom' ? 60000 : 60000,
    // Auto-refresh for 10m period only
    refetchInterval: period === '10m' ? 30000 : false,
    enabled: !!serialNumber && (period !== 'custom' || !!customRange),
  })

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    refetch: () => { query.refetch() },
  }
}
