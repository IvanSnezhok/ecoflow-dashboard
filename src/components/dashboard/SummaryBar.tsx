import { Battery, Zap, Sun, Plug, ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDeviceStore } from '@/stores/deviceStore'

interface MetricCardProps {
  icon: React.ReactNode
  label: string
  value: number
  unit: string
  subValue?: string
  accentColor: 'green' | 'blue' | 'yellow' | 'red' | 'purple'
  trend?: 'up' | 'down' | 'neutral'
}

function MetricCard({ icon, label, value, unit, subValue, accentColor, trend }: MetricCardProps) {
  const colorMap = {
    green: 'border-l-energy-green text-energy-green',
    blue: 'border-l-energy-blue text-energy-blue',
    yellow: 'border-l-energy-yellow text-energy-yellow',
    red: 'border-l-energy-red text-energy-red',
    purple: 'border-l-energy-purple text-energy-purple',
  }

  const bgMap = {
    green: 'bg-energy-green/10',
    blue: 'bg-energy-blue/10',
    yellow: 'bg-energy-yellow/10',
    red: 'bg-energy-red/10',
    purple: 'bg-energy-purple/10',
  }

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 bg-card rounded-sm border border-border border-l-4',
      colorMap[accentColor]
    )}>
      {/* Icon */}
      <div className={cn('p-2 rounded-sm', bgMap[accentColor])}>
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-mono font-bold tabular-nums text-foreground">
            {value.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">{unit}</span>
          {trend && trend !== 'neutral' && (
            <span className={cn(
              'ml-1',
              trend === 'up' ? 'text-energy-green' : 'text-energy-red'
            )}>
              {trend === 'up' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            </span>
          )}
        </div>
        {subValue && (
          <p className="text-[10px] text-muted-foreground">{subValue}</p>
        )}
      </div>
    </div>
  )
}

export function SummaryBar() {
  const { devices } = useDeviceStore()

  // Aggregate metrics from all devices
  const metrics = devices.reduce(
    (acc, device) => {
      if (device.state) {
        acc.totalSoc += device.state.batterySoc
        acc.totalInput += (device.state.acInputWatts || 0) + (device.state.solarInputWatts || 0)
        acc.acOutput += device.state.acOutputWatts || 0
        acc.solarInput += device.state.solarInputWatts || 0
        acc.acInput += device.state.acInputWatts || 0
        acc.deviceCount++
      }
      return acc
    },
    { totalSoc: 0, totalInput: 0, acOutput: 0, solarInput: 0, acInput: 0, deviceCount: 0 }
  )

  const avgSoc = metrics.deviceCount > 0 ? Math.round(metrics.totalSoc / metrics.deviceCount) : 0
  const netPower = metrics.totalInput - metrics.acOutput

  // Determine power flow direction
  const isCharging = netPower > 0
  const isDischarging = netPower < 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {/* Total Battery */}
      <MetricCard
        icon={<Battery className="w-5 h-5" />}
        label="System Battery"
        value={avgSoc}
        unit="%"
        subValue={`${metrics.deviceCount} device${metrics.deviceCount !== 1 ? 's' : ''} online`}
        accentColor={avgSoc <= 20 ? 'red' : avgSoc <= 40 ? 'yellow' : 'green'}
        trend={isCharging ? 'up' : isDischarging ? 'down' : 'neutral'}
      />

      {/* Total Input */}
      <MetricCard
        icon={<Plug className="w-5 h-5" />}
        label="Total Input"
        value={metrics.totalInput}
        unit="W"
        subValue={metrics.acInput > 0 ? `AC: ${metrics.acInput}W` : undefined}
        accentColor="purple"
      />

      {/* Solar Input */}
      <MetricCard
        icon={<Sun className="w-5 h-5" />}
        label="Solar Power"
        value={metrics.solarInput}
        unit="W"
        subValue={metrics.solarInput > 0 ? 'Generating' : 'No solar'}
        accentColor="yellow"
      />

      {/* AC Output */}
      <MetricCard
        icon={<Zap className="w-5 h-5" />}
        label="AC Output"
        value={metrics.acOutput}
        unit="W"
        subValue={netPower !== 0 ? `Net: ${netPower > 0 ? '+' : ''}${netPower}W` : 'Balanced'}
        accentColor="blue"
      />
    </div>
  )
}
