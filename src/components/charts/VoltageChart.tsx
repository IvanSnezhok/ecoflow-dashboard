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
import type { HistoryDataPoint, ChartPeriod } from '@/types/device'
import { chartColors, formatTimestamp } from './chartConfig'

interface VoltageChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
  showMainBattery?: boolean
  showExtraBattery1?: boolean
  showExtraBattery2?: boolean
}

const legendLabels: Record<string, string> = {
  bmsMasterVolV: 'Main Battery',
  extraBattery1VolV: 'Extra Battery 1',
  extraBattery2VolV: 'Extra Battery 2',
}

const colors: Record<string, string> = {
  bmsMasterVolV: chartColors.voltage.stroke,
  extraBattery1VolV: chartColors.extraBattery1.stroke,
  extraBattery2VolV: chartColors.extraBattery2.stroke,
}

// Custom tooltip component
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null

  return (
    <div className="bg-card border border-border rounded-sm shadow-lg p-2 min-w-[150px]">
      <p className="text-[10px] text-muted-foreground font-mono mb-1.5 pb-1.5 border-b border-border">
        {new Date(label).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
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
                {legendLabels[entry.dataKey] || entry.dataKey}
              </span>
            </div>
            <span className="text-xs font-mono font-semibold">
              {Number(entry.value).toFixed(2)}V
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const VoltageChart = memo(function VoltageChart({
  data,
  period,
  height = 200,
  showMainBattery = true,
  showExtraBattery1 = false,
  showExtraBattery2 = false,
}: VoltageChartProps) {
  // Convert mV to V for display
  const formattedData = useMemo(() => {
    return data.map(point => ({
      ...point,
      bmsMasterVolV: point.bmsMasterVol ? point.bmsMasterVol / 1000 : null,
      extraBattery1VolV: point.extraBattery1Vol ? point.extraBattery1Vol / 1000 : null,
      extraBattery2VolV: point.extraBattery2Vol ? point.extraBattery2Vol / 1000 : null,
    }))
  }, [data])

  // Calculate average voltage for reference line
  const validData = formattedData.filter(p => p.bmsMasterVolV !== null)
  const avgVoltage = validData.length > 0
    ? validData.reduce((sum, p) => sum + (p.bmsMasterVolV || 0), 0) / validData.length
    : null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
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
          domain={['dataMin - 1', 'dataMax + 1']}
          tickFormatter={(value) => `${Number(value).toFixed(1)}V`}
          stroke={chartColors.text}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          tickLine={false}
          axisLine={false}
          width={42}
        />

        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: chartColors.text, strokeWidth: 1, strokeDasharray: '4 4' }}
        />

        <Legend
          wrapperStyle={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}
          formatter={(value) => legendLabels[value] || value}
          iconType="square"
          iconSize={8}
        />

        {/* Average reference line */}
        {avgVoltage !== null && (
          <ReferenceLine
            y={avgVoltage}
            stroke={chartColors.text}
            strokeDasharray="8 4"
            strokeOpacity={0.5}
            label={{
              value: `avg ${avgVoltage.toFixed(1)}V`,
              position: 'right',
              fill: chartColors.text,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          />
        )}

        {showMainBattery && (
          <Line
            type="monotone"
            dataKey="bmsMasterVolV"
            name="bmsMasterVolV"
            stroke={chartColors.voltage.stroke}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            activeDot={{
              r: 4,
              fill: chartColors.voltage.stroke,
              stroke: '#fff',
              strokeWidth: 2
            }}
          />
        )}
        {showExtraBattery1 && (
          <Line
            type="monotone"
            dataKey="extraBattery1VolV"
            name="extraBattery1VolV"
            stroke={chartColors.extraBattery1.stroke}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            activeDot={{
              r: 4,
              fill: chartColors.extraBattery1.stroke,
              stroke: '#fff',
              strokeWidth: 2
            }}
          />
        )}
        {showExtraBattery2 && (
          <Line
            type="monotone"
            dataKey="extraBattery2VolV"
            name="extraBattery2VolV"
            stroke={chartColors.extraBattery2.stroke}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            activeDot={{
              r: 4,
              fill: chartColors.extraBattery2.stroke,
              stroke: '#fff',
              strokeWidth: 2
            }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
})
