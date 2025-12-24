import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Battery,
  Zap,
  Sun,
  Plug,
  Thermometer,
  Activity,
} from 'lucide-react'
import { useDeviceStore } from '@/stores/deviceStore'
import {
  BatteryChart,
  PowerChart,
  PeriodSelector,
  ChartContainer,
  useChartData,
} from '@/components/charts'
import type { ChartPeriod } from '@/types/device'

export default function Statistics() {
  const { serialNumber } = useParams<{ serialNumber: string }>()
  const { devices } = useDeviceStore()
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('24h')

  const device = devices.find((d) => d.serialNumber === serialNumber)
  const { data: chartData, isLoading, error, refetch } = useChartData(
    serialNumber || '',
    chartPeriod
  )

  // Calculate statistics from chart data
  const stats = useMemo(() => {
    if (chartData.length === 0) {
      return null
    }

    const avgSoc = Math.round(
      chartData.reduce((sum, p) => sum + p.batterySoc, 0) / chartData.length
    )
    const maxSolar = Math.max(...chartData.map((p) => p.solarInputWatts))
    const avgSolar = Math.round(
      chartData.reduce((sum, p) => sum + p.solarInputWatts, 0) / chartData.length
    )
    const totalAcOutput = chartData.reduce((sum, p) => sum + p.acOutputWatts, 0)
    const totalDcOutput = chartData.reduce((sum, p) => sum + p.dcOutputWatts, 0)
    const avgTemp = Math.round(
      chartData.reduce((sum, p) => sum + p.temperature, 0) / chartData.length
    )
    const minSoc = Math.min(...chartData.map((p) => p.batterySoc))
    const maxSoc = Math.max(...chartData.map((p) => p.batterySoc))

    return {
      avgSoc,
      minSoc,
      maxSoc,
      maxSolar,
      avgSolar,
      totalOutput: totalAcOutput + totalDcOutput,
      avgTemp,
    }
  }, [chartData])

  if (!device) {
    return (
      <div className="space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-muted-foreground">Device not found: {serialNumber}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to={`/device/${serialNumber}`}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border hover:bg-accent"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Statistics: {device.name || device.serialNumber}
          </h2>
          <p className="text-muted-foreground">
            {device.deviceType} • Detailed usage analysis
          </p>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <PeriodSelector value={chartPeriod} onChange={setChartPeriod} />
        {chartData.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {chartData.length} data points
          </p>
        )}
      </div>

      {/* Summary Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Battery className="w-4 h-4 text-green-500" />
              Average Charge
            </div>
            <div className="text-2xl font-bold">{stats.avgSoc}%</div>
            <div className="text-xs text-muted-foreground mt-1">
              Min: {stats.minSoc}% • Max: {stats.maxSoc}%
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Sun className="w-4 h-4 text-yellow-500" />
              Max Solar
            </div>
            <div className="text-2xl font-bold">{stats.maxSolar}W</div>
            <div className="text-xs text-muted-foreground mt-1">
              Average: {stats.avgSolar}W
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Activity className="w-4 h-4 text-blue-500" />
              Total Consumption
            </div>
            <div className="text-2xl font-bold">{Math.round(stats.totalOutput / 60)}Wh</div>
            <div className="text-xs text-muted-foreground mt-1">
              For selected period
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Thermometer className="w-4 h-4 text-orange-500" />
              Average Temperature
            </div>
            <div className="text-2xl font-bold">{stats.avgTemp}°C</div>
          </div>
        </div>
      )}

      {/* Battery Level Chart */}
      <ChartContainer
        title="Battery Charge Level"
        icon={<Battery className="w-5 h-5 text-green-500" />}
        isLoading={isLoading}
        error={error}
        onRefresh={refetch}
        isEmpty={chartData.length === 0}
      >
        <BatteryChart data={chartData} period={chartPeriod} height={250} />
      </ChartContainer>

      {/* Power Input Chart */}
      <ChartContainer
        title="Input Power"
        icon={<Plug className="w-5 h-5 text-purple-500" />}
        isLoading={isLoading}
        error={error}
        onRefresh={refetch}
        isEmpty={chartData.length === 0}
      >
        <PowerChart
          data={chartData}
          period={chartPeriod}
          height={250}
          showInputs={true}
          showOutputs={false}
        />
      </ChartContainer>

      {/* Power Output Chart */}
      <ChartContainer
        title="Output Power"
        icon={<Zap className="w-5 h-5 text-pink-500" />}
        isLoading={isLoading}
        error={error}
        onRefresh={refetch}
        isEmpty={chartData.length === 0}
      >
        <PowerChart
          data={chartData}
          period={chartPeriod}
          height={250}
          showInputs={false}
          showOutputs={true}
        />
      </ChartContainer>
    </div>
  )
}
