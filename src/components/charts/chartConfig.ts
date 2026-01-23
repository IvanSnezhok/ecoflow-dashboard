import { useSettingsStore, type TimeFormat } from '@/stores/settingsStore'

// Chart colors and configuration - using energy design system
export const chartColors = {
  batterySoc: {
    stroke: '#10B981', // energy-green
    fill: 'url(#socGradient)',
  },
  batteryWatts: {
    stroke: '#3B82F6', // energy-blue
  },
  acInput: {
    stroke: '#A855F7', // energy-purple
  },
  solarInput: {
    stroke: '#F59E0B', // energy-yellow
  },
  acOutput: {
    stroke: '#3B82F6', // energy-blue
  },
  dcOutput: {
    stroke: '#06b6d4', // cyan (secondary)
  },
  temperature: {
    stroke: '#F59E0B', // energy-yellow
  },
  // New colors for detailed charts
  voltage: {
    stroke: '#3B82F6', // energy-blue
  },
  extraBattery1: {
    stroke: '#10B981', // energy-green
  },
  extraBattery2: {
    stroke: '#A855F7', // energy-purple
  },
  // Grid and text colors
  grid: '#E2E8F0', // blueprint style grid
  gridDark: '#334155',
  text: '#64748B', // text secondary
  textDark: '#94A3B8',
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
