import { useState, useEffect } from 'react'
import { MessageSquare, Save, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import type { SlackSettings as SlackSettingsType, UpdateSlackSettingsDto } from '@/types/automation'

export function SlackSettings() {
  const [, setSettings] = useState<SlackSettingsType | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [webhookUrl, setWebhookUrl] = useState('')
  const [defaultChannel, setDefaultChannel] = useState('')
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    setIsLoading(true)
    try {
      const res = await api.getSlackSettings()
      const s = res.data.data
      setSettings(s)
      setWebhookUrl(s.webhookUrl || '')
      setDefaultChannel(s.defaultChannel || '')
      setEnabled(s.enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const dto: UpdateSlackSettingsDto = {
        webhookUrl: webhookUrl.trim() || undefined,
        defaultChannel: defaultChannel.trim() || undefined,
        enabled,
      }
      const res = await api.updateSlackSettings(dto)
      setSettings(res.data.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await api.testSlackConnection()
      setTestResult({ success: res.data.success, error: res.data.error })
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setIsTesting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary/10">
          <MessageSquare className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Slack Integration</h3>
          <p className="text-sm text-muted-foreground">
            Send notifications to Slack when automation rules trigger
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <button
            onClick={() => setEnabled(!enabled)}
            className={cn(
              "relative w-12 h-6 rounded-full transition-colors",
              enabled ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform",
                enabled && "translate-x-6"
              )}
            />
          </button>
        </div>
      </div>

      <div className="space-y-4 pl-14">
        <div>
          <label className="block text-sm font-medium mb-1">Webhook URL</label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Create an incoming webhook in your Slack workspace settings
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Default Channel (optional)</label>
          <input
            type="text"
            value={defaultChannel}
            onChange={(e) => setDefaultChannel(e.target.value)}
            placeholder="#general"
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Override the channel set in the webhook configuration
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {testResult && (
          <div className={cn(
            "flex items-center gap-2 p-3 rounded-lg text-sm",
            testResult.success ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
          )}>
            {testResult.success ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Test message sent successfully
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4" />
                {testResult.error || 'Test failed'}
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t">
          <button
            onClick={handleTest}
            disabled={!webhookUrl || isTesting}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-colors",
              "hover:bg-accent",
              (!webhookUrl || isTesting) && "opacity-50 cursor-not-allowed"
            )}
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MessageSquare className="w-4 h-4" />
            )}
            Send Test Message
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              isSaving && "opacity-50 cursor-not-allowed"
            )}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
