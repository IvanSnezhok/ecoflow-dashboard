import { memo, useMemo } from 'react'
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
import { chartColors, formatTimestamp } from './chartConfig'
import { useSettingsStore } from '@/stores/settingsStore'

interface PowerChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
  showInputs?: boolean
  showOutputs?: boolean
  customRange?: DateRange | null
}

const labels: Record<string, string> = {
  acInputWatts: 'AC In',
  solarInputWatts: 'Solar',
  acOutputWatts: 'AC Out',
  dcOutputWatts: 'DC Out',
}

// Custom tooltip component with timezone support
function CustomTooltip({ active, payload, label }: any) {
  const { timezone, timeFormat } = useSettingsStore()

  if (!active || !payload || !payload.length) return null

  const hour12 = timeFormat === '12h'

  return (
    <div className="bg-card border border-border rounded-sm shadow-lg p-2 min-w-[140px]">
      <p className="text-[10px] text-muted-foreground font-mono mb-1.5 pb-1.5 border-b border-border">
        {new Date(label).toLocaleString('en-US', {
          timeZone: timezone,
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12
        })}
      </p>
      <div className="space-y-1">
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-[10px] text-muted-foreground">
                {labels[entry.dataKey] || entry.dataKey}
              </span>
            </div>
            <span className="text-xs font-mono font-semibold">
              {entry.value}W
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const PowerChart = memo(function PowerChart({
  data,
  period,
  height = 200,
  showInputs = true,
  showOutputs = true,
  customRange,
}: PowerChartProps) {
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

  // Calculate max power for reference (protect against empty arrays)
  const maxInput = data.length > 0
    ? Math.max(...data.map(p => Math.max(p.acInputWatts || 0, p.solarInputWatts || 0)))
    : 0
  const maxOutput = data.length > 0
    ? Math.max(...data.map(p => Math.max(p.acOutputWatts || 0, p.dcOutputWatts || 0)))
    : 0
  const peakPower = Math.max(maxInput, maxOutput)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 70, left: 0, bottom: 5 }}>
        <defs>
          {/* Gradient fills for potential area charts */}
          <linearGradient id="solarGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColors.solarInput.stroke} stopOpacity={0.2} />
            <stop offset="95%" stopColor={chartColors.solarInput.stroke} stopOpacity={0.02} />
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
          tickFormatter={(value) => `${value}W`}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={false}
          width={45}
        />

        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: chartColors.text, strokeWidth: 1, strokeDasharray: '4 4' }}
        />

        <Legend
          wrapperStyle={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}
          formatter={(value) => labels[value] || value}
          iconType="square"
          iconSize={8}
        />

        {/* Peak power reference line */}
        {peakPower > 0 && (
          <ReferenceLine
            y={peakPower}
            stroke={chartColors.text}
            strokeDasharray="8 4"
            strokeOpacity={0.3}
            label={{
              value: `peak ${peakPower}W`,
              position: 'right',
              fill: chartColors.text,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          />
        )}

        {showInputs && (
          <>
            <Line
              type="monotone"
              dataKey="acInputWatts"
              stroke={chartColors.acInput.stroke}
              strokeWidth={2}
              dot={false}
              connectNulls={true}
              activeDot={{
                r: 4,
                fill: chartColors.acInput.stroke,
                stroke: '#fff',
                strokeWidth: 2
              }}
            />
            <Line
              type="monotone"
              dataKey="solarInputWatts"
              stroke={chartColors.solarInput.stroke}
              strokeWidth={2}
              dot={false}
              connectNulls={true}
              activeDot={{
                r: 4,
                fill: chartColors.solarInput.stroke,
                stroke: '#fff',
                strokeWidth: 2
              }}
            />
          </>
        )}
        {showOutputs && (
          <>
            <Line
              type="monotone"
              dataKey="acOutputWatts"
              stroke={chartColors.acOutput.stroke}
              strokeWidth={2}
              dot={false}
              connectNulls={true}
              activeDot={{
                r: 4,
                fill: chartColors.acOutput.stroke,
                stroke: '#fff',
                strokeWidth: 2
              }}
            />
            <Line
              type="monotone"
              dataKey="dcOutputWatts"
              stroke={chartColors.dcOutput.stroke}
              strokeWidth={2}
              dot={false}
              connectNulls={true}
              activeDot={{
                r: 4,
                fill: chartColors.dcOutput.stroke,
                stroke: '#fff',
                strokeWidth: 2
              }}
            />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  )
})
