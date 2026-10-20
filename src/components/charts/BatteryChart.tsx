import { memo, useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { HistoryDataPoint, ChartPeriod, DateRange } from '@/types/device'
import { chartColors, cursorProps, gridProps, axisProps, xAxisProps, useTimeTickFormatter, useTooltipTime } from './chartConfig'

interface BatteryChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
  customRange?: DateRange | null
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { value: number | null }[]
  label?: string
}) {
  const time = useTooltipTime(label)
  const value = payload?.[0]?.value
  if (!active || value === null || value === undefined) return null
  const color = value <= 20 ? '#EF4444' : value <= 40 ? '#F59E0B' : '#10B981'

  return (
    <div className="bg-card border border-border rounded-sm shadow-lg p-2 min-w-[120px]">
      <p className="text-[10px] text-muted-foreground font-mono mb-1">{time}</p>
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-mono font-semibold">{value}%</span>
        <span className="text-[10px] text-muted-foreground">Battery</span>
      </div>
    </div>
  )
}

export const BatteryChart = memo(function BatteryChart({ data, period, height = 200, customRange }: BatteryChartProps) {
  const tickFormatter = useTimeTickFormatter(period, customRange)

  // Calculate average for reference line
  const avgSoc = useMemo(() => {
    const values = data.filter((p) => p.batterySoc !== null)
    return values.length > 0
      ? Math.round(values.reduce((sum, p) => sum + (p.batterySoc || 0), 0) / values.length)
      : null
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="socGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColors.batterySoc} stopOpacity={0.3} />
            <stop offset="95%" stopColor={chartColors.batterySoc} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid {...gridProps} />
        <XAxis {...xAxisProps} tickFormatter={tickFormatter} />
        <YAxis
          {...axisProps}
          domain={[0, 100]}
          tickFormatter={(value) => `${value}%`}
          axisLine={false}
          width={38}
          ticks={[0, 25, 50, 75, 100]}
        />

        <Tooltip content={<CustomTooltip />} cursor={cursorProps} />

        {/* Average reference line */}
        {avgSoc !== null && (
          <ReferenceLine
            y={avgSoc}
            stroke={chartColors.text}
            strokeDasharray="8 4"
            strokeOpacity={0.5}
            label={{
              value: `avg ${avgSoc}%`,
              position: 'insideTopRight',
              fill: chartColors.text,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          />
        )}

        {/* Low battery warning zone */}
        <ReferenceLine
          y={20}
          stroke="#EF4444"
          strokeDasharray="4 4"
          strokeOpacity={0.3}
        />

        <Area
          type="monotone"
          dataKey="batterySoc"
          stroke={chartColors.batterySoc}
          fill="url(#socGradient)"
          strokeWidth={2}
          // Short holes are already bridged in useChartData; what is left is a real gap
          connectNulls={false}
          isAnimationActive={false}
          dot={false}
          activeDot={{
            r: 4,
            fill: chartColors.batterySoc,
            stroke: '#fff',
            strokeWidth: 2
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
})
