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
  TrendingUp,
  TrendingDown,
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
import { cn } from '@/lib/utils'
import type { ChartPeriod, DateRange } from '@/types/device'

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  unit?: string
  subtext?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  colorClass?: string
}

function StatCard({ icon, label, value, unit, subtext, trend, trendValue, colorClass = 'text-primary' }: StatCardProps) {
  return (
    <div className="rounded-sm border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className={cn('flex items-center gap-2', colorClass)}>
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>
        {trend && trendValue && (
          <div className={cn(
            'flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded-sm',
            trend === 'up' ? 'text-energy-green bg-energy-green/10' :
            trend === 'down' ? 'text-energy-red bg-energy-red/10' :
            'text-muted-foreground bg-muted'
          )}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> :
             trend === 'down' ? <TrendingDown className="w-3 h-3" /> : null}
            {trendValue}
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-mono font-bold tabular-nums">{value}</span>
        {unit && <span className="text-sm text-muted-foreground font-mono">{unit}</span>}
      </div>
      {subtext && (
        <p className="text-[10px] text-muted-foreground mt-1 font-mono">{subtext}</p>
      )}
    </div>
  )
}

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

  // Calculate statistics from chart data (filtering out null values)
  const stats = useMemo(() => {
    if (chartData.length === 0) {
      return null
    }

    // Filter out data points with null values for each metric
    const socData = chartData.filter((p) => p.batterySoc !== null).map((p) => p.batterySoc as number)
    const solarData = chartData.filter((p) => p.solarInputWatts !== null).map((p) => p.solarInputWatts as number)
    const tempData = chartData.filter((p) => p.temperature !== null).map((p) => p.temperature as number)

    if (socData.length === 0) {
      return null
    }

    const avgSoc = Math.round(socData.reduce((sum, v) => sum + v, 0) / socData.length)
    const maxSolar = solarData.length > 0 ? Math.max(...solarData) : 0
    const avgSolar = solarData.length > 0 ? Math.round(solarData.reduce((sum, v) => sum + v, 0) / solarData.length) : 0
    const avgTemp = tempData.length > 0 ? Math.round(tempData.reduce((sum, v) => sum + v, 0) / tempData.length) : 0
    const minSoc = Math.min(...socData)
    const maxSoc = Math.max(...socData)

    // Calculate energy (Wh) by integrating power over time intervals
    // Energy = Power × Time, summing for each interval between data points
    let totalEnergyWh = 0
    for (let i = 0; i < chartData.length - 1; i++) {
      const current = chartData[i]
      const next = chartData[i + 1]

      // Calculate time interval in hours
      const t1 = new Date(current.timestamp).getTime()
      const t2 = new Date(next.timestamp).getTime()
      const intervalHours = (t2 - t1) / (1000 * 60 * 60) // ms to hours

      // Get power values (use 0 if null)
      const acOutput = current.acOutputWatts || 0
      const dcOutput = current.dcOutputWatts || 0
      const totalPower = acOutput + dcOutput

      // Energy = Power × Time
      totalEnergyWh += totalPower * intervalHours
    }

    return {
      avgSoc,
      minSoc,
      maxSoc,
      maxSolar,
      avgSolar,
      totalEnergyWh: Math.round(totalEnergyWh),
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
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <div className="rounded-sm border bg-card p-6 text-center">
          <Battery className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Device not found: {serialNumber}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header - Minimalist */}
      <div className="flex items-center gap-3">
        <Link
          to={`/device/${serialNumber}`}
          className="inline-flex items-center justify-center w-8 h-8 rounded-sm border bg-card hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold tracking-tight truncate">
            Statistics: {device.name || device.serialNumber}
          </h2>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            {device.deviceType} • Detailed usage analysis
          </p>
        </div>
        {chartData.length > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground">
            {chartData.length} points
          </span>
        )}
      </div>

      {/* Date Range Picker */}
      <DateRangePicker
        period={chartPeriod}
        customRange={customRange}
        onPeriodChange={handlePeriodChange}
        onCustomRangeChange={handleCustomRangeChange}
      />

      {/* Summary Cards */}
      {stats && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Battery className="w-4 h-4" />}
            label="Average Charge"
            value={stats.avgSoc}
            unit="%"
            subtext={`Min ${stats.minSoc}% • Max ${stats.maxSoc}%`}
            colorClass="text-energy-green"
          />
          <StatCard
            icon={<Sun className="w-4 h-4" />}
            label="Peak Solar"
            value={stats.maxSolar}
            unit="W"
            subtext={`Avg ${stats.avgSolar}W`}
            colorClass="text-energy-yellow"
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label="Total Consumption"
            value={stats.totalEnergyWh}
            unit="Wh"
            subtext="For selected period"
            colorClass="text-energy-blue"
          />
          <StatCard
            icon={<Thermometer className="w-4 h-4" />}
            label="Avg Temperature"
            value={stats.avgTemp}
            unit="°C"
            colorClass="text-energy-yellow"
          />
        </div>
      )}

      {/* Charts Grid - 2 columns for better layout */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Battery Level Chart */}
        <ChartContainer
          title="Battery Level"
          icon={<Battery className="w-4 h-4 text-energy-green" />}
          isLoading={isLoading}
          error={error}
          onRefresh={refetch}
          isEmpty={chartData.length === 0}
        >
          <BatteryChart data={chartData} period={chartPeriod} height={220} customRange={customRange} />
        </ChartContainer>

        {/* Temperature Chart */}
        <ChartContainer
          title="Temperature"
          icon={<Thermometer className="w-4 h-4 text-energy-yellow" />}
          isLoading={isLoading}
          error={error}
          onRefresh={refetch}
          isEmpty={chartData.length === 0}
        >
          <TemperatureChart data={chartData} period={chartPeriod} height={220} customRange={customRange} />
        </ChartContainer>
      </div>

      {/* Power Charts - Full Width */}
      <ChartContainer
        title="Input Power"
        icon={<Plug className="w-4 h-4 text-energy-purple" />}
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
          customRange={customRange}
        />
      </ChartContainer>

      <ChartContainer
        title="Output Power"
        icon={<Zap className="w-4 h-4 text-energy-blue" />}
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
          customRange={customRange}
        />
      </ChartContainer>

      {/* Voltage Chart - Only show if voltage data exists */}
      {hasVoltageData && (
        <ChartContainer
          title="Battery Voltage"
          icon={<Zap className="w-4 h-4 text-energy-blue" />}
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
            customRange={customRange}
          />
        </ChartContainer>
      )}

      {/* Extra Battery Section - Only show if extra batteries are connected */}
      {(hasExtraBattery1Data || hasExtraBattery2Data) && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pt-4">
            <BatteryCharging className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Extra Battery Statistics
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {hasExtraBattery1Data && (
              <>
                <ChartContainer
                  title="Extra Battery 1 - SOC"
                  icon={<Battery className="w-4 h-4 text-energy-green" />}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={refetch}
                  isEmpty={chartData.length === 0}
                >
                  <ExtraBatteryChart
                    data={chartData}
                    period={chartPeriod}
                    height={180}
                    metric="soc"
                    batteryIndex={1}
                    customRange={customRange}
                  />
                </ChartContainer>

                <ChartContainer
                  title="Extra Battery 1 - Temp"
                  icon={<Thermometer className="w-4 h-4 text-energy-yellow" />}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={refetch}
                  isEmpty={chartData.length === 0}
                >
                  <ExtraBatteryChart
                    data={chartData}
                    period={chartPeriod}
                    height={180}
                    metric="temp"
                    batteryIndex={1}
                    customRange={customRange}
                  />
                </ChartContainer>
              </>
            )}

            {hasExtraBattery2Data && (
              <>
                <ChartContainer
                  title="Extra Battery 2 - SOC"
                  icon={<Battery className="w-4 h-4 text-energy-purple" />}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={refetch}
                  isEmpty={chartData.length === 0}
                >
                  <ExtraBatteryChart
                    data={chartData}
                    period={chartPeriod}
                    height={180}
                    metric="soc"
                    batteryIndex={2}
                    customRange={customRange}
                  />
                </ChartContainer>

                <ChartContainer
                  title="Extra Battery 2 - Temp"
                  icon={<Thermometer className="w-4 h-4 text-energy-yellow" />}
                  isLoading={isLoading}
                  error={error}
                  onRefresh={refetch}
                  isEmpty={chartData.length === 0}
                >
                  <ExtraBatteryChart
                    data={chartData}
                    period={chartPeriod}
                    height={180}
                    metric="temp"
                    batteryIndex={2}
                    customRange={customRange}
                  />
                </ChartContainer>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
