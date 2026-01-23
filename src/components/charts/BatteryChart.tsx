import { memo } from 'react'
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
import type { HistoryDataPoint, ChartPeriod } from '@/types/device'
import { chartColors, formatTimestamp } from './chartConfig'

interface BatteryChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
}

// Custom tooltip component
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null

  const value = payload[0]?.value
  const color = value <= 20 ? '#EF4444' : value <= 40 ? '#F59E0B' : '#10B981'

  return (
    <div className="bg-card border border-border rounded-sm shadow-lg p-2 min-w-[120px]">
      <p className="text-[10px] text-muted-foreground font-mono mb-1">
        {new Date(label).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })}
      </p>
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

export const BatteryChart = memo(function BatteryChart({ data, period, height = 200 }: BatteryChartProps) {
  // Calculate average for reference line
  const validData = data.filter(p => p.batterySoc !== null)
  const avgSoc = validData.length > 0
    ? Math.round(validData.reduce((sum, p) => sum + (p.batterySoc || 0), 0) / validData.length)
    : null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="socGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
          </linearGradient>
          {/* Pattern for grid */}
          <pattern id="gridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" fill={chartColors.grid} opacity="0.5" />
          </pattern>
        </defs>

        {/* Dotted grid */}
        <CartesianGrid
          strokeDasharray="2 4"
          stroke={chartColors.grid}
          vertical={false}
          strokeOpacity={0.7}
        />

        <XAxis
          dataKey="timestamp"
          tickFormatter={(value) => formatTimestamp(value, period)}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={{ stroke: chartColors.grid, strokeWidth: 1 }}
          dy={5}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(value) => `${value}%`}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={false}
          width={38}
          ticks={[0, 25, 50, 75, 100]}
        />

        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: chartColors.text, strokeWidth: 1, strokeDasharray: '4 4' }}
        />

        {/* Average reference line */}
        {avgSoc !== null && (
          <ReferenceLine
            y={avgSoc}
            stroke={chartColors.text}
            strokeDasharray="8 4"
            strokeOpacity={0.5}
            label={{
              value: `avg ${avgSoc}%`,
              position: 'right',
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
          stroke={chartColors.batterySoc.stroke}
          fill="url(#socGradient)"
          strokeWidth={2}
          connectNulls={false}
          dot={false}
          activeDot={{
            r: 4,
            fill: chartColors.batterySoc.stroke,
            stroke: '#fff',
            strokeWidth: 2
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
})
