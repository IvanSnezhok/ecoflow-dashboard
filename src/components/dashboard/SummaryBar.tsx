import { Battery, Zap, Plug, ArrowDown, ArrowUp } from 'lucide-react'
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

const ACCENT = {
  green: { card: 'border-l-energy-green text-energy-green', icon: 'bg-energy-green/10' },
  blue: { card: 'border-l-energy-blue text-energy-blue', icon: 'bg-energy-blue/10' },
  yellow: { card: 'border-l-energy-yellow text-energy-yellow', icon: 'bg-energy-yellow/10' },
  red: { card: 'border-l-energy-red text-energy-red', icon: 'bg-energy-red/10' },
  purple: { card: 'border-l-energy-purple text-energy-purple', icon: 'bg-energy-purple/10' },
}

function MetricCard({ icon, label, value, unit, subValue, accentColor, trend }: MetricCardProps) {
  return (
    <div className={cn(
      'flex items-center gap-3 px-3 sm:px-4 py-3 bg-card rounded-sm border border-border border-l-4 min-w-0',
      ACCENT[accentColor].card
    )}>
      <div className={cn('hidden sm:block p-2 rounded-sm', ACCENT[accentColor].icon)}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-lg sm:text-xl font-mono font-bold tabular-nums text-foreground">
            {value.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">{unit}</span>
          {trend && trend !== 'neutral' && (
            <span className={trend === 'up' ? 'text-energy-green' : 'text-energy-red'}>
              {trend === 'up' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            </span>
          )}
        </div>
        {subValue && (
          <p className="text-[10px] text-muted-foreground truncate">{subValue}</p>
        )}
      </div>
    </div>
  )
}

/** Totals across devices; with one device they would repeat its card, so it is hidden */
export function SummaryBar() {
  const devices = useDeviceStore((s) => s.devices)
  const reporting = devices.filter((device) => device.state)
  if (reporting.length < 2) return null

  let socSum = 0
  let acInput = 0
  let solarInput = 0
  let acOutput = 0
  for (const device of reporting) {
    const state = device.state!
    socSum += state.batterySoc
    acInput += state.acInputWatts || 0
    solarInput += state.solarInputWatts || 0
    acOutput += state.acOutputWatts || 0
  }

  const avgSoc = Math.round(socSum / reporting.length)
  const totalInput = acInput + solarInput
  const netPower = totalInput - acOutput
  const inputParts = [acInput > 0 && `AC ${acInput} W`, solarInput > 0 && `Solar ${solarInput} W`].filter(Boolean)

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <MetricCard
        icon={<Battery className="w-5 h-5" />}
        label="Battery"
        value={avgSoc}
        unit="%"
        subValue={`avg of ${reporting.length} devices`}
        accentColor={avgSoc <= 20 ? 'red' : avgSoc <= 40 ? 'yellow' : 'green'}
        trend={netPower > 0 ? 'up' : netPower < 0 ? 'down' : 'neutral'}
      />
      <MetricCard
        icon={<Plug className="w-5 h-5" />}
        label="Input"
        value={totalInput}
        unit="W"
        subValue={inputParts.length ? inputParts.join(' · ') : 'Not charging'}
        accentColor="purple"
      />
      <MetricCard
        icon={<Zap className="w-5 h-5" />}
        label="AC Output"
        value={acOutput}
        unit="W"
        subValue={netPower !== 0 ? `Net ${netPower > 0 ? '+' : ''}${netPower} W` : 'Balanced'}
        accentColor="blue"
      />
    </div>
  )
}
