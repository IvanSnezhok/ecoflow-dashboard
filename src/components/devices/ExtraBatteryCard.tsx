import { Thermometer, Zap, RefreshCw, Heart, Activity, AlertTriangle } from 'lucide-react'
import { BatteryGauge } from './BatteryGauge'
import { ErrorTooltip } from '@/components/ui/ErrorTooltip'
import { cn } from '@/lib/utils'
import type { ExtraBatteryState } from '@/types/device'

interface ExtraBatteryCardProps {
  battery: ExtraBatteryState
  index: number
}

function StatItem({
  icon,
  label,
  value,
  unit,
  colorClass
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  unit?: string
  colorClass: string
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn('p-1 rounded', colorClass)}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
          {label}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {value}
          {unit && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
        </span>
      </div>
    </div>
  )
}

export function ExtraBatteryCard({ battery, index }: ExtraBatteryCardProps) {
  const isCharging = battery.inputWatts > battery.outputWatts
  const healthColor = battery.soh >= 90 ? 'text-green-500' : battery.soh >= 70 ? 'text-yellow-500' : 'text-orange-500'

  return (
    <div className={cn(
      'rounded-xl border bg-card overflow-hidden',
      'transition-all duration-300',
      'hover:shadow-lg hover:border-primary/20'
    )}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <span className="text-sm font-bold text-primary">{index}</span>
          </div>
          <div>
            <h4 className="font-medium text-sm">Extra Battery {index}</h4>
            <p className="text-[10px] text-muted-foreground">{battery.cycles} cycles</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {battery.errCode !== undefined && battery.errCode !== 0 && (
            <ErrorTooltip errorCode={battery.errCode} errorType="battery">
              <span className={cn(
                'text-[10px] font-medium px-2 py-1 rounded-full uppercase tracking-wider',
                'bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-1'
              )}>
                <AlertTriangle className="w-3 h-3" />
                Error {battery.errCode}
              </span>
            </ErrorTooltip>
          )}
          <span className={cn(
            'text-[10px] font-medium px-2 py-1 rounded-full uppercase tracking-wider',
            'bg-green-500/10 text-green-600 dark:text-green-400'
          )}>
            Connected
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="p-4">
        <div className="flex items-center gap-4">
          {/* Battery gauge */}
          <BatteryGauge soc={battery.soc} isCharging={isCharging} size="sm" showLabel={false} />

          {/* Stats grid */}
          <div className="flex-1 grid grid-cols-2 gap-2.5">
            <StatItem
              icon={<Zap className="w-3 h-3 text-amber-500" />}
              label="Input"
              value={battery.inputWatts}
              unit="W"
              colorClass="bg-amber-500/10"
            />
            <StatItem
              icon={<Activity className="w-3 h-3 text-blue-500" />}
              label="Output"
              value={battery.outputWatts}
              unit="W"
              colorClass="bg-blue-500/10"
            />
            <StatItem
              icon={<Thermometer className="w-3 h-3 text-orange-500" />}
              label="Temp"
              value={battery.temp}
              unit="°C"
              colorClass="bg-orange-500/10"
            />
            <StatItem
              icon={<RefreshCw className="w-3 h-3 text-purple-500" />}
              label="Cycles"
              value={battery.cycles}
              colorClass="bg-purple-500/10"
            />
          </div>
        </div>
      </div>

      {/* Footer with health & voltage */}
      <div className="px-4 py-2.5 bg-muted/30 flex items-center justify-between text-xs border-t border-border/50">
        <div className="flex items-center gap-1.5">
          <Heart className={cn('w-3.5 h-3.5', healthColor)} />
          <span className="text-muted-foreground">Health:</span>
          <span className={cn('font-semibold', healthColor)}>{battery.soh}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-cyan-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span className="text-muted-foreground">Voltage:</span>
          <span className="font-semibold">{(battery.vol / 1000).toFixed(1)}V</span>
        </div>
      </div>
    </div>
  )
}
