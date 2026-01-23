import { useEffect, useState, useRef, useCallback } from 'react'
import { api, VersionInfo, UpdateStatus } from '@/services/api'
import { useDeviceStore } from '@/stores/deviceStore'
import { useSettingsStore, commonTimezones } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, RefreshCw, Wifi, Database, Server, Clock, Globe, Download, AlertCircle, Loader2 } from 'lucide-react'
import { SlackSettings } from '@/components/automation/SlackSettings'

export default function Settings() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking')
  const [apiError, setApiError] = useState<string | null>(null)
  const { devices } = useDeviceStore()
  const { timezone, timeFormat, setTimezone, setTimeFormat } = useSettingsStore()

  // System update state
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  const checkApiConnection = async () => {
    setApiStatus('checking')
    setApiError(null)
    try {
      await api.getDevices()
      setApiStatus('connected')
    } catch (err) {
      setApiStatus('error')
      setApiError(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  // Check for updates on mount
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

  // Start update process
  const startUpdate = async () => {
    setShowUpdateConfirm(false)
    try {
      await api.startSystemUpdate()
      // Start listening for SSE updates
      connectToUpdateStream()
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : 'Failed to start update')
    }
  }

  // Connect to SSE stream for update status
  const connectToUpdateStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const eventSource = new EventSource('/api/system/update/status')
    eventSourceRef.current = eventSource

    eventSource.onmessage = (event) => {
      const status: UpdateStatus = JSON.parse(event.data)
      setUpdateStatus(status)

      // If update completed or failed, close the connection
      if (status.step === 'completed' || status.step === 'failed') {
        eventSource.close()
        eventSourceRef.current = null
        // Refresh version info after update
        if (status.step === 'completed') {
          setTimeout(() => {
            checkForUpdates()
          }, 2000)
        }
      }
    }

    eventSource.onerror = () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [checkForUpdates])

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    checkApiConnection()
    checkForUpdates()
  }, [checkForUpdates])

  const getStatusColor = (status: 'checking' | 'connected' | 'error') => {
    switch (status) {
      case 'connected':
        return 'text-green-500'
      case 'error':
        return 'text-red-500'
      default:
        return 'text-yellow-500'
    }
  }

  const getStatusIcon = (status: 'checking' | 'connected' | 'error') => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />
      default:
        return <RefreshCw className="w-5 h-5 text-yellow-500 animate-spin" />
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Configure your Ecoflow Dashboard
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* API Configuration */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-5 h-5" />
            <h3 className="font-semibold">API Configuration</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">API Endpoint</label>
              <p className="text-sm text-muted-foreground mt-1">
                api-e.ecoflow.com (Europe)
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Connection Status</label>
              <div className="flex items-center gap-2 mt-1">
                {getStatusIcon(apiStatus)}
                <span className={cn('text-sm font-medium', getStatusColor(apiStatus))}>
                  {apiStatus === 'checking' && 'Checking connection...'}
                  {apiStatus === 'connected' && 'Connected'}
                  {apiStatus === 'error' && 'Connection failed'}
                </span>
              </div>
              {apiError && (
                <p className="text-xs text-red-500 mt-1">{apiError}</p>
              )}
            </div>
            <button
              onClick={checkApiConnection}
              disabled={apiStatus === 'checking'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-accent disabled:opacity-50 text-sm"
            >
              <RefreshCw className={cn('w-4 h-4', apiStatus === 'checking' && 'animate-spin')} />
              Test Connection
            </button>
          </div>
        </div>

        {/* MQTT Status */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wifi className="w-5 h-5" />
            <h3 className="font-semibold">MQTT Real-time Updates</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">MQTT Broker</label>
              <p className="text-sm text-muted-foreground mt-1">
                mqtt-e.ecoflow.com:8883
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <div className="flex items-center gap-2 mt-1">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-sm font-medium text-green-500">
                  Live
                </span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Subscribed Devices</label>
              <p className="text-sm text-muted-foreground mt-1">
                {devices.length} device(s)
              </p>
            </div>
          </div>
        </div>

        {/* Time Settings */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5" />
            <h3 className="font-semibold">Time Settings</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-2 w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {commonTimezones.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Current: {new Date().toLocaleString('en-US', { timeZone: timezone, timeZoneName: 'short' })}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Time Format</label>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setTimeFormat('24h')}
                  className={cn(
                    'flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                    timeFormat === '24h'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card hover:bg-accent'
                  )}
                >
                  24-hour (14:30)
                </button>
                <button
                  onClick={() => setTimeFormat('12h')}
                  className={cn(
                    'flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                    timeFormat === '12h'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card hover:bg-accent'
                  )}
                >
                  12-hour (2:30 PM)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Slack Integration */}
        <div className="rounded-lg border bg-card p-6 md:col-span-2">
          <SlackSettings />
        </div>

        {/* Database Info */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-5 h-5" />
            <h3 className="font-semibold">Database</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Type</label>
              <p className="text-sm text-muted-foreground mt-1">
                SQLite (better-sqlite3)
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Location</label>
              <p className="text-sm text-muted-foreground mt-1">
                server/data/ecoflow.db
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Log Retention</label>
              <p className="text-sm text-muted-foreground mt-1">
                30 days (automatic cleanup)
              </p>
            </div>
          </div>
        </div>

        {/* System Update */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Download className="w-5 h-5" />
            <h3 className="font-semibold">System Update</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Current Version</label>
              <p className="text-sm text-muted-foreground mt-1">
                {versionInfo ? (
                  <>
                    v{versionInfo.current} ({versionInfo.currentCommit})
                  </>
                ) : versionLoading ? (
                  'Loading...'
                ) : (
                  'Unknown'
                )}
              </p>
            </div>

            {versionError && (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="w-4 h-4" />
                {versionError}
              </div>
            )}

            {versionInfo?.updateAvailable && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <AlertCircle className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-blue-500">Update Available</p>
                  <p className="text-xs text-muted-foreground">
                    Latest: {versionInfo.latestCommit}
                  </p>
                </div>
              </div>
            )}

            {versionInfo && !versionInfo.updateAvailable && !versionInfo.error && (
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle className="w-4 h-4" />
                Up to date
              </div>
            )}

            {/* Update Progress */}
            {updateStatus && updateStatus.step !== 'idle' && updateStatus.step !== 'completed' && updateStatus.step !== 'failed' && (
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
                  <p className="text-xs text-muted-foreground">
                    {updateStatus.message}
                  </p>
                </div>
              </div>
            )}

            {updateStatus?.step === 'failed' && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <XCircle className="w-5 h-5 text-red-500" />
                <div>
                  <p className="text-sm font-medium text-red-500">Update Failed</p>
                  <p className="text-xs text-muted-foreground">
                    {updateStatus.error || updateStatus.message}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={checkForUpdates}
                disabled={versionLoading || (updateStatus?.step !== 'idle' && updateStatus?.step !== 'completed' && updateStatus?.step !== 'failed' && updateStatus !== null)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-accent disabled:opacity-50 text-sm"
              >
                <RefreshCw className={cn('w-4 h-4', versionLoading && 'animate-spin')} />
                Check for Updates
              </button>

              {versionInfo?.updateAvailable && (
                <button
                  onClick={() => setShowUpdateConfirm(true)}
                  disabled={updateStatus?.step !== 'idle' && updateStatus?.step !== 'completed' && updateStatus?.step !== 'failed' && updateStatus !== null}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm"
                >
                  <Download className="w-4 h-4" />
                  Update Now
                </button>
              )}
            </div>

            {/* Update Confirmation Modal */}
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
                      onClick={startUpdate}
                      className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
                    >
                      Start Update
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* About */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none"/>
            </svg>
            <h3 className="font-semibold">About</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Version</label>
              <p className="text-sm text-muted-foreground mt-1">
                {versionInfo ? `v${versionInfo.current}` : '1.0.0'}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Tech Stack</label>
              <p className="text-sm text-muted-foreground mt-1">
                React + TypeScript + Express + SQLite
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">API Documentation</label>
              <a
                href="https://developer.ecoflow.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline mt-1 block"
              >
                developer.ecoflow.com
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
