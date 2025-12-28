import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Battery,
  BatteryCharging,
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
  TemperatureChart,
  VoltageChart,
  ExtraBatteryChart,
  DateRangePicker,
  ChartContainer,
  useChartData,
} from '@/components/charts'
import type { ChartPeriod, DateRange } from '@/types/device'

export default function Statistics() {
  const { serialNumber } = useParams<{ serialNumber: string }>()
  const { devices } = useDeviceStore()
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('24h')
  const [customRange, setCustomRange] = useState<DateRange | null>(null)

  const device = devices.find((d) => d.serialNumber === serialNumber)
  const { data: chartData, isLoading, error, refetch } = useChartData(
    serialNumber || '',
    chartPeriod,
    customRange
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

  // Check if we have data for voltage and extra batteries
  const hasVoltageData = useMemo(() => {
    return chartData.some(p => p.bmsMasterVol !== null)
  }, [chartData])

  const hasExtraBattery1Data = useMemo(() => {
    return chartData.some(p => p.extraBattery1Soc !== null)
  }, [chartData])

  const hasExtraBattery2Data = useMemo(() => {
    return chartData.some(p => p.extraBattery2Soc !== null)
  }, [chartData])

  const handlePeriodChange = (period: ChartPeriod) => {
    setChartPeriod(period)
    if (period !== 'custom') {
      setCustomRange(null)
    }
  }

  const handleCustomRangeChange = (range: DateRange) => {
    setCustomRange(range)
    setChartPeriod('custom')
  }

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

      {/* Date Range Picker */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <DateRangePicker
          period={chartPeriod}
          customRange={customRange}
          onPeriodChange={handlePeriodChange}
          onCustomRangeChange={handleCustomRangeChange}
        />
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

      {/* Temperature Chart */}
      <ChartContainer
        title="Battery Temperature"
        icon={<Thermometer className="w-5 h-5 text-orange-500" />}
        isLoading={isLoading}
        error={error}
        onRefresh={refetch}
        isEmpty={chartData.length === 0}
      >
        <TemperatureChart data={chartData} period={chartPeriod} height={250} />
      </ChartContainer>

      {/* Voltage Chart - Only show if voltage data exists */}
      {hasVoltageData && (
        <ChartContainer
          title="Battery Voltage"
          icon={<Zap className="w-5 h-5 text-blue-500" />}
          isLoading={isLoading}
          error={error}
          onRefresh={refetch}
          isEmpty={chartData.length === 0}
        >
          <VoltageChart
            data={chartData}
            period={chartPeriod}
            height={250}
            showMainBattery={true}
            showExtraBattery1={hasExtraBattery1Data}
            showExtraBattery2={hasExtraBattery2Data}
          />
        </ChartContainer>
      )}

      {/* Extra Battery Section - Only show if extra batteries are connected */}
      {(hasExtraBattery1Data || hasExtraBattery2Data) && (
        <>
          <h3 className="text-lg font-semibold mt-8 mb-4 flex items-center gap-2">
            <BatteryCharging className="w-5 h-5 text-primary" />
            Extra Battery Statistics
          </h3>

          <div className="grid gap-4 md:grid-cols-2">
            {hasExtraBattery1Data && (
              <>
                <ChartContainer
                  title="Extra Battery 1 - SOC"
                  icon={<Battery className="w-5 h-5 text-emerald-500" />}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={refetch}
                  isEmpty={chartData.length === 0}
                >
                  <ExtraBatteryChart
                    data={chartData}
                    period={chartPeriod}
                    height={200}
                    metric="soc"
                    batteryIndex={1}
                  />
                </ChartContainer>

                <ChartContainer
                  title="Extra Battery 1 - Temperature"
                  icon={<Thermometer className="w-5 h-5 text-emerald-500" />}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={refetch}
                  isEmpty={chartData.length === 0}
                >
                  <ExtraBatteryChart
                    data={chartData}
                    period={chartPeriod}
                    height={200}
                    metric="temp"
                    batteryIndex={1}
                  />
                </ChartContainer>
              </>
            )}

            {hasExtraBattery2Data && (
              <>
                <ChartContainer
                  title="Extra Battery 2 - SOC"
                  icon={<Battery className="w-5 h-5 text-violet-500" />}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={refetch}
                  isEmpty={chartData.length === 0}
                >
                  <ExtraBatteryChart
                    data={chartData}
                    period={chartPeriod}
                    height={200}
                    metric="soc"
                    batteryIndex={2}
                  />
                </ChartContainer>

                <ChartContainer
                  title="Extra Battery 2 - Temperature"
                  icon={<Thermometer className="w-5 h-5 text-violet-500" />}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={refetch}
                  isEmpty={chartData.length === 0}
                >
                  <ExtraBatteryChart
                    data={chartData}
                    period={chartPeriod}
                    height={200}
                    metric="temp"
                    batteryIndex={2}
                  />
                </ChartContainer>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
