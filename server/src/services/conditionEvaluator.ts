/**
 * Condition Evaluator
 * Evaluates automation rule conditions against device metrics and time
 */

import type {
  RuleConditions,
  ConditionGroup,
  SingleCondition,
  MetricCondition,
  TimeCondition,
  DayOfWeekCondition,
  EventCondition,
  DeviceMetrics,
  EvaluationContext,
  EvaluationResult,
  DayOfWeek,
} from '../types/automation.js'

const DAY_MAP: Record<number, DayOfWeek> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
}

/**
 * Main entry point for evaluating rule conditions
 */
export function evaluateConditions(
  conditions: RuleConditions,
  context: EvaluationContext
): EvaluationResult {
  const matchedConditions: string[] = []
  const failedConditions: string[] = []

  const matches = evaluateGroup(conditions, context, matchedConditions, failedConditions)

  return {
    matches,
    matchedConditions,
    failedConditions: matches ? undefined : failedConditions,
  }
}

/**
 * Evaluate a condition group (AND/OR)
 */
function evaluateGroup(
  group: ConditionGroup,
  context: EvaluationContext,
  matchedConditions: string[],
  failedConditions: string[]
): boolean {
  const results: boolean[] = []

  for (const condition of group.conditions) {
    let result: boolean
    let description: string

    if ('operator' in condition) {
      // Nested group
      result = evaluateGroup(condition, context, matchedConditions, failedConditions)
      description = `Group (${condition.operator})`
    } else {
      // Single condition
      const evalResult = evaluateSingleCondition(condition, context)
      result = evalResult.matches
      description = evalResult.description
    }

    results.push(result)

    if (result) {
      matchedConditions.push(description)
    } else {
      failedConditions.push(description)
    }
  }

  if (group.operator === 'AND') {
    return results.every(r => r)
  } else {
    return results.some(r => r)
  }
}

/**
 * Evaluate a single condition
 */
function evaluateSingleCondition(
  condition: SingleCondition,
  context: EvaluationContext
): { matches: boolean; description: string } {
  switch (condition.type) {
    case 'metric':
      return evaluateMetricCondition(condition, context.metrics)
    case 'time':
      return evaluateTimeCondition(condition, context.currentTime)
    case 'dayOfWeek':
      return evaluateDayOfWeekCondition(condition, context.currentTime)
    case 'event':
      return evaluateEventCondition(condition, context)
    default:
      return { matches: false, description: 'Unknown condition type' }
  }
}

/**
 * Evaluate metric condition (SOC, temperature, power, etc.)
 */
function evaluateMetricCondition(
  condition: MetricCondition,
  metrics: DeviceMetrics
): { matches: boolean; description: string } {
  const value = getMetricValue(condition.field, metrics)
  const description = formatMetricDescription(condition, value)

  switch (condition.op) {
    case '>':
      return { matches: value > (condition.value as number), description }
    case '<':
      return { matches: value < (condition.value as number), description }
    case '>=':
      return { matches: value >= (condition.value as number), description }
    case '<=':
      return { matches: value <= (condition.value as number), description }
    case '==':
      return { matches: value === (condition.value as number), description }
    case 'between': {
      const [min, max] = condition.value as [number, number]
      return { matches: value >= min && value <= max, description }
    }
    default:
      return { matches: false, description: 'Unknown operator' }
  }
}

/**
 * Get metric value from device metrics
 */
function getMetricValue(field: MetricCondition['field'], metrics: DeviceMetrics): number {
  switch (field) {
    case 'soc':
      return metrics.soc
    case 'temperature':
      return metrics.temperature
    case 'acInputWatts':
      return metrics.acInputWatts
    case 'solarInputWatts':
      return metrics.solarInputWatts
    case 'acOutputWatts':
      return metrics.acOutputWatts
    case 'dcOutputWatts':
      return metrics.dcOutputWatts
    case 'totalInputWatts':
      return metrics.totalInputWatts
    case 'totalOutputWatts':
      return metrics.totalOutputWatts
    default:
      return 0
  }
}

/**
 * Format metric condition description for logging
 */
function formatMetricDescription(condition: MetricCondition, currentValue: number): string {
  const fieldLabels: Record<MetricCondition['field'], string> = {
    soc: 'SOC',
    temperature: 'Temperature',
    acInputWatts: 'AC Input',
    solarInputWatts: 'Solar Input',
    acOutputWatts: 'AC Output',
    dcOutputWatts: 'DC Output',
    totalInputWatts: 'Total Input',
    totalOutputWatts: 'Total Output',
  }

  const field = fieldLabels[condition.field] || condition.field

  if (condition.op === 'between') {
    const [min, max] = condition.value as [number, number]
    return `${field} (${currentValue}) between ${min} and ${max}`
  }

  return `${field} (${currentValue}) ${condition.op} ${condition.value}`
}

