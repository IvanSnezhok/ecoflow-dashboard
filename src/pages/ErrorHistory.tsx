import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Filter,
  CheckCircle,
  Info,
} from 'lucide-react'
import { useDeviceStore } from '@/stores/deviceStore'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { ErrorTooltip } from '@/components/ui/ErrorTooltip'
import { getErrorInfo } from '@/utils/errorCodes'
import type { ErrorHistoryEntry, ErrorType } from '@/types/device'

// Map error types to display names
const ERROR_TYPE_LABELS: Record<ErrorType, string> = {
  bms: 'BMS',
  inv: 'Inverter',
  mppt: 'MPPT',
  overload: 'Overload',
  ems: 'EMS',
  extraBattery1: 'Extra Battery 1',
  extraBattery2: 'Extra Battery 2',
}

// Map error types to tooltip error types
const ERROR_TYPE_TO_TOOLTIP: Record<ErrorType, 'bms' | 'inv' | 'mppt' | 'overload' | 'ems' | 'battery'> = {
  bms: 'bms',
  inv: 'inv',
  mppt: 'mppt',
  overload: 'overload',
  ems: 'ems',
  extraBattery1: 'battery',
  extraBattery2: 'battery',
}

// Color classes for error types
const ERROR_TYPE_COLORS: Record<ErrorType, string> = {
  bms: 'bg-red-500/10 text-red-600 dark:text-red-400',
  inv: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  mppt: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  overload: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ems: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  extraBattery1: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  extraBattery2: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
}

export default function ErrorHistory() {
  const { serialNumber } = useParams<{ serialNumber: string }>()
  const { devices } = useDeviceStore()
  const [errors, setErrors] = useState<ErrorHistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<ErrorType | 'all'>('all')

  const device = devices.find((d) => d.serialNumber === serialNumber)

  const fetchErrors = async () => {
    if (!serialNumber) return

    setIsLoading(true)
    setError(null)
    try {
      const response = await api.getDeviceErrors(serialNumber, 200)
      setErrors(response.data.errors)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch errors')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchErrors()
  }, [serialNumber])

  // Filter errors by type
  const filteredErrors = filterType === 'all'
    ? errors
    : errors.filter((e) => e.errorType === filterType)

  // Get unique error types for filter dropdown
  const uniqueTypes = Array.from(new Set(errors.map((e) => e.errorType)))

  if (!device) {
    return (
      <div className="space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-muted-foreground">Device not found: {serialNumber}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to={`/device/${serialNumber}`}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border hover:bg-accent"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight">
            Event History: {device.name || device.serialNumber}
          </h2>
          <p className="text-muted-foreground">
            {device.deviceType} • Errors and status events
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as ErrorType | 'all')}
            className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">All Types ({errors.length})</option>
            {uniqueTypes.map((type) => (
              <option key={type} value={type}>
                {ERROR_TYPE_LABELS[type]} ({errors.filter((e) => e.errorType === type).length})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={fetchErrors}
          disabled={isLoading}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-lg",
            "text-sm font-medium transition-colors",
            "border hover:bg-accent",
            isLoading && "opacity-50 cursor-not-allowed"
          )}
        >
          <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Content */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
            <p className="text-lg font-medium text-red-500">Error Loading Data</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
            <button
              onClick={fetchErrors}
              className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              Try Again
            </button>
          </div>
        ) : filteredErrors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-lg font-medium">No Events Found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {filterType === 'all'
                ? 'No events have been recorded for this device.'
                : `No ${ERROR_TYPE_LABELS[filterType]} events found.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 text-sm font-semibold text-muted-foreground">
                    Date & Time
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-muted-foreground">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-muted-foreground">
                    Code
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-muted-foreground">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredErrors.map((err, index) => {
                  const tooltipType = ERROR_TYPE_TO_TOOLTIP[err.errorType]
                  const errorInfo = getErrorInfo(tooltipType, err.errorCode)
                  const isInfo = errorInfo.severity === 'info'
                  const isWarning = errorInfo.severity === 'warning'
                  return (
                    <tr
                      key={`${err.timestamp}-${err.errorType}-${err.errorCode}-${index}`}
                      className={cn(
                        "border-b last:border-b-0 hover:bg-muted/20 transition-colors",
                        isInfo && "bg-green-500/5"
                      )}
                    >
                      <td className="px-4 py-3 text-sm font-mono">
                        <div className="flex items-center gap-2">
                          {isInfo ? (
                            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                          ) : isWarning ? (
                            <Info className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          )}
                          {new Date(err.timestamp).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium",
                            isInfo
                              ? "bg-green-500/10 text-green-600 dark:text-green-400"
                              : ERROR_TYPE_COLORS[err.errorType]
                          )}
                        >
                          {isInfo ? 'Status' : ERROR_TYPE_LABELS[err.errorType]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono font-bold">
                        {err.errorCode}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <ErrorTooltip errorCode={err.errorCode} errorType={tooltipType}>
                          <span className={cn(
                            "cursor-help underline underline-offset-2 decoration-dotted",
                            isInfo && "text-green-600 dark:text-green-400"
                          )}>
                            {errorInfo.title}
                          </span>
                        </ErrorTooltip>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary */}
      {!isLoading && !error && errors.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {filteredErrors.length} of {errors.length} events
        </div>
      )}
    </div>
  )
}
