import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/services/api'
import { getRefetchIntervalMs, prepareChartData } from '@/lib/chartData'
import type { ChartPeriod, DateRange, HistoryDataPoint } from '@/types/device'

export { parseServerTimestamp } from '@/lib/chartData'

interface UseChartDataResult {
  data: HistoryDataPoint[]
  isLoading: boolean
  isFetching: boolean
  error: string | null
  /** Epoch ms of the last successful fetch (0 before the first one) */
  updatedAt: number
  refetch: () => void
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