/**
 * Evaluate time condition (time of day)
 */
function evaluateTimeCondition(
  condition: TimeCondition,
  currentTime: Date
): { matches: boolean; description: string } {
  const currentTimeStr = formatTime(currentTime)

  if (condition.op === 'equals') {
    const target = condition.value as string
    const matches = currentTimeStr === target
    return {
      matches,
      description: `Time (${currentTimeStr}) equals ${target}`,
    }
  }

  if (condition.op === 'between') {
    const [start, end] = condition.value as [string, string]
    const matches = isTimeBetween(currentTimeStr, start, end)
    return {
      matches,
      description: `Time (${currentTimeStr}) between ${start} and ${end}`,
    }
  }

  return { matches: false, description: 'Unknown time operator' }
}

/**
 * Format time as HH:mm
 */
function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Check if current time is between start and end
 * Handles overnight ranges (e.g., 22:00 - 06:00)
 */
function isTimeBetween(current: string, start: string, end: string): boolean {
  // Convert to comparable numbers (HH:mm -> HHMM)
  const toNumber = (time: string): number => {
    const [h, m] = time.split(':').map(Number)
    return h * 100 + m
  }

  const currentNum = toNumber(current)
  const startNum = toNumber(start)
  const endNum = toNumber(end)

  if (startNum <= endNum) {
    // Normal range (e.g., 09:00 - 18:00)
    return currentNum >= startNum && currentNum <= endNum
  } else {
    // Overnight range (e.g., 22:00 - 06:00)
    return currentNum >= startNum || currentNum <= endNum
  }
}

/**
 * Evaluate day of week condition
 */
function evaluateDayOfWeekCondition(
  condition: DayOfWeekCondition,
  currentTime: Date
): { matches: boolean; description: string } {
  const currentDay = DAY_MAP[currentTime.getDay()]
  const days = condition.value

  const daysStr = days.join(', ')

  if (condition.op === 'in') {
    const matches = days.includes(currentDay)
    return {
      matches,
      description: `Day (${currentDay}) in [${daysStr}]`,
    }
  }

  if (condition.op === 'notIn') {
    const matches = !days.includes(currentDay)
    return {
      matches,
      description: `Day (${currentDay}) not in [${daysStr}]`,
    }
  }

  return { matches: false, description: 'Unknown day operator' }
}

/**
 * Evaluate event condition (error, online/offline, battery state)
 */
function evaluateEventCondition(
  condition: EventCondition,
  context: EvaluationContext
): { matches: boolean; description: string } {
  const { metrics, previousMetrics } = context

  switch (condition.eventType) {
    case 'error':
      return {
        matches: metrics.hasError,
        description: `Device has error: ${metrics.hasError}`,
      }

    case 'offline':
      return {
        matches: !metrics.online,
        description: `Device offline: ${!metrics.online}`,
      }

    case 'online':
      // Check if device just came online (was offline before)
      if (previousMetrics) {
        const justCameOnline = metrics.online && !previousMetrics.online
        return {
          matches: justCameOnline,
          description: `Device just came online: ${justCameOnline}`,
        }
      }
      return {
        matches: metrics.online,
        description: `Device online: ${metrics.online}`,
      }

    case 'lowBattery':
      return {
        matches: metrics.soc < 20,
        description: `Low battery (${metrics.soc}%): ${metrics.soc < 20}`,
      }

    case 'fullBattery':
      return {
        matches: metrics.soc >= 100,
        description: `Full battery (${metrics.soc}%): ${metrics.soc >= 100}`,
      }

    default:
      return { matches: false, description: 'Unknown event type' }
  }
}

/**
 * Validate conditions structure
 */
export function validateConditions(conditions: unknown): conditions is RuleConditions {
  if (!conditions || typeof conditions !== 'object') return false

  const group = conditions as ConditionGroup

  if (!['AND', 'OR'].includes(group.operator)) return false
  if (!Array.isArray(group.conditions)) return false
  if (group.conditions.length === 0) return false

  return group.conditions.every(c => validateConditionItem(c))
}

function validateConditionItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false

  const obj = item as Record<string, unknown>

  // Check if it's a nested group
  if ('operator' in obj) {
    return validateConditions(obj)
  }

  // Check single condition types
  if (!('type' in obj)) return false

  switch (obj.type) {
    case 'metric':
      return (
        typeof obj.field === 'string' &&
        typeof obj.op === 'string' &&
        (typeof obj.value === 'number' || Array.isArray(obj.value))
      )
    case 'time':
      return (
        typeof obj.op === 'string' &&
        (typeof obj.value === 'string' || Array.isArray(obj.value))
      )
    case 'dayOfWeek':
      return typeof obj.op === 'string' && Array.isArray(obj.value)
    case 'event':
      return typeof obj.eventType === 'string'
    default:
      return false
  }
}
