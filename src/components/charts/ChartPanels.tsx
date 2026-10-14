import { useMemo } from 'react'
import { Battery, Plug, Home } from 'lucide-react'
import type { ChartPeriod, DateRange, HistoryDataPoint } from '@/types/device'
import { ChartContainer, SummaryItem } from './ChartContainer'
import { PowerChart, type PowerChartMode } from './PowerChart'
import { BatteryChart } from './BatteryChart'
import { summarizePower, formatWatts, formatEnergy, type PowerKey } from './chartStats'

interface PanelProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  customRange?: DateRange | null
  isLoading: boolean
  isFetching?: boolean
  error: string | null
  onRefresh: () => void
  height?: number
  className?: string
}

const POWER_PANEL: Record<PowerChartMode, {
  title: string
  hint: string
  keys: PowerKey[]
  icon: React.ReactNode
  energyLabel: string
  accent: string
}> = {
  input: {
    title: 'Charging (input)',
    hint: 'Power flowing into the station: grid and solar, stacked.',
    keys: ['acInputWatts', 'solarInputWatts'],
    icon: <Plug className="w-4 h-4 text-energy-purple shrink-0" />,
    energyLabel: 'charged',
    accent: 'text-energy-green',
  },
  output: {
    title: 'Consumption (output)',
    hint: 'Power your loads draw from the station: AC sockets and DC/USB, stacked.',
    keys: ['acOutputWatts', 'dcOutputWatts'],
    icon: <Home className="w-4 h-4 text-energy-blue shrink-0" />,
    energyLabel: 'used',
    accent: 'text-energy-blue',
  },
}

export function PowerChartPanel({ mode, ...props }: PanelProps & { mode: PowerChartMode }) {
  const config = POWER_PANEL[mode]
  const summary = useMemo(() => summarizePower(props.data, config.keys), [props.data, config.keys])

  return (
    <ChartContainer
      title={config.title}
      icon={config.icon}
      hint={config.hint}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      error={props.error}
      onRefresh={props.onRefresh}
      isEmpty={props.data.length === 0}
      className={props.className}
      summary={
        <>
          {summary.current !== null && <SummaryItem label="now" value={formatWatts(summary.current)} className={config.accent} />}
          <SummaryItem label="avg" value={formatWatts(summary.average)} />
          <SummaryItem label="peak" value={formatWatts(summary.peak)} />
          <SummaryItem label={config.energyLabel} value={formatEnergy(summary.energyWh)} className={config.accent} />
        </>
      }
    >
      <PowerChart
        data={props.data}
        period={props.period}
        mode={mode}
        height={props.height}
        customRange={props.customRange}
      />
    </ChartContainer>
  )
}

export function BatteryChartPanel(props: PanelProps) {
  const summary = useMemo(() => {
    const values = props.data.map((p) => p.batterySoc).filter((v): v is number => v !== null)
    if (!values.length) return null
    return {
      current: values[values.length - 1],
      min: Math.min(...values),
      max: Math.max(...values),
      change: values[values.length - 1] - values[0],
    }
  }, [props.data])

  return (
    <ChartContainer
      title="Battery level"
      icon={<Battery className="w-4 h-4 text-energy-green shrink-0" />}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      error={props.error}
      onRefresh={props.onRefresh}
      isEmpty={props.data.length === 0}
      className={props.className}
      summary={summary && (
        <>
          <SummaryItem label="now" value={`${summary.current}%`} className="text-energy-green" />
          <SummaryItem label="min" value={`${summary.min}%`} />
          <SummaryItem label="max" value={`${summary.max}%`} />
          <SummaryItem
            label="change"
            value={`${summary.change > 0 ? '+' : ''}${summary.change}%`}
            className={summary.change > 0 ? 'text-energy-green' : summary.change < 0 ? 'text-energy-red' : undefined}
          />
        </>
      )}
    >
      <BatteryChart data={props.data} period={props.period} height={props.height} customRange={props.customRange} />
    </ChartContainer>
  )
}
