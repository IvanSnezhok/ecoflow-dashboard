import { cn } from '@/lib/utils'

interface TechnicalSliderProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  disabled?: boolean
  label?: string
  unit?: string
  showValue?: boolean
  showTicks?: boolean
  tickCount?: number
  accentColor?: 'green' | 'blue' | 'yellow' | 'red' | 'purple'
}

export function TechnicalSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  label,
  unit = '',
  showValue = true,
  showTicks = true,
  tickCount = 5,
  accentColor = 'green',
}: TechnicalSliderProps) {
  const percentage = ((value - min) / (max - min)) * 100

  const colorMap = {
    green: 'bg-energy-green',
    blue: 'bg-energy-blue',
    yellow: 'bg-energy-yellow',
    red: 'bg-energy-red',
    purple: 'bg-energy-purple',
  }

  const borderColorMap = {
    green: 'border-energy-green',
    blue: 'border-energy-blue',
    yellow: 'border-energy-yellow',
    red: 'border-energy-red',
    purple: 'border-energy-purple',
  }

  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const tickValue = min + ((max - min) / (tickCount - 1)) * i
    return Math.round(tickValue)
  })

  return (
    <div className={cn('w-full', disabled && 'opacity-50')}>
      {/* Header with label and value */}
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-2">
          {label && (
            <span className="text-sm font-medium text-foreground">{label}</span>
          )}
          {showValue && (
            <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
              {value}
              {unit && <span className="text-muted-foreground ml-0.5">{unit}</span>}
            </span>
          )}
        </div>
      )}

      {/* Slider track */}
      <div className="relative">
        <div
          className={cn(
            'relative h-3 rounded-sm bg-muted border border-border overflow-hidden',
            disabled && 'pointer-events-none'
          )}
        >
          {/* Grid pattern background */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: 'linear-gradient(to right, currentColor 1px, transparent 1px)',
              backgroundSize: '8px 100%',
            }}
          />

          {/* Progress fill */}
          <div
            className={cn('absolute inset-y-0 left-0 transition-all duration-150', colorMap[accentColor])}
            style={{ width: `${percentage}%` }}
          >
            {/* Diagonal stripes for filled area */}
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)',
              }}
            />
          </div>

          {/* Thumb indicator line */}
          <div
            className={cn(
              'absolute top-0 bottom-0 w-0.5 bg-white shadow-md transition-all duration-150',
              borderColorMap[accentColor]
            )}
            style={{ left: `calc(${percentage}% - 1px)` }}
          />
        </div>

        {/* Invisible range input for interaction */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />

        {/* Tick marks */}
        {showTicks && (
          <div className="flex justify-between mt-1.5 px-0.5">
            {ticks.map((tick, index) => (
              <div key={index} className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-px h-1.5 transition-colors',
                    tick <= value ? colorMap[accentColor] : 'bg-border'
                  )}
                />
                <span className="text-[10px] font-mono text-muted-foreground mt-0.5">
                  {tick}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Min/Max labels if no ticks */}
      {!showTicks && (
        <div className="flex justify-between mt-1">
          <span className="text-[10px] font-mono text-muted-foreground">{min}{unit}</span>
          <span className="text-[10px] font-mono text-muted-foreground">{max}{unit}</span>
        </div>
      )}
    </div>
  )
}
