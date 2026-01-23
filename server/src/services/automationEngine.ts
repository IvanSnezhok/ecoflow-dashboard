/**
 * Automation Engine
 * Core engine that evaluates rules and executes actions based on device metrics
 */

import type {
  AutomationRule,
  AutomationRuleRow,
  RuleConditions,
  RuleAction,
  DeviceMetrics,
  EvaluationContext,
} from '../types/automation.js'
import {
  getAutomationRulesForDevice,
  updateRuleLastTriggered,
  insertAutomationLog,
  getAutomationRuleById,
} from '../db/database.js'
import { evaluateConditions } from './conditionEvaluator.js'
import { executeActions } from './actionExecutor.js'

// Store previous metrics for detecting changes (e.g., online/offline transitions)
const previousMetricsCache = new Map<string, DeviceMetrics>()

// Cooldown tracking: ruleId -> last triggered timestamp
const cooldownTracker = new Map<number, number>()

/**
 * Convert database row to AutomationRule object
 */
function rowToRule(row: AutomationRuleRow): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    deviceId: row.device_id || undefined,
    enabled: row.enabled === 1,
    conditions: JSON.parse(row.conditions) as RuleConditions,
    actions: JSON.parse(row.actions) as RuleAction[],
    cooldownSeconds: row.cooldown_seconds,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTriggeredAt: row.last_triggered_at || undefined,
  }
}

/**
 * Check if a rule is in cooldown
 */
function isInCooldown(rule: AutomationRule): boolean {
  const lastTriggered = cooldownTracker.get(rule.id)
  if (!lastTriggered) return false

  const cooldownMs = rule.cooldownSeconds * 1000
  const elapsed = Date.now() - lastTriggered

  return elapsed < cooldownMs
}

/**
 * Process automation rules for a single device
 * Called during each polling cycle
 */
export async function processDeviceAutomation(
  metrics: DeviceMetrics
): Promise<void> {
  const startTime = Date.now()

  // Get rules applicable to this device (device-specific + global rules)
  const ruleRows = getAutomationRulesForDevice(metrics.deviceId)
  if (ruleRows.length === 0) return

  const rules = ruleRows.map(rowToRule)

  // Get previous metrics for change detection
  const previousMetrics = previousMetricsCache.get(metrics.serialNumber)

  // Create evaluation context
  const context: EvaluationContext = {
    metrics,
    currentTime: new Date(),
    previousMetrics,
  }

  // Process each rule
  for (const rule of rules) {
    try {
      await processRule(rule, context)
    } catch (error) {
      console.error(`[AutomationEngine] Error processing rule ${rule.id}:`, error)

      // Log the error
      insertAutomationLog({
        ruleId: rule.id,
        ruleName: rule.name,
        deviceId: metrics.deviceId,
        deviceSerial: metrics.serialNumber,
        triggerDetails: { error: 'Rule processing failed' },
        actionsExecuted: [],
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime,
      })
    }
  }

  // Update previous metrics cache
  previousMetricsCache.set(metrics.serialNumber, { ...metrics })
}

/**
 * Process a single rule
 */
async function processRule(
  rule: AutomationRule,
  context: EvaluationContext
): Promise<void> {
  // Check cooldown
  if (isInCooldown(rule)) {
    return
  }

  // Evaluate conditions
  const evalResult = evaluateConditions(rule.conditions, context)

  if (!evalResult.matches) {
    return
  }

  console.log(
    `[AutomationEngine] Rule "${rule.name}" triggered for device ${context.metrics.serialNumber}`
  )
  console.log(`[AutomationEngine] Matched conditions:`, evalResult.matchedConditions)

  const startTime = Date.now()

  // Execute actions
  const actionResults = await executeActions(
    rule.actions,
    context.metrics,
    rule.name
  )

  const allSuccess = actionResults.every(r => r.success)
  const errors = actionResults.filter(r => !r.success).map(r => r.error)

  // Update cooldown tracker
  cooldownTracker.set(rule.id, Date.now())

  // Update last triggered timestamp in database
  updateRuleLastTriggered(rule.id)

  // Log execution
  insertAutomationLog({
    ruleId: rule.id,
    ruleName: rule.name,
    deviceId: context.metrics.deviceId,
    deviceSerial: context.metrics.serialNumber,
    triggerDetails: {
      matchedConditions: evalResult.matchedConditions,
      metrics: {
        soc: context.metrics.soc,
        temperature: context.metrics.temperature,
        acInputWatts: context.metrics.acInputWatts,
        solarInputWatts: context.metrics.solarInputWatts,
        acOutputWatts: context.metrics.acOutputWatts,
        dcOutputWatts: context.metrics.dcOutputWatts,
      },
      time: context.currentTime.toISOString(),
    },
    actionsExecuted: actionResults.map(r => ({
      type: r.action.type,
      params: r.action.params,
      success: r.success,
      error: r.error,
    })),
    success: allSuccess,
    errorMessage: errors.length > 0 ? errors.join('; ') : undefined,
    executionTimeMs: Date.now() - startTime,
  })

  console.log(
    `[AutomationEngine] Rule "${rule.name}" execution completed. Success: ${allSuccess}`
  )
}

