import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TimeFormat = '12h' | '24h'

interface SettingsState {
  timezone: string
  timeFormat: TimeFormat
  /** Collapsible sections the user opened (CollapsibleCard ids) */
  openSections: string[]
  setTimezone: (timezone: string) => void
  setTimeFormat: (format: TimeFormat) => void
  toggleSection: (id: string) => void
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
      openSections: [],
      setTimezone: (timezone) => set({ timezone }),
      setTimeFormat: (timeFormat) => set({ timeFormat }),
      toggleSection: (id) =>
        set((state) => ({
          openSections: state.openSections.includes(id)
            ? state.openSections.filter((open) => open !== id)
            : [...state.openSections, id],
        })),
    }),
    {
      name: 'ecoflow-settings',
    }
  )
)
