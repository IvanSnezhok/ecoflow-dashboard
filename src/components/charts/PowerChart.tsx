import { memo, useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { HistoryDataPoint, ChartPeriod, DateRange } from '@/types/device'
import { chartColors, formatTimestamp } from './chartConfig'
import { formatWatts, type PowerKey } from './chartStats'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * `input`  – what charges the station (grid + solar), stacked.
 * `output` – what the house consumes from it (AC + DC), stacked.
 * Charging and consumption used to share one chart with four similar lines; split
 * charts with stacked areas show both the total and its parts at a glance.
 */
export type PowerChartMode = 'input' | 'output'

interface PowerChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  mode: PowerChartMode
  height?: number
  customRange?: DateRange | null
}

interface SeriesConfig {
  key: PowerKey
  label: string
  color: string
}

const SERIES: Record<PowerChartMode, SeriesConfig[]> = {
  input: [
    { key: 'acInputWatts', label: 'Grid (AC in)', color: chartColors.acInput.stroke },
    { key: 'solarInputWatts', label: 'Solar', color: chartColors.solarInput.stroke },
  ],
  output: [
    { key: 'acOutputWatts', label: 'AC out', color: chartColors.acOutput.stroke },
    { key: 'dcOutputWatts', label: 'DC / USB out', color: chartColors.dcOutput.stroke },
  ],
}

const TOTAL_LABEL: Record<PowerChartMode, string> = {
  input: 'Charging total',
  output: 'Consumption total',
}

interface TooltipEntry {
  dataKey: string
  value: number | null
  color: string
}

function CustomTooltip({ active, payload, label, mode }: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
  mode: PowerChartMode
}) {
  const { timezone, timeFormat } = useSettingsStore()

  if (!active || !payload || !payload.length || !label) return null
  const values = payload.filter((entry) => entry.value !== null && entry.value !== undefined)
  if (!values.length) return null

  const total = values.reduce((sum, entry) => sum + (entry.value ?? 0), 0)
  const labelFor = (key: string) => SERIES[mode].find((s) => s.key === key)?.label ?? key

  return (
    <div className="bg-card border border-border rounded-sm shadow-lg p-2 min-w-[160px]">
      <p className="text-[10px] text-muted-foreground font-mono mb-1.5 pb-1.5 border-b border-border">
        {new Date(label).toLocaleString('en-US', {
          timeZone: timezone,
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: timeFormat === '12h',
        })}
      </p>
      <div className="space-y-1">
        {values.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: entry.color }} />
              <span className="text-[10px] text-muted-foreground">{labelFor(entry.dataKey)}</span>
            </div>
            <span className="text-xs font-mono font-semibold">{formatWatts(entry.value ?? 0)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 pt-1 mt-1 border-t border-border">
          <span className="text-[10px] font-semibold uppercase tracking-wider">{TOTAL_LABEL[mode]}</span>
          <span className="text-xs font-mono font-bold">{formatWatts(total)}</span>
        </div>
      </div>
    </div>
  )
}

export const PowerChart = memo(function PowerChart({
  data,
  period,
  mode,
  height = 200,
  customRange,
}: PowerChartProps) {
  // Subscribe to settings store to re-render when timezone changes
  const { timezone, timeFormat } = useSettingsStore()

  const customRangeDurationHours = useMemo(() => {
    if (period !== 'custom' || !customRange) return undefined
    const from = new Date(customRange.from).getTime()
    const to = new Date(customRange.to).getTime()
    return (to - from) / (1000 * 60 * 60)
  }, [period, customRange])

  const tickFormatter = useMemo(() => {
    return (value: string) => formatTimestamp(value, period, customRangeDurationHours)
    // timezone/timeFormat are read inside formatTimestamp; listed to refresh ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customRangeDurationHours, timezone, timeFormat])

  const series = SERIES[mode]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`power-${mode}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.45} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0.08} />
            </linearGradient>
          ))}
        </defs>

        <CartesianGrid strokeDasharray="2 4" stroke={chartColors.grid} vertical={false} strokeOpacity={0.7} />

        <XAxis
          dataKey="timestamp"
          tickFormatter={tickFormatter}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={{ stroke: chartColors.grid, strokeWidth: 1 }}
          dy={5}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(value: number) => formatWatts(value)}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={false}
          width={44}
          allowDecimals={false}
        />

        <Tooltip
          content={<CustomTooltip mode={mode} />}
          cursor={{ stroke: chartColors.text, strokeWidth: 1, strokeDasharray: '4 4' }}
        />

        <Legend
          wrapperStyle={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}
          formatter={(value: string) => series.find((s) => s.key === value)?.label ?? value}
          iconType="square"
          iconSize={8}
        />

        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stackId={mode}
            stroke={s.color}
            strokeWidth={1.5}
            fill={`url(#power-${mode}-${s.key})`}
            dot={false}
            connectNulls={false}
            // Redrawing from zero on every auto-refresh is distracting
            isAnimationActive={false}
            activeDot={{ r: 3, fill: s.color, stroke: '#fff', strokeWidth: 1.5 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
})
