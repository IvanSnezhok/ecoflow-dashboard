import { useState, useEffect, useCallback } from 'react'
import { api } from '@/services/api'
import type { ChartPeriod, HistoryDataPoint } from '@/types/device'

interface UseChartDataResult {
  data: HistoryDataPoint[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useChartData(serialNumber: string, period: ChartPeriod): UseChartDataResult {
  const [data, setData] = useState<HistoryDataPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!serialNumber) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await api.getDeviceHistory(serialNumber, period)
      setData(response.data.dataPoints)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load chart data'
      setError(message)
      setData([])
    } finally {
      setIsLoading(false)
    }
  }, [serialNumber, period])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh for short periods
  useEffect(() => {
    if (period === '10m') {
      const interval = setInterval(fetchData, 30000) // Refresh every 30 seconds
      return () => clearInterval(interval)
    }
  }, [period, fetchData])

  return { data, isLoading, error, refetch: fetchData }
}
