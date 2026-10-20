import { memo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts'
import type { HistoryDataPoint, ChartPeriod, DateRange } from '@/types/device'
import { cursorProps, gridProps, legendProps, useTimeTickFormatter, useTooltipTime, axisProps, xAxisProps } from './chartConfig'

type MetricKey = Exclude<keyof HistoryDataPoint, 'timestamp'>

export interface LineSeries {
  key: MetricKey
  label: string
  color: string
}

interface MetricLineChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  customRange?: DateRange | null
  height?: number
  /** One line per series; series without any value in the data are left out */
  series: LineSeries[]
  unit: string
  /** Factor applied to stored values, e.g. 0.001 for mV → V */
  scale?: number
  decimals?: number
  domain?: [number | string, number | string]
  ticks?: number[]
  /** A red dashed line, e.g. the low-battery or high-temperature mark */
  warnAt?: number
}

interface TooltipEntry {
  name: string
  value: number | null
  color: string
}

function ChartTooltip({ active, payload, label, unit, decimals }: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
  unit: string
  decimals: number
}) {
  const time = useTooltipTime(label)
  const values = payload?.filter((entry) => entry.value !== null && entry.value !== undefined) ?? []
  if (!active || !values.length) return null

  return (
    <div className="bg-card border border-border rounded-sm shadow-lg p-2 min-w-[140px]">
      <p className="text-[10px] text-muted-foreground font-mono mb-1.5 pb-1.5 border-b border-border">{time}</p>
      <div className="space-y-1">
        {values.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: entry.color }} />
              <span className="text-[10px] text-muted-foreground">{entry.name}</span>
            </div>
            <span className="text-xs font-mono font-semibold">{Number(entry.value).toFixed(decimals)}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Line chart of one metric across packs (temperature, voltage, extra-battery level) */
export const MetricLineChart = memo(function MetricLineChart({
  data,
  period,
  customRange,
  height = 200,
  series,
  unit,
  scale = 1,
  decimals = 0,
  domain,
  ticks,
  warnAt,
}: MetricLineChartProps) {
  const tickFormatter = useTimeTickFormatter(period, customRange)
  const shown = series.filter((s) => data.some((point) => point[s.key] !== null && point[s.key] !== undefined))
  const value = (key: MetricKey) => (point: HistoryDataPoint) => {
    const raw = point[key]
    // A stored 0 V means "not reported" for voltages, so it breaks the line too
    return raw === null || raw === undefined || (scale !== 1 && raw === 0) ? null : raw * scale
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis {...xAxisProps} tickFormatter={tickFormatter} />
        <YAxis
          {...axisProps}
          domain={domain ?? ['auto', 'auto']}
          ticks={ticks}
          tickFormatter={(v: number) => `${Number(v).toFixed(decimals ? 1 : 0)}${unit}`}
          axisLine={false}
          width={42}
        />
        <Tooltip content={<ChartTooltip unit={unit} decimals={decimals} />} cursor={cursorProps} />
        {/* In series order (Main first), not sorted by name */}
        {shown.length > 1 && <Legend {...legendProps} itemSorter={null} />}
        {warnAt !== undefined && (
          <ReferenceLine y={warnAt} stroke="#EF4444" strokeDasharray="4 4" strokeOpacity={0.3} />
        )}
        {shown.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={value(s.key)}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: s.color, stroke: '#fff', strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
})
