import { cn } from '@/lib/utils'

interface BatteryGaugeProps {
  soc: number
  isCharging?: boolean
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

export function BatteryGauge({
  soc,
  isCharging = false,
  size = 'md',
  showLabel = true
}: BatteryGaugeProps) {
  const config = {
    sm: { width: 64, height: 64, strokeWidth: 5, radius: 26, fontSize: 'text-sm', labelSize: 'text-[10px]' },
    md: { width: 96, height: 96, strokeWidth: 6, radius: 40, fontSize: 'text-xl', labelSize: 'text-xs' },
    lg: { width: 128, height: 128, strokeWidth: 8, radius: 54, fontSize: 'text-3xl', labelSize: 'text-sm' },
  }

  const { width, height, strokeWidth, radius, fontSize, labelSize } = config[size]
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (soc / 100) * circumference

  // Color based on charge level with gradient IDs
  const getColorConfig = () => {
    if (soc <= 20) return {
      color: 'rgb(239, 68, 68)',
      glow: 'rgba(239, 68, 68, 0.4)',
      gradient: ['#ef4444', '#dc2626']
    }
    if (soc <= 40) return {
      color: 'rgb(249, 115, 22)',
      glow: 'rgba(249, 115, 22, 0.4)',
      gradient: ['#f97316', '#ea580c']
    }
    if (soc <= 60) return {
      color: 'rgb(234, 179, 8)',
      glow: 'rgba(234, 179, 8, 0.4)',
      gradient: ['#eab308', '#ca8a04']
    }
    return {
      color: 'rgb(34, 197, 94)',
      glow: 'rgba(34, 197, 94, 0.5)',
      gradient: ['#22c55e', '#16a34a']
    }
  }

  const { color, glow, gradient } = getColorConfig()
  const gradientId = `battery-gradient-${size}-${soc}`

  return (
    <div
      className={cn(
        'relative flex items-center justify-center transition-transform duration-300',
        isCharging && 'scale-[1.02]'
      )}
      style={{ width, height }}
    >
      {/* Glow effect for charging */}
      {isCharging && (
        <div
          className="absolute inset-0 rounded-full blur-xl opacity-60 animate-pulse"
          style={{ backgroundColor: glow }}
        />
      )}

      <svg
        className="transform -rotate-90 w-full h-full relative z-10"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradient[0]} />
            <stop offset="100%" stopColor={gradient[1]} />
          </linearGradient>
          {isCharging && (
            <filter id={`glow-${gradientId}`}>
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          )}
        </defs>

        {/* Background track */}
        <circle
          className="text-muted/30"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx={width / 2}
          cy={height / 2}
        />

        {/* Progress arc */}
        <circle
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          stroke={`url(#${gradientId})`}
          fill="transparent"
          r={radius}
          cx={width / 2}
          cy={height / 2}
          filter={isCharging ? `url(#glow-${gradientId})` : undefined}
          className="transition-all duration-700 ease-out"
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
        <span
          className={cn(
            'font-bold tracking-tight transition-colors duration-300',
            fontSize
          )}
          style={{ color }}
        >
          {soc}%
        </span>
        {showLabel && isCharging && (
          <span
            className={cn(
              'font-medium tracking-wide uppercase mt-0.5',
              labelSize
            )}
            style={{ color }}
          >
            <span className="inline-flex items-center gap-1">
              <svg
                className="w-2.5 h-2.5 animate-pulse"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              Charging
            </span>
          </span>
        )}
      </div>
    </div>
  )
}
