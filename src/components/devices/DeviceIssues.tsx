import { AlertTriangle, CheckCircle2, AlertOctagon } from 'lucide-react'
import { ErrorTooltip } from '@/components/ui/ErrorTooltip'
import { cn } from '@/lib/utils'
import { highestSeverity, type DeviceIssue } from '@/utils/errorCodes'

interface DeviceIssuesProps {
  issues: DeviceIssue[]
  /** Shown next to the title, e.g. when last-known errors were recorded */
  subtitle?: string
  title?: string
}

const ISSUE_STYLES = {
  error: {
    panel: 'border-red-500/50 bg-red-500/10',
    title: 'text-red-600 dark:text-red-400',
    item: 'bg-red-500/10',
    label: 'text-red-500',
  },
  warning: {
    panel: 'border-amber-500/50 bg-amber-500/10',
    title: 'text-amber-600 dark:text-amber-400',
    item: 'bg-amber-500/10',
    label: 'text-amber-600 dark:text-amber-400',
  },
}

/**
 * Warnings and errors get a banner; status codes such as "fully charged" or
 * "charged to your limit" are shown as small green chips instead of an alarm.
 */
export function DeviceIssues({ issues, subtitle, title }: DeviceIssuesProps) {
  const problems = issues.filter((issue) => issue.info.severity !== 'info')
  const statuses = issues.filter((issue) => issue.info.severity === 'info')
  const severity = highestSeverity(problems)

  return (
    <>
      {severity && severity !== 'info' && (
        <div className={cn('rounded-sm border p-3 sm:p-4', ISSUE_STYLES[severity].panel)}>
          <h3 className={cn('font-semibold flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-3 text-sm', ISSUE_STYLES[severity].title)}>
            {severity === 'error' ? <AlertOctagon className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {title ?? (severity === 'error' ? 'Device errors' : 'Device warnings')}
            <span className="text-[11px] font-normal text-muted-foreground">
              {subtitle ?? 'tap or hover an item for details'}
            </span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {problems.map((issue) => {
              const style = ISSUE_STYLES[issue.info.severity === 'error' ? 'error' : 'warning']
              return (
                <ErrorTooltip key={issue.key} errorCode={issue.code} errorType={issue.type}>
                  <div className={cn('flex flex-col text-sm rounded-sm px-3 py-2 text-left', style.item)}>
                    <span className="flex items-center gap-2">
                      <span className={cn('font-medium', style.label)}>{issue.source}:</span>
                      <span className="font-mono text-xs">{issue.value}</span>
                    </span>
                    <span className="text-xs text-foreground/80">{issue.info.title}</span>
                  </div>
                </ErrorTooltip>
              )
            })}
          </div>
        </div>
      )}

      {statuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {statuses.map((issue) => (
            <ErrorTooltip key={issue.key} errorCode={issue.code} errorType={issue.type}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {issue.source}: {issue.info.title}
              </span>
            </ErrorTooltip>
          ))}
        </div>
      )}
    </>
  )
}
