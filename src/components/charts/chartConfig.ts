import { useMemo } from 'react'
import { useSettingsStore, type TimeFormat } from '@/stores/settingsStore'
import type { ChartPeriod, DateRange } from '@/types/device'

// Chart colors - using energy design system
export const chartColors = {
  batterySoc: '#10B981', // energy-green
  acInput: '#A855F7', // energy-purple
  solarInput: '#F59E0B', // energy-yellow
  acOutput: '#3B82F6', // energy-blue
  dcOutput: '#06b6d4', // cyan (secondary)
  temperature: '#F59E0B', // energy-yellow
  voltage: '#3B82F6', // energy-blue
  extraBattery1: '#10B981', // energy-green
  extraBattery2: '#A855F7', // energy-purple
  grid: '#E2E8F0', // blueprint style grid
  text: '#64748B', // text secondary
}

export const periodLabels: Record<string, string> = {
  '10m': '10 min',
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  'custom': 'Custom',
}

// Compact labels for phone-width period pickers
export const periodShortLabels: Record<string, string> = {
  '10m': '10m',
  '1h': '1h',
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  'custom': 'Custom',
}

/** X-axis label for a period; a custom range picks the format from its length */
function formatTick(
  timestamp: string,
  period: string,
  timezone: string,
  timeFormat: TimeFormat,
  customRangeDurationHours?: number
): string {
  const date = new Date(timestamp)
  const hour12 = timeFormat === '12h'
  const scale =
    period !== 'custom' ? period
      : customRangeDurationHours === undefined ? 'custom'
        : customRangeDurationHours <= 24 ? '24h'
          : customRangeDurationHours <= 168 ? '7d'
            : '30d'

  switch (scale) {
    case '10m':
    case '1h':
    case '24h':
      return date.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12 })
    case '7d':
      return date.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', hour12 })
    case '30d':
      return date.toLocaleDateString('en-US', { timeZone: timezone, day: 'numeric', month: 'short' })
    default:
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

/** Tick formatter for the time axis, following the timezone and 12/24 h settings */
export function useTimeTickFormatter(period: ChartPeriod, customRange?: DateRange | null) {
  const timezone = useSettingsStore((s) => s.timezone)
  const timeFormat = useSettingsStore((s) => s.timeFormat)
  return useMemo(() => {
    const hours = period === 'custom' && customRange
      ? (new Date(customRange.to).getTime() - new Date(customRange.from).getTime()) / 3_600_000
      : undefined
    return (value: string) => formatTick(value, period, timezone, timeFormat, hours)
  }, [period, customRange, timezone, timeFormat])
}

/** The moment a tooltip describes, e.g. "Oct 20, 14:30" */
export function useTooltipTime(label: string | undefined): string {
  const timezone = useSettingsStore((s) => s.timezone)
  const timeFormat = useSettingsStore((s) => s.timeFormat)
  if (!label) return ''
  return new Date(label).toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  })
}

// Shared look of the axes and grid
export const axisProps = {
  stroke: chartColors.text,
  fontSize: 10,
  fontFamily: 'JetBrains Mono, monospace',
  tickLine: false,
} as const

export const xAxisProps = {
  ...axisProps,
  dataKey: 'timestamp',
  axisLine: { stroke: chartColors.grid, strokeWidth: 1 },
  dy: 5,
  interval: 'preserveStartEnd',
  minTickGap: 40,
} as const

export const gridProps = {
  strokeDasharray: '2 4',
  stroke: chartColors.grid,
  vertical: false,
  strokeOpacity: 0.7,
} as const

export const cursorProps = { stroke: chartColors.text, strokeWidth: 1, strokeDasharray: '4 4' } as const

export const legendProps = {
  wrapperStyle: { fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' },
  iconType: 'square',
  iconSize: 8,
} as const
