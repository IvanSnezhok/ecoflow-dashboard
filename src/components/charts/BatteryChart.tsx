import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { HistoryDataPoint, ChartPeriod } from '@/types/device'
import { chartColors, formatTimestamp } from './chartConfig'

interface BatteryChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
}

export function BatteryChart({ data, period, height = 200 }: BatteryChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
        <defs>
          <linearGradient id="socGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
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
          domain={[0, 100]}
          tickFormatter={(value) => `${value}%`}
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
          formatter={(value) => [`${value}%`, 'Battery Charge']}
        />
        <Area
          type="monotone"
          dataKey="batterySoc"
          stroke={chartColors.batterySoc.stroke}
          fill={chartColors.batterySoc.fill}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
