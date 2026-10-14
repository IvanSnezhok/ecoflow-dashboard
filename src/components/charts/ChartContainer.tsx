import { Loader2, RefreshCw, AlertCircle, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChartContainerProps {
  title: string
  icon?: React.ReactNode
  isLoading: boolean
  /** Background refresh in progress (chart stays visible) */
  isFetching?: boolean
  error: string | null
  onRefresh?: () => void
  isEmpty?: boolean
  /** Key numbers shown under the title, e.g. now / peak / energy */
  summary?: React.ReactNode
  /** Short hint explaining how to read the chart */
  hint?: string
  children: React.ReactNode
  className?: string
}

export function ChartContainer({
  title,
  icon,
  isLoading,
  isFetching,
  error,
  onRefresh,
  isEmpty,
  summary,
  hint,
  children,
  className,
}: ChartContainerProps) {
  const busy = isLoading || isFetching

  return (
    <div className={cn(
      'rounded-sm border bg-card overflow-hidden min-w-0',
      className
    )}>
      {/* Header */}
      <div className="px-3 sm:px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {icon || <BarChart3 className="w-4 h-4 text-primary shrink-0" />}
            <span className="text-xs font-semibold uppercase tracking-wider truncate">{title}</span>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className={cn(
                'p-1.5 -m-1 rounded-sm transition-colors shrink-0',
                'hover:bg-muted',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              title="Refresh"
              aria-label="Refresh chart"
            >
              <RefreshCw className={cn(
                'w-3.5 h-3.5 text-muted-foreground',
                busy && 'animate-spin text-primary'
              )} />
            </button>
          )}
        </div>
        {summary && !isEmpty && !error && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
            {summary}
          </div>
        )}
        {hint && (
          <p className="mt-1 text-[10px] text-muted-foreground/80">{hint}</p>
        )}
      </div>

      {/* Content */}
      <div className="p-2 sm:p-4">
        {isLoading && !error && (
          <div className="h-[200px] flex flex-col items-center justify-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
              <Loader2 className="w-8 h-8 animate-spin text-primary relative z-10" />
            </div>
            <p className="text-xs text-muted-foreground mt-3">Loading...</p>
          </div>
        )}

        {error && (
          <div className="h-[200px] flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6 text-destructive" />
            </div>
            <p className="text-sm font-medium text-destructive">Loading error</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[200px] text-center">{error}</p>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="mt-3 text-xs text-primary hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Try again
              </button>
            )}
          </div>
        )}

        {isEmpty && !isLoading && !error && (
          <div className="h-[200px] flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <BarChart3 className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No data</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Data will appear after statistics accumulate</p>
          </div>
        )}

        {!isLoading && !error && !isEmpty && children}
      </div>
    </div>
  )
}

/** One "label value" pair for a chart summary row */
export function SummaryItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="whitespace-nowrap">
      {label} <span className={cn('font-semibold text-foreground', className)}>{value}</span>
    </span>
  )
}
