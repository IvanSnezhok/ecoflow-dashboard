import { useEffect, useState } from 'react'
import { api } from '@/services/api'
import { useDeviceStore } from '@/stores/deviceStore'
import { useSettingsStore, commonTimezones } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, RefreshCw, Wifi, Database, Server, Clock, Globe } from 'lucide-react'

export default function Settings() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking')
  const [apiError, setApiError] = useState<string | null>(null)
  const { devices } = useDeviceStore()
  const { timezone, timeFormat, setTimezone, setTimeFormat } = useSettingsStore()

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

  useEffect(() => {
    checkApiConnection()
  }, [])

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
              <p className="text-sm text-muted-foreground mt-1">1.0.0</p>
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
