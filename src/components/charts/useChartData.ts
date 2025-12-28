import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ChartPeriod, DateRange, HistoryDataPoint } from '@/types/device'

interface UseChartDataResult {
  data: HistoryDataPoint[]
  isLoading: boolean
  error: string | null
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
      return response.data.dataPoints
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
