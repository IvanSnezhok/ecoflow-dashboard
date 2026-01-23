import { useState, useCallback } from 'react'
import { Calendar, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import type { ChartPeriod, DateRange } from '@/types/device'
import { periodLabels } from './chartConfig'
import { cn } from '@/lib/utils'

interface DateRangePickerProps {
  period: ChartPeriod
  customRange: DateRange | null
  onPeriodChange: (period: ChartPeriod) => void
  onCustomRangeChange: (range: DateRange) => void
  className?: string
}

const presetPeriods: ChartPeriod[] = ['10m', '1h', '24h', '7d', '30d']

// Format date for datetime-local input
function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Parse datetime-local string to Date
function fromLocalDateTimeString(str: string): Date {
  return new Date(str)
}

export function DateRangePicker({
  period,
  customRange,
  onPeriodChange,
  onCustomRangeChange,
  className,
}: DateRangePickerProps) {
  const [isExpanded, setIsExpanded] = useState(period === 'custom')
  const [localFrom, setLocalFrom] = useState(() => {
    if (customRange) {
      return toLocalDateTimeString(new Date(customRange.from))
    }
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    return toLocalDateTimeString(yesterday)
  })
  const [localTo, setLocalTo] = useState(() => {
    if (customRange) {
      return toLocalDateTimeString(new Date(customRange.to))
    }
    return toLocalDateTimeString(new Date())
  })

  const handlePresetClick = useCallback((p: ChartPeriod) => {
    setIsExpanded(false)
    onPeriodChange(p)
  }, [onPeriodChange])

  const handleCustomClick = useCallback(() => {
    if (!isExpanded) {
      // Auto-apply default range (last 24 hours) when opening custom picker
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      onCustomRangeChange({
        from: yesterday.toISOString(),
        to: now.toISOString(),
      })
      onPeriodChange('custom')
    }
    setIsExpanded(!isExpanded)
  }, [isExpanded, onPeriodChange, onCustomRangeChange])

  const handleApplyCustomRange = useCallback(() => {
    const from = fromLocalDateTimeString(localFrom)
    const to = fromLocalDateTimeString(localTo)

    if (from >= to) {
      alert('Start date must be before end date')
      return
    }

    onCustomRangeChange({
      from: from.toISOString(),
      to: to.toISOString(),
    })
  }, [localFrom, localTo, onCustomRangeChange])

  // Quick presets for custom range
  const applyQuickRange = useCallback((hours: number) => {
    const now = new Date()
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000)
    setLocalFrom(toLocalDateTimeString(from))
    setLocalTo(toLocalDateTimeString(now))
  }, [])

  return (
    <div className={cn('space-y-3', className)}>
      {/* Preset buttons row */}
      <div className="flex flex-wrap gap-1">
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          {presetPeriods.map((p) => (
            <button
              key={p}
              onClick={() => handlePresetClick(p)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                period === p && !isExpanded
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>

        <button
          onClick={handleCustomClick}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
            period === 'custom'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          )}
        >
          <Calendar className="w-4 h-4" />
          Custom
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Expanded custom range picker */}
      {isExpanded && (
        <div className="p-4 rounded-xl border bg-card space-y-4">
          {/* Quick range buttons */}
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-muted-foreground mr-2">Quick:</span>
            {[
              { label: '2h', hours: 2 },
              { label: '6h', hours: 6 },
              { label: '12h', hours: 12 },
              { label: '48h', hours: 48 },
              { label: '3d', hours: 72 },
              { label: '14d', hours: 336 },
            ].map(({ label, hours }) => (
              <button
                key={label}
                onClick={() => applyQuickRange(hours)}
                className="px-2 py-1 text-xs font-medium rounded bg-muted hover:bg-muted/80 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Date/time inputs */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Clock className="w-4 h-4 text-muted-foreground" />
                Start Date & Time
              </label>
              <input
                type="datetime-local"
                value={localFrom}
                onChange={(e) => setLocalFrom(e.target.value)}
                className={cn(
                  'w-full px-3 py-2 rounded-lg border bg-background',
                  'text-sm font-mono',
                  'focus:outline-none focus:ring-2 focus:ring-primary/50'
                )}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Clock className="w-4 h-4 text-muted-foreground" />
                End Date & Time
              </label>
              <input
                type="datetime-local"
                value={localTo}
                onChange={(e) => setLocalTo(e.target.value)}
                max={toLocalDateTimeString(new Date())}
                className={cn(
                  'w-full px-3 py-2 rounded-lg border bg-background',
                  'text-sm font-mono',
                  'focus:outline-none focus:ring-2 focus:ring-primary/50'
                )}
              />
            </div>
          </div>

          {/* Current selection display */}
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
            Selected: {new Date(localFrom).toLocaleString()} — {new Date(localTo).toLocaleString()}
            <span className="ml-2">
              ({Math.round((new Date(localTo).getTime() - new Date(localFrom).getTime()) / (1000 * 60 * 60))} hours)
            </span>
          </div>

          {/* Apply button */}
          <button
            onClick={handleApplyCustomRange}
            className={cn(
              'w-full sm:w-auto px-4 py-2 rounded-lg',
              'bg-primary text-primary-foreground font-medium',
              'hover:bg-primary/90 transition-colors'
            )}
          >
            Apply Custom Range
          </button>
        </div>
      )}
    </div>
  )
}
