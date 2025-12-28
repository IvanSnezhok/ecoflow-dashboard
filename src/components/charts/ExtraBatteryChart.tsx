import { memo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { HistoryDataPoint, ChartPeriod } from '@/types/device'
import { chartColors, formatTimestamp } from './chartConfig'

interface ExtraBatteryChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
  metric: 'soc' | 'temp'
  batteryIndex: 1 | 2
}

export const ExtraBatteryChart = memo(function ExtraBatteryChart({
  data,
  period,
  height = 200,
  metric,
  batteryIndex,
}: ExtraBatteryChartProps) {
  const dataKey = batteryIndex === 1
    ? (metric === 'soc' ? 'extraBattery1Soc' : 'extraBattery1Temp')
    : (metric === 'soc' ? 'extraBattery2Soc' : 'extraBattery2Temp')

  const color = batteryIndex === 1
    ? chartColors.extraBattery1.stroke
    : chartColors.extraBattery2.stroke

  const unit = metric === 'soc' ? '%' : '°C'
  const label = `Extra Battery ${batteryIndex} ${metric === 'soc' ? 'SOC' : 'Temperature'}`

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 5 }}>
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
          domain={metric === 'soc' ? [0, 100] : ['auto', 'auto']}
          tickFormatter={(value) => `${value}${unit}`}
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
          formatter={(value) => [`${value}${unit}`, label]}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
})
