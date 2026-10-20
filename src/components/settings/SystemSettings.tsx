import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Download, Loader2, RefreshCw, Server, XCircle } from 'lucide-react'
import { api, type UpdateStatus, type VersionInfo } from '@/services/api'
import { useMqtt } from '@/hooks/useMqtt'
import { cn } from '@/lib/utils'

function StatusRow({ label, state, text }: { label: string; state: 'ok' | 'warn' | 'error' | 'checking'; text: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        'inline-flex items-center gap-1.5 font-medium',
        state === 'ok' && 'text-green-600',
        state === 'warn' && 'text-amber-600',
        state === 'error' && 'text-red-500',
        state === 'checking' && 'text-muted-foreground',
      )}>
        {state === 'ok' && <CheckCircle className="w-4 h-4" />}
        {(state === 'warn' || state === 'error') && <XCircle className="w-4 h-4" />}
        {state === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
        {text}
      </span>
    </div>
  )
}

const isUpdating = (status: UpdateStatus | null) =>
  status !== null && status.step !== 'idle' && status.step !== 'completed' && status.step !== 'failed'

/** Connection status (live, not configured values) and the panel's version and updates */
export function SystemSettings() {
  const { wsConnected, mqttConnected } = useMqtt()
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking')
  const [apiError, setApiError] = useState<string | null>(null)

  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  // The device list goes through the EcoFlow cloud, so it shows whether the keys work
  const checkApiConnection = useCallback(async () => {
    setApiStatus('checking')
    setApiError(null)
    try {
      await api.getDevices()
      setApiStatus('connected')
    } catch (err) {
      setApiStatus('error')
      setApiError(err instanceof Error ? err.message : 'Connection failed')
    }
  }, [])

  const checkForUpdates = useCallback(async () => {
    setVersionLoading(true)
    setVersionError(null)
    try {
      const response = await api.getSystemVersion()
      if (response.data.success) {
        setVersionInfo(response.data.data)
      } else {
        setVersionError(response.data.error || 'Failed to check version')
      }
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : 'Failed to check version')
    } finally {
      setVersionLoading(false)
    }
  }, [])

  // Follows the update over SSE until it completes or fails
  const connectToUpdateStream = useCallback(() => {
    eventSourceRef.current?.close()
    const eventSource = new EventSource('/api/system/update/status')
    eventSourceRef.current = eventSource

    eventSource.onmessage = (event) => {
      const status: UpdateStatus = JSON.parse(event.data)
      setUpdateStatus(status)
      if (status.step === 'completed' || status.step === 'failed') {
        eventSource.close()
        eventSourceRef.current = null
        if (status.step === 'completed') setTimeout(() => void checkForUpdates(), 2000)
      }
    }
    eventSource.onerror = () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [checkForUpdates])

  const startUpdate = async () => {
    setShowUpdateConfirm(false)
    try {
      await api.startSystemUpdate()
      connectToUpdateStream()
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : 'Failed to start update')
    }
  }

  useEffect(() => () => eventSourceRef.current?.close(), [])

  useEffect(() => {
    void checkApiConnection()
    void checkForUpdates()
  }, [checkApiConnection, checkForUpdates])

  const updating = isUpdating(updateStatus)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Server className="w-5 h-5" />
        <h3 className="font-semibold">System</h3>
      </div>

      <div className="divide-y divide-border/50">
        <StatusRow
          label="EcoFlow cloud API"
          state={apiStatus === 'connected' ? 'ok' : apiStatus === 'error' ? 'error' : 'checking'}
          text={apiStatus === 'connected' ? 'Connected' : apiStatus === 'error' ? 'Failed' : 'Checking…'}
        />
        {apiError && <p className="py-1.5 text-xs text-red-500">{apiError}</p>}
        <StatusRow label="EcoFlow MQTT" state={mqttConnected ? 'ok' : 'warn'} text={mqttConnected ? 'Live' : 'Reconnecting'} />
        <StatusRow label="Live updates to this browser" state={wsConnected ? 'ok' : 'error'} text={wsConnected ? 'Connected' : 'Offline'} />
        <StatusRow
          label="Version"
          state={versionInfo ? (versionInfo.updateAvailable ? 'warn' : 'ok') : versionLoading ? 'checking' : 'error'}
          text={versionInfo
            ? `v${versionInfo.current} (${versionInfo.currentCommit})${versionInfo.updateAvailable ? ' · update available' : ''}`
            : versionLoading ? 'Checking…' : 'Unknown'}
        />
      </div>

      {versionError && (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <AlertCircle className="w-4 h-4" />
          {versionError}
        </div>
      )}

      {versionInfo?.updateAvailable && versionInfo.latestCommit && (
        <p className="text-xs text-muted-foreground">Latest: {versionInfo.latestCommit}</p>
      )}

      {updating && updateStatus && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{updateStatus.message}</span>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${updateStatus.progress}%` }}
            />
          </div>
        </div>
      )}

      {updateStatus?.step === 'completed' && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <div>
            <p className="text-sm font-medium text-green-500">Update Completed</p>
            <p className="text-xs text-muted-foreground">{updateStatus.message}</p>
          </div>
        </div>
      )}

      {updateStatus?.step === 'failed' && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <XCircle className="w-5 h-5 text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-500">Update Failed</p>
            <p className="text-xs text-muted-foreground">{updateStatus.error || updateStatus.message}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void checkApiConnection()}
          disabled={apiStatus === 'checking'}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-accent disabled:opacity-50 text-sm"
        >
          <RefreshCw className={cn('w-4 h-4', apiStatus === 'checking' && 'animate-spin')} />
          Test connection
        </button>
        <button
          onClick={() => void checkForUpdates()}
          disabled={versionLoading || updating}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-accent disabled:opacity-50 text-sm"
        >
          <RefreshCw className={cn('w-4 h-4', versionLoading && 'animate-spin')} />
          Check for updates
        </button>
        {versionInfo?.updateAvailable && (
          <button
            onClick={() => setShowUpdateConfirm(true)}
            disabled={updating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm"
          >
            <Download className="w-4 h-4" />
            Update now
          </button>
        )}
      </div>

      {showUpdateConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-md mx-4">
            <h4 className="text-lg font-semibold mb-2">Confirm Update</h4>
            <p className="text-sm text-muted-foreground mb-4">
              The dashboard will be unavailable during the update process (approximately 30-60 seconds).
              Your data and settings will be preserved.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowUpdateConfirm(false)}
                className="px-4 py-2 rounded-lg border bg-card hover:bg-accent text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void startUpdate()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
              >
                Start Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
