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
}

export const formatTimestamp = (timestamp: string, period: string): string => {
  const date = new Date(timestamp)

  switch (period) {
    case '10m':
    case '1h':
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    case '24h':
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    case '7d':
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        hour: '2-digit',
      })
    case '30d':
      return date.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
      })
    default:
      return date.toLocaleString('en-US')
  }
}
