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

interface PowerChartProps {
  data: HistoryDataPoint[]
  period: ChartPeriod
  height?: number
  showInputs?: boolean
  showOutputs?: boolean
}

export function PowerChart({
  data,
  period,
  height = 200,
  showInputs = true,
  showOutputs = true,
}: PowerChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
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
          tickFormatter={(value) => `${value}W`}
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
          formatter={(value, name) => {
            const labels: Record<string, string> = {
              acInputWatts: 'AC Input',
              solarInputWatts: 'Solar',
              acOutputWatts: 'AC Output',
              dcOutputWatts: 'DC Output',
            }
            return [`${value}W`, labels[name as string] || name]
          }}
        />
        <Legend
          formatter={(value) => {
            const labels: Record<string, string> = {
              acInputWatts: 'AC Input',
              solarInputWatts: 'Solar',
              acOutputWatts: 'AC Output',
              dcOutputWatts: 'DC Output',
            }
            return labels[value] || value
          }}
        />
        {showInputs && (
          <>
            <Line
              type="monotone"
              dataKey="acInputWatts"
              stroke={chartColors.acInput.stroke}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="solarInputWatts"
              stroke={chartColors.solarInput.stroke}
              strokeWidth={2}
              dot={false}
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
            />
            <Line
              type="monotone"
              dataKey="dcOutputWatts"
              stroke={chartColors.dcOutput.stroke}
              strokeWidth={2}
              dot={false}
            />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