/**
 * Test a rule against current metrics (dry run)
 * Returns evaluation result without executing actions
 */
export async function testRule(
  ruleId: number,
  metrics: DeviceMetrics
): Promise<{
  matches: boolean
  matchedConditions: string[]
  failedConditions?: string[]
  wouldExecute: RuleAction[]
}> {
  const ruleRow = getAutomationRuleById(ruleId)
  if (!ruleRow) {
    throw new Error(`Rule not found: ${ruleId}`)
  }

  const rule = rowToRule(ruleRow)

  const context: EvaluationContext = {
    metrics,
    currentTime: new Date(),
    previousMetrics: previousMetricsCache.get(metrics.serialNumber),
  }

  const evalResult = evaluateConditions(rule.conditions, context)

  return {
    matches: evalResult.matches,
    matchedConditions: evalResult.matchedConditions,
    failedConditions: evalResult.failedConditions,
    wouldExecute: evalResult.matches ? rule.actions : [],
  }
}

/**
 * Clear cooldown for a specific rule
 */
export function clearRuleCooldown(ruleId: number): void {
  cooldownTracker.delete(ruleId)
}

/**
 * Clear all cooldowns
 */
export function clearAllCooldowns(): void {
  cooldownTracker.clear()
}

/**
 * Get cooldown status for a rule
 */
export function getRuleCooldownStatus(ruleId: number, cooldownSeconds: number): {
  inCooldown: boolean
  remainingSeconds?: number
} {
  const lastTriggered = cooldownTracker.get(ruleId)
  if (!lastTriggered) {
    return { inCooldown: false }
  }

  const cooldownMs = cooldownSeconds * 1000
  const elapsed = Date.now() - lastTriggered
  const remaining = cooldownMs - elapsed

  if (remaining <= 0) {
    return { inCooldown: false }
  }

  return {
    inCooldown: true,
    remainingSeconds: Math.ceil(remaining / 1000),
  }
}

/**
 * Build DeviceMetrics from raw device data
 */
export function buildDeviceMetrics(
  deviceId: number,
  serialNumber: string,
  online: boolean,
  rawData: Record<string, unknown>
): DeviceMetrics {
  // Extract values from raw data using Ecoflow field mapping
  const soc = (rawData['pd.soc'] ?? rawData['bmsMaster.soc'] ?? 0) as number
  const temperature = (rawData['bmsMaster.temp'] ?? rawData['pd.pv2DcChgPowerTemp'] ?? 0) as number
  const acInputWatts = (rawData['inv.inputWatts'] ?? 0) as number
  const solarInputWatts = (rawData['mppt.inWatts'] ?? 0) as number
  const acOutputWatts = (rawData['inv.outputWatts'] ?? 0) as number
  const dcOutputWatts = (rawData['mppt.outWatts'] ?? 0) as number

  // Error codes
  const errorCodes: number[] = []
  const bmsErr = rawData['bmsMaster.errCode'] as number | undefined
  const invErr = rawData['inv.errCode'] as number | undefined
  const mpptErr = rawData['mppt.faultCode'] as number | undefined

  if (bmsErr && bmsErr !== 0) errorCodes.push(bmsErr)
  if (invErr && invErr !== 0) errorCodes.push(invErr)
  if (mpptErr && mpptErr !== 0) errorCodes.push(mpptErr)

  return {
    serialNumber,
    deviceId,
    online,
    soc,
    temperature,
    acInputWatts,
    solarInputWatts,
    acOutputWatts,
    dcOutputWatts,
    totalInputWatts: acInputWatts + solarInputWatts,
    totalOutputWatts: acOutputWatts + dcOutputWatts,
    hasError: errorCodes.length > 0,
    errorCodes,
  }
}
