import { cn } from '@/lib/utils'
import { Zap } from 'lucide-react'

interface BatteryBarProps {
  soc: number
  isCharging?: boolean
  isDischarging?: boolean
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  showPercentage?: boolean
  className?: string
}

export function BatteryBar({
  soc,
  isCharging = false,
  isDischarging = false,
  size = 'md',
  showLabel = true,
  showPercentage = true,
  className,
}: BatteryBarProps) {
  const sizeConfig = {
    sm: { height: 'h-4', text: 'text-xs', icon: 'w-3 h-3' },
    md: { height: 'h-6', text: 'text-sm', icon: 'w-4 h-4' },
    lg: { height: 'h-8', text: 'text-base', icon: 'w-5 h-5' },
  }

  const { height, text, icon } = sizeConfig[size]

  // Color based on charge level
  const getColor = () => {
    if (soc <= 20) return { bg: 'bg-energy-red', text: 'text-energy-red' }
    if (soc <= 40) return { bg: 'bg-energy-yellow', text: 'text-energy-yellow' }
    return { bg: 'bg-energy-green', text: 'text-energy-green' }
  }

  const color = getColor()

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Battery container */}
      <div className="relative flex-1">
        {/* Battery body */}
        <div
          className={cn(
            'relative rounded-sm border-2 border-border bg-muted/30 overflow-hidden',
            height,
            isCharging && 'border-energy-green/50'
          )}
        >
          {/* Grid pattern background */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: 'linear-gradient(to right, currentColor 1px, transparent 1px)',
              backgroundSize: '10% 100%',
            }}
          />

          {/* Fill bar */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-all duration-500 ease-out',
              color.bg,
              isCharging && 'animate-pulse'
            )}
            style={{ width: `${soc}%` }}
          >
            {/* Diagonal stripes pattern */}
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)',
              }}
            />
          </div>

          {/* Segment lines (10% markers) */}
          <div className="absolute inset-0 flex">
            {[...Array(9)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-border/30 last:border-r-0"
              />
            ))}
          </div>

          {/* Percentage inside bar for larger sizes */}
          {size === 'lg' && showPercentage && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono font-bold text-white drop-shadow-sm">
                {soc}%
              </span>
            </div>
          )}
        </div>

        {/* Battery terminal */}
        <div
          className={cn(
            'absolute right-0 top-1/2 -translate-y-1/2 translate-x-full',
            'w-1.5 rounded-r-sm border-2 border-l-0 border-border bg-muted',
            size === 'sm' ? 'h-2' : size === 'md' ? 'h-3' : 'h-4'
          )}
        />
      </div>

      {/* Status area */}
      <div className={cn('flex items-center gap-2 min-w-[80px]', text)}>
        {/* Charging indicator */}
        {isCharging && (
          <Zap className={cn(icon, 'text-energy-green animate-pulse')} fill="currentColor" />
        )}

        {/* Percentage display */}
        {showPercentage && size !== 'lg' && (
          <span className={cn('font-mono font-bold tabular-nums', color.text)}>
            {soc}%
          </span>
        )}

        {/* Status label */}
        {showLabel && (
          <span className="text-muted-foreground text-xs uppercase tracking-wider">
            {isCharging ? 'CHG' : isDischarging ? 'DSC' : 'IDLE'}
          </span>
        )}
      </div>
    </div>
  )
}

// Compact version for lists/cards
interface BatteryBarCompactProps {
  soc: number
  isCharging?: boolean
  className?: string
}

export function BatteryBarCompact({
  soc,
  isCharging = false,
  className,
}: BatteryBarCompactProps) {
  const getColor = () => {
    if (soc <= 20) return 'bg-energy-red'
    if (soc <= 40) return 'bg-energy-yellow'
    return 'bg-energy-green'
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative flex-1 h-2 rounded-sm bg-muted border border-border overflow-hidden">
        <div
          className={cn(
            'absolute inset-y-0 left-0 transition-all duration-300',
            getColor(),
            isCharging && 'animate-pulse'
          )}
          style={{ width: `${soc}%` }}
        />
      </div>
      <span className="font-mono text-xs font-semibold tabular-nums w-8 text-right">
        {soc}%
      </span>
      {isCharging && (
        <Zap className="w-3 h-3 text-energy-green" fill="currentColor" />
      )}
    </div>
  )
}
