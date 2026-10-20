import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Battery, BatteryCharging, Zap, Thermometer } from 'lucide-react'
import { useDeviceStore } from '@/stores/deviceStore'
import {
  BatteryChartPanel,
  PowerChartPanel,
  MetricLineChart,
  DateRangePicker,
  ChartContainer,
  SummaryItem,
  useChartData,
  chartColors,
  type LineSeries,
} from '@/components/charts'
import type { ChartPeriod, DateRange, HistoryDataPoint } from '@/types/device'

const TEMPERATURE: LineSeries[] = [
  { key: 'temperature', label: 'Main', color: chartColors.temperature },
  { key: 'extraBattery1Temp', label: 'Extra 1', color: chartColors.extraBattery1 },
  { key: 'extraBattery2Temp', label: 'Extra 2', color: chartColors.extraBattery2 },
]

const VOLTAGE: LineSeries[] = [
  { key: 'bmsMasterVol', label: 'Main', color: chartColors.voltage },
  { key: 'extraBattery1Vol', label: 'Extra 1', color: chartColors.extraBattery1 },
  { key: 'extraBattery2Vol', label: 'Extra 2', color: chartColors.extraBattery2 },
]

const EXTRA_SOC: LineSeries[] = [
  { key: 'extraBattery1Soc', label: 'Extra 1', color: chartColors.extraBattery1 },
  { key: 'extraBattery2Soc', label: 'Extra 2', color: chartColors.extraBattery2 },
]

const has = (data: HistoryDataPoint[], series: LineSeries[]) =>
  series.some((s) => data.some((point) => point[s.key] !== null && point[s.key] !== undefined))

export default function Statistics() {
  const { serialNumber } = useParams<{ serialNumber: string }>()
  const device = useDeviceStore((s) => s.devices.find((d) => d.serialNumber === serialNumber))
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('24h')
  const [customRange, setCustomRange] = useState<DateRange | null>(null)

  const { data: chartData, isLoading, isFetching, error, refetch } = useChartData(
    serialNumber || '',
    chartPeriod,
    customRange
  )

  const temperature = useMemo(() => {
    const values = chartData.map((p) => p.temperature).filter((v): v is number => v !== null)
    if (!values.length) return null
    return {
      avg: Math.round(values.reduce((sum, v) => sum + v, 0) / values.length),
      min: Math.round(Math.min(...values)),
      max: Math.round(Math.max(...values)),
    }
  }, [chartData])

  const hasVoltage = useMemo(() => has(chartData, VOLTAGE), [chartData])
  const hasExtraBatteries = useMemo(() => has(chartData, EXTRA_SOC), [chartData])

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

  const chartProps = {
    data: chartData,
    period: chartPeriod,
    customRange,
    isLoading,
    isFetching,
    error,
    onRefresh: refetch,
  }
  const lineProps = { data: chartData, period: chartPeriod, customRange }
  const container = {
    isLoading,
    isFetching,
    error,
    onRefresh: refetch,
    isEmpty: chartData.length === 0,
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to={`/device/${serialNumber}`}
          aria-label="Back to the device"
          className="inline-flex items-center justify-center w-8 h-8 rounded-sm border bg-card hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold tracking-tight truncate">
            Statistics: {device.name || device.serialNumber}
          </h2>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            {device.deviceType}
          </p>
        </div>
      </div>

      <DateRangePicker
        period={chartPeriod}
        customRange={customRange}
        onPeriodChange={handlePeriodChange}
        onCustomRangeChange={handleCustomRangeChange}
      />

      {/* Each chart carries its own totals (now / min / max, energy) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BatteryChartPanel {...chartProps} height={220} />

        <ChartContainer
          title="Temperature"
          icon={<Thermometer className="w-4 h-4 text-energy-yellow shrink-0" />}
          {...container}
          summary={temperature && (
            <>
              <SummaryItem label="avg" value={`${temperature.avg}°C`} />
              <SummaryItem label="min" value={`${temperature.min}°C`} />
              <SummaryItem label="max" value={`${temperature.max}°C`} className={temperature.max >= 45 ? 'text-energy-red' : undefined} />
            </>
          )}
        >
          <MetricLineChart {...lineProps} series={TEMPERATURE} unit="°C" warnAt={45} height={220} />
        </ChartContainer>
      </div>

      {/* Charging vs consumption: separate charts, each with its own totals */}
      <div className="grid gap-4 xl:grid-cols-2">
        <PowerChartPanel mode="input" {...chartProps} height={250} />
        <PowerChartPanel mode="output" {...chartProps} height={250} />
      </div>

      {(hasVoltage || hasExtraBatteries) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {hasVoltage && (
            <ChartContainer
              title="Battery voltage"
              icon={<Zap className="w-4 h-4 text-energy-blue shrink-0" />}
              {...container}
              className={hasExtraBatteries ? undefined : 'lg:col-span-2'}
            >
              <MetricLineChart
                {...lineProps}
                series={VOLTAGE}
                unit="V"
                scale={0.001}
                decimals={2}
                domain={['dataMin - 1', 'dataMax + 1']}
                height={220}
              />
            </ChartContainer>
          )}
          {hasExtraBatteries && (
            <ChartContainer
              title="Extra batteries"
              icon={<BatteryCharging className="w-4 h-4 text-energy-green shrink-0" />}
              {...container}
              className={hasVoltage ? undefined : 'lg:col-span-2'}
            >
              <MetricLineChart {...lineProps} series={EXTRA_SOC} unit="%" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} warnAt={20} height={220} />
            </ChartContainer>
          )}
        </div>
      )}
    </div>
  )
}
