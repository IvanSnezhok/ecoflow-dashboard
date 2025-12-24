import type { ChartPeriod } from '@/types/device'
import { periodLabels } from './chartConfig'
import { cn } from '@/lib/utils'

interface PeriodSelectorProps {
  value: ChartPeriod
  onChange: (period: ChartPeriod) => void
  className?: string
}

const periods: ChartPeriod[] = ['10m', '1h', '24h', '7d', '30d']

export function PeriodSelector({ value, onChange, className }: PeriodSelectorProps) {
  return (
    <div className={cn('flex gap-1 p-1 bg-muted rounded-lg', className)}>
      {periods.map((period) => (
        <button
          key={period}
          onClick={() => onChange(period)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            value === period
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {periodLabels[period]}
        </button>
      ))}
    </div>
  )
}
