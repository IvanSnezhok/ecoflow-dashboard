import { memo, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { HistoryDataPoint, ChartPeriod, DateRange } from '@/types/device'
import { chartColors, formatTimestamp } from './chartConfig'
import { useSettingsStore } from '@/stores/settingsStore'

interface TemperatureChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
  customRange?: DateRange | null
}

// Custom tooltip component with timezone support
function CustomTooltip({ active, payload, label }: any) {
  const { timezone, timeFormat } = useSettingsStore()

  if (!active || !payload || !payload.length) return null

  const value = payload[0]?.value
  // Color based on temperature: normal (green) < 35°C, warm (yellow) 35-45°C, hot (red) > 45°C
  const color = value >= 45 ? '#EF4444' : value >= 35 ? '#F59E0B' : '#10B981'
  const hour12 = timeFormat === '12h'

  return (
    <div className="bg-card border border-border rounded-sm shadow-lg p-2 min-w-[120px]">
      <p className="text-[10px] text-muted-foreground font-mono mb-1">
        {new Date(label).toLocaleString('en-US', {
          timeZone: timezone,
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12
        })}
      </p>
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-mono font-semibold">{value}°C</span>
        <span className="text-[10px] text-muted-foreground">Temp</span>
      </div>
    </div>
  )
}

export const TemperatureChart = memo(function TemperatureChart({ data, period, height = 200, customRange }: TemperatureChartProps) {
  // Subscribe to settings store to re-render when timezone changes
  const { timezone, timeFormat } = useSettingsStore()

  // Calculate custom range duration in hours
  const customRangeDurationHours = useMemo(() => {
    if (period !== 'custom' || !customRange) return undefined
    const from = new Date(customRange.from).getTime()
    const to = new Date(customRange.to).getTime()
    return (to - from) / (1000 * 60 * 60)
  }, [period, customRange])

  // Memoize the tick formatter to use current settings
  const tickFormatter = useMemo(() => {
    return (value: string) => formatTimestamp(value, period, customRangeDurationHours)
  }, [period, customRangeDurationHours, timezone, timeFormat])

  // Calculate average temperature for reference line
  const validData = data.filter(p => p.temperature !== null && p.temperature !== undefined)
  const avgTemp = validData.length > 0
    ? Math.round(validData.reduce((sum, p) => sum + (p.temperature || 0), 0) / validData.length)
    : null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 55, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColors.temperature.stroke} stopOpacity={0.2} />
            <stop offset="95%" stopColor={chartColors.temperature.stroke} stopOpacity={0.02} />
          </linearGradient>
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
          tickFormatter={tickFormatter}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={{ stroke: chartColors.grid, strokeWidth: 1 }}
          dy={5}
          interval="preserveStartEnd"
          minTickGap={50}
        />
        <YAxis
          tickFormatter={(value) => `${value}°C`}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={false}
          width={38}
        />

        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: chartColors.text, strokeWidth: 1, strokeDasharray: '4 4' }}
        />

        {/* Average reference line */}
        {avgTemp !== null && (
          <ReferenceLine
            y={avgTemp}
            stroke={chartColors.text}
            strokeDasharray="8 4"
            strokeOpacity={0.5}
            label={{
              value: `avg ${avgTemp}°C`,
              position: 'right',
              fill: chartColors.text,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          />
        )}

        {/* Warning zone at 45°C */}
        <ReferenceLine
          y={45}
          stroke="#EF4444"
          strokeDasharray="4 4"
          strokeOpacity={0.3}
        />

        <Line
          type="monotone"
          dataKey="temperature"
          stroke={chartColors.temperature.stroke}
          strokeWidth={2}
          dot={false}
          connectNulls={true}
          activeDot={{
            r: 4,
            fill: chartColors.temperature.stroke,
            stroke: '#fff',
            strokeWidth: 2
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
})
