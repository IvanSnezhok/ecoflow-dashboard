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

interface ExtraBatteryChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
  metric: 'soc' | 'temp'
  batteryIndex: 1 | 2
  customRange?: DateRange | null
}

// Custom tooltip component with timezone support
function CustomTooltip({ active, payload, label, metric }: any) {
  const { timezone, timeFormat } = useSettingsStore()

  if (!active || !payload || !payload.length) return null

  const value = payload[0]?.value
  const unit = metric === 'soc' ? '%' : '°C'
  const hour12 = timeFormat === '12h'

  // Color based on metric type
  let color: string
  if (metric === 'soc') {
    color = value <= 20 ? '#EF4444' : value <= 40 ? '#F59E0B' : '#10B981'
  } else {
    color = value >= 45 ? '#EF4444' : value >= 35 ? '#F59E0B' : '#10B981'
  }

  return (
    <div className="bg-card border border-border rounded-sm shadow-lg p-2 min-w-[130px]">
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
        <span className="text-xs font-mono font-semibold">
          {value}{unit}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {metric === 'soc' ? 'SOC' : 'Temp'}
        </span>
      </div>
    </div>
  )
}

export const ExtraBatteryChart = memo(function ExtraBatteryChart({
  data,
  period,
  height = 200,
  metric,
  batteryIndex,
  customRange,
}: ExtraBatteryChartProps) {
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

  const dataKey = batteryIndex === 1
    ? (metric === 'soc' ? 'extraBattery1Soc' : 'extraBattery1Temp')
    : (metric === 'soc' ? 'extraBattery2Soc' : 'extraBattery2Temp')

  const color = batteryIndex === 1
    ? chartColors.extraBattery1.stroke
    : chartColors.extraBattery2.stroke

  const unit = metric === 'soc' ? '%' : '°C'

  // Calculate average for reference line
  const validData = data.filter(p => (p as any)[dataKey] !== null && (p as any)[dataKey] !== undefined)
  const avgValue = validData.length > 0
    ? Math.round(validData.reduce((sum, p) => sum + ((p as any)[dataKey] || 0), 0) / validData.length)
    : null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 55, left: 0, bottom: 5 }}>
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
          domain={metric === 'soc' ? [0, 100] : ['auto', 'auto']}
          tickFormatter={(value) => `${value}${unit}`}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={false}
          width={38}
          ticks={metric === 'soc' ? [0, 25, 50, 75, 100] : undefined}
        />

        <Tooltip
          content={<CustomTooltip metric={metric} batteryIndex={batteryIndex} />}
          cursor={{ stroke: chartColors.text, strokeWidth: 1, strokeDasharray: '4 4' }}
        />

        {/* Average reference line */}
        {avgValue !== null && (
          <ReferenceLine
            y={avgValue}
            stroke={chartColors.text}
            strokeDasharray="8 4"
            strokeOpacity={0.5}
            label={{
              value: `avg ${avgValue}${unit}`,
              position: 'right',
              fill: chartColors.text,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          />
        )}

        {/* Warning reference lines */}
        {metric === 'soc' && (
          <ReferenceLine
            y={20}
            stroke="#EF4444"
            strokeDasharray="4 4"
            strokeOpacity={0.3}
          />
        )}
        {metric === 'temp' && (
          <ReferenceLine
            y={45}
            stroke="#EF4444"
            strokeDasharray="4 4"
            strokeOpacity={0.3}
          />
        )}

        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={false}
          connectNulls={true}
          activeDot={{
            r: 4,
            fill: color,
            stroke: '#fff',
            strokeWidth: 2
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
})
