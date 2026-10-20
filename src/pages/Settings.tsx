import { Clock, Globe } from 'lucide-react'
import { useSettingsStore, commonTimezones } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { SlackSettings } from '@/components/automation/SlackSettings'
import { BleAccountSettings } from '@/components/settings/BleAccountSettings'
import { AppAccountSettings } from '@/components/settings/AppAccountSettings'
import { PanelLoginSettings } from '@/components/settings/PanelLoginSettings'
import { PanelUsersSettings } from '@/components/settings/PanelUsersSettings'
import { SystemSettings } from '@/components/settings/SystemSettings'
import { usePanelAccess } from '@/hooks/usePanelAccess'

function TimeSettings() {
  const timezone = useSettingsStore((s) => s.timezone)
  const timeFormat = useSettingsStore((s) => s.timeFormat)
  const setTimezone = useSettingsStore((s) => s.setTimezone)
  const setTimeFormat = useSettingsStore((s) => s.setTimeFormat)

  return (
    <>
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
            {(['24h', '12h'] as const).map((format) => (
              <button
                key={format}
                onClick={() => setTimeFormat(format)}
                className={cn(
                  'flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                  timeFormat === format
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card hover:bg-accent'
                )}
              >
                {format === '24h' ? '24-hour (14:30)' : '12-hour (2:30 PM)'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

export default function Settings() {
  // Invited users get their own login and the display settings; the rest is the owner's
  const { isOwner } = usePanelAccess()

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Settings</h2>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Panel login: who is signed in, on which devices */}
        <div className="rounded-lg border bg-card p-6 md:col-span-2">
          <PanelLoginSettings />
        </div>

        {isOwner && <>
          {/* People invited to the panel, with their roles and devices */}
          <div className="rounded-lg border bg-card p-6 md:col-span-2">
            <PanelUsersSettings />
          </div>

          {/* EcoFlow account for the Bluetooth channel */}
          <div className="rounded-lg border bg-card p-6 md:col-span-2">
            <BleAccountSettings />
          </div>

          {/* EcoFlow account for the app channel (devices the Open API serves only in part) */}
          <div className="rounded-lg border bg-card p-6 md:col-span-2">
            <AppAccountSettings />
          </div>

          <div className="rounded-lg border bg-card p-6 md:col-span-2">
            <SlackSettings />
          </div>
        </>}

        <div className={cn('rounded-lg border bg-card p-6', !isOwner && 'md:col-span-2')}>
          <TimeSettings />
        </div>

        {isOwner && (
          <div className="rounded-lg border bg-card p-6">
            <SystemSettings />
          </div>
        )}
      </div>
    </div>
  )
}
