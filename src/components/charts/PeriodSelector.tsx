import type { ChartPeriod } from '@/types/device'
import { periodLabels, periodShortLabels } from './chartConfig'
import { cn } from '@/lib/utils'

interface PeriodSelectorProps {
  value: ChartPeriod
  onChange: (period: ChartPeriod) => void
  className?: string
}

const periods: ChartPeriod[] = ['10m', '1h', '24h', '7d', '30d']

export function PeriodSelector({ value, onChange, className }: PeriodSelectorProps) {
  return (
    <div className={cn('flex gap-0.5 p-0.5 bg-muted border border-border rounded-sm', className)}>
      {periods.map((period) => (
        <button
          key={period}
          onClick={() => onChange(period)}
          className={cn(
            'flex-1 sm:flex-none px-2 py-1.5 sm:py-1 text-[10px] font-mono font-medium rounded-sm transition-colors uppercase tracking-wider whitespace-nowrap',
            value === period
              ? 'bg-card text-foreground border border-border'
              : 'text-muted-foreground hover:text-foreground border border-transparent'
          )}
        >
          <span className="sm:hidden">{periodShortLabels[period]}</span>
          <span className="hidden sm:inline">{periodLabels[period]}</span>
        </button>
      ))}
    </div>
  )
}
