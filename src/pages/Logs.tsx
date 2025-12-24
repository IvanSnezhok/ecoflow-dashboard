import { useEffect, useState } from 'react'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { RefreshCw, Filter, CheckCircle, XCircle, Info } from 'lucide-react'

interface LogEntry {
  id: number
  device_id: number | null
  operation_type: string
  operation_name: string
  request_payload: string | null
  response_payload: string | null
  success: number
  error_message: string | null
  timestamp: string
  device_name?: string
  serial_number?: string
}

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const fetchLogs = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await api.getLogs({ limit: 100 })
      setLogs(response.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [])

  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true
    if (filter === 'success') return log.success === 1
    if (filter === 'error') return log.success === 0
    return log.operation_type === filter
  })

  const getStatusIcon = (success: number) => {
    return success === 1 ? (
      <CheckCircle className="w-4 h-4 text-green-500" />
    ) : (
      <XCircle className="w-4 h-4 text-red-500" />
    )
  }

  const getOperationTypeColor = (type: string) => {
    switch (type) {
      case 'COMMAND':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
      case 'API_CALL':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
      case 'MQTT':
        return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Operation Logs</h2>
          <p className="text-muted-foreground">
            View all device operations and state changes
          </p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <div className="flex gap-2">
          {['all', 'success', 'error', 'COMMAND', 'API_CALL', 'MQTT'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1 rounded-full text-sm font-medium transition-colors',
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-accent'
              )}
            >
              {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Logs Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {error ? (
          <div className="p-6 text-center">
            <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-500">{error}</p>
          </div>
        ) : isLoading ? (
          <div className="p-6 text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">Loading logs...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-6 text-center">
            <Info className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">
              {logs.length === 0
                ? 'No logs yet. Operations will be logged as you use the dashboard.'
                : 'No logs match the current filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Time
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Operation
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Device
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      {getStatusIcon(log.success)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'px-2 py-1 rounded-full text-xs font-medium',
                          getOperationTypeColor(log.operation_type)
                        )}
                      >
                        {log.operation_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {log.operation_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {log.device_name || log.serial_number || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {log.success === 0 && log.error_message ? (
                        <span className="text-red-500">{log.error_message}</span>
                      ) : log.response_payload ? (
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {log.response_payload.length > 50
                            ? log.response_payload.substring(0, 50) + '...'
                            : log.response_payload}
                        </code>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
