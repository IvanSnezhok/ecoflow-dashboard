import { useSettingsStore, type TimeFormat } from '@/stores/settingsStore'

// Chart colors and configuration
export const chartColors = {
  batterySoc: {
    stroke: '#22c55e',
    fill: 'url(#socGradient)',
  },
  batteryWatts: {
    stroke: '#3b82f6',
  },
  acInput: {
    stroke: '#8b5cf6',
  },
  solarInput: {
    stroke: '#f59e0b',
  },
  acOutput: {
    stroke: '#ec4899',
  },
  dcOutput: {
    stroke: '#06b6d4',
  },
  temperature: {
    stroke: '#f97316',
  },
  // New colors for detailed charts
  voltage: {
    stroke: '#3b82f6', // Blue for main battery voltage
  },
  extraBattery1: {
    stroke: '#10b981', // Emerald for extra battery 1
  },
  extraBattery2: {
    stroke: '#8b5cf6', // Violet for extra battery 2
  },
  grid: '#e5e7eb',
  gridDark: '#374151',
  text: '#6b7280',
  textDark: '#9ca3af',
}

export const periodLabels: Record<string, string> = {
  '10m': '10 min',
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  'custom': 'Custom',
}

// Legacy function for backward compatibility (uses store internally)
export const formatTimestamp = (timestamp: string, period: string): string => {
  const { timezone, timeFormat } = useSettingsStore.getState()
  return formatTimestampWithSettings(timestamp, period, timezone, timeFormat)
}

// Pure function for use in components with settings passed explicitly
export const formatTimestampWithSettings = (
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
