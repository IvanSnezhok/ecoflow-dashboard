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

  const legendLabels: Record<string, string> = {
    bmsMasterVolV: 'Main Battery',
    extraBattery1VolV: 'Extra Battery 1',
    extraBattery2VolV: 'Extra Battery 2',
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={formattedData} margin={{ top: 5, right: 5, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(value) => formatTimestamp(value, period)}
          stroke={chartColors.text}
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={['dataMin - 1', 'dataMax + 1']}
          tickFormatter={(value) => `${Number(value).toFixed(1)}V`}
          stroke={chartColors.text}
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          labelFormatter={(value) => new Date(value as string).toLocaleString('en-US')}
          formatter={(value, name) => [
            `${Number(value).toFixed(2)}V`,
            legendLabels[name as string] || name
          ]}
        />
        <Legend
          formatter={(value) => legendLabels[value] || value}
        />
        {showMainBattery && (
          <Line
            type="monotone"
            dataKey="bmsMasterVolV"
            name="bmsMasterVolV"
            stroke={chartColors.voltage.stroke}
            strokeWidth={2}
            dot={false}
            connectNulls
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
            connectNulls
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
            connectNulls
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
})
