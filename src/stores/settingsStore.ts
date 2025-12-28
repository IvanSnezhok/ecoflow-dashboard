import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TimeFormat = '12h' | '24h'

interface SettingsState {
  timezone: string
  timeFormat: TimeFormat
  setTimezone: (timezone: string) => void
  setTimeFormat: (format: TimeFormat) => void
}

// Get the browser's default timezone
const getDefaultTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

// Common timezones for the dropdown
export const commonTimezones = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/Kyiv', label: 'Київ (UTC+2/+3)' },
  { value: 'Europe/London', label: 'London (UTC+0/+1)' },
  { value: 'Europe/Paris', label: 'Paris (UTC+1/+2)' },
  { value: 'Europe/Berlin', label: 'Berlin (UTC+1/+2)' },
  { value: 'Europe/Moscow', label: 'Moscow (UTC+3)' },
  { value: 'America/New_York', label: 'New York (UTC-5/-4)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (UTC-8/-7)' },
  { value: 'America/Chicago', label: 'Chicago (UTC-6/-5)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (UTC+9)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (UTC+8)' },
  { value: 'Asia/Dubai', label: 'Dubai (UTC+4)' },
  { value: 'Australia/Sydney', label: 'Sydney (UTC+10/+11)' },
]

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      timezone: getDefaultTimezone(),
      timeFormat: '24h',
      setTimezone: (timezone) => set({ timezone }),
      setTimeFormat: (timeFormat) => set({ timeFormat }),
    }),
    {
      name: 'ecoflow-settings',
    }
  )
)

// Helper function to format date/time according to settings
export const formatDateTime = (
  timestamp: string | Date,
  timezone: string,
  timeFormat: TimeFormat,
  options?: {
    showDate?: boolean
    showTime?: boolean
    showSeconds?: boolean
    shortDate?: boolean
  }
): string => {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  const opts = {
    showDate: true,
    showTime: true,
    showSeconds: false,
    shortDate: false,
    ...options,
  }

  const formatOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
  }

  if (opts.showDate) {
    if (opts.shortDate) {
      formatOptions.month = 'short'
      formatOptions.day = 'numeric'
    } else {
      formatOptions.year = 'numeric'
      formatOptions.month = '2-digit'
      formatOptions.day = '2-digit'
    }
  }

  if (opts.showTime) {
    formatOptions.hour = '2-digit'
    formatOptions.minute = '2-digit'
    formatOptions.hour12 = timeFormat === '12h'
    if (opts.showSeconds) {
      formatOptions.second = '2-digit'
    }
  }

  return date.toLocaleString('en-US', formatOptions)
}

// Helper for chart axis formatting
export const formatChartTime = (
  timestamp: string,
  period: string,
  timezone: string,
  timeFormat: TimeFormat
): string => {
  const date = new Date(timestamp)
  const hour12 = timeFormat === '12h'

  switch (period) {
    case '10m':
    case '1h':
    case '24h':
      return date.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12,
      })
    case '7d':
      return date.toLocaleDateString('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: '2-digit',
        hour12,
      })
    case '30d':
      return date.toLocaleDateString('en-US', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
      })
    default:
      // For custom range, auto-detect best format
      return date.toLocaleString('en-US', {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12,
      })
  }
}
