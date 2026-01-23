import { cn } from '@/lib/utils'

interface TechnicalToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  description?: string
  size?: 'sm' | 'md' | 'lg'
}

export function TechnicalToggle({
  checked,
  onChange,
  disabled = false,
  label,
  description,
  size = 'md',
}: TechnicalToggleProps) {
  const sizeConfig = {
    sm: { track: 'w-10 h-5', thumb: 'w-4 h-4', translate: 'translate-x-[18px]' },
    md: { track: 'w-12 h-6', thumb: 'w-5 h-5', translate: 'translate-x-[22px]' },
    lg: { track: 'w-14 h-7', thumb: 'w-6 h-6', translate: 'translate-x-[26px]' },
  }

  const { track, thumb, translate } = sizeConfig[size]

  return (
    <label
      className={cn(
        'flex items-center gap-3 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          // Technical rectangular style (not pill)
          'relative inline-flex items-center rounded-sm transition-all duration-200',
          'border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          track,
          checked
            ? 'bg-energy-green border-energy-green'
            : 'bg-muted border-border hover:border-muted-foreground/50',
          disabled && 'pointer-events-none'
        )}
      >
        {/* Grid pattern inside track */}
        <div
          className={cn(
            'absolute inset-0 opacity-20 rounded-[1px]',
            'bg-[linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)]',
            'bg-[size:4px_4px]'
          )}
        />

        {/* Thumb - rectangular technical style */}
        <span
          className={cn(
            'absolute left-0.5 rounded-[2px] bg-white shadow-sm transition-transform duration-200',
            'border border-border/50',
            thumb,
            checked && translate
          )}
        >
          {/* Indicator lines on thumb */}
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              className={cn(
                'w-[2px] h-2/3 rounded-full transition-colors',
                checked ? 'bg-energy-green' : 'bg-muted-foreground/30'
              )}
            />
          </span>
        </span>

        {/* ON/OFF indicators */}
        <span
          className={cn(
            'absolute left-1.5 text-[8px] font-mono font-bold uppercase transition-opacity',
            checked ? 'opacity-100 text-white' : 'opacity-0'
          )}
        >
          ON
        </span>
        <span
          className={cn(
            'absolute right-1.5 text-[9px] font-mono font-bold uppercase transition-opacity',
            !checked ? 'opacity-100 text-slate-500' : 'opacity-0'
          )}
        >
          OFF
        </span>
      </button>

      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-medium text-foreground">{label}</span>
          )}
          {description && (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </div>
      )}
    </label>
  )
}
