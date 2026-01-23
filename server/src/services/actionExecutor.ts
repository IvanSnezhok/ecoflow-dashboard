/**
 * Action Executor
 * Executes automation rule actions (device commands, notifications)
 */

import type {
  RuleAction,
  ActionExecutionResult,
  DeviceMetrics,
} from '../types/automation.js'
import { ecoflowApi } from './ecoflowApi.js'
import { sendSlackMessage } from './slackService.js'
import { insertLog } from '../db/database.js'

/**
 * Execute all actions for a rule
 */
export async function executeActions(
  actions: RuleAction[],
  deviceMetrics: DeviceMetrics,
  ruleName: string
): Promise<ActionExecutionResult[]> {
  const results: ActionExecutionResult[] = []

  for (const action of actions) {
    const result = await executeSingleAction(action, deviceMetrics, ruleName)
    results.push(result)

    // Log the action
    logAction(action, deviceMetrics, result, ruleName)
  }

  return results
}

/**
 * Execute a single action
 */
async function executeSingleAction(
  action: RuleAction,
  metrics: DeviceMetrics,
  ruleName: string
): Promise<ActionExecutionResult> {
  try {
    switch (action.type) {
      case 'setAcOutput':
        await ecoflowApi.setAcOutput(metrics.serialNumber, action.params.enabled)
        return {
          action,
          success: true,
          response: { enabled: action.params.enabled },
        }

      case 'setDcOutput':
        await ecoflowApi.setDcOutput(metrics.serialNumber, action.params.enabled)
        return {
          action,
          success: true,
          response: { enabled: action.params.enabled },
        }

      case 'setChargingPower':
        await ecoflowApi.setAcChargingPower(metrics.serialNumber, action.params.watts)
        return {
          action,
          success: true,
          response: { watts: action.params.watts },
        }

      case 'setMaxChargeSoc':
        await ecoflowApi.setMaxChargeSoc(metrics.serialNumber, action.params.maxSoc)
        return {
          action,
          success: true,
          response: { maxSoc: action.params.maxSoc },
        }

      case 'setMinDischargeSoc':
        await ecoflowApi.setMinDischargeSoc(metrics.serialNumber, action.params.minSoc)
        return {
          action,
          success: true,
          response: { minSoc: action.params.minSoc },
        }

      case 'sendSlackNotification': {
        const message = formatSlackMessage(action.params.message, metrics, ruleName)
        await sendSlackMessage(message, action.params.channel)
        return {
          action,
          success: true,
          response: { messageSent: message },
        }
      }

      default:
        return {
          action,
          success: false,
          error: `Unknown action type: ${(action as RuleAction).type}`,
        }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[ActionExecutor] Error executing action ${action.type}:`, errorMessage)
    return {
      action,
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Format Slack message with variable substitution
 * Supported variables: {device}, {soc}, {temperature}, {acInput}, {solarInput}, {acOutput}, {dcOutput}, {rule}
 */
function formatSlackMessage(
  template: string,
  metrics: DeviceMetrics,
  ruleName: string
): string {
  return template
    .replace(/{device}/g, metrics.serialNumber)
    .replace(/{soc}/g, String(metrics.soc))
    .replace(/{temperature}/g, String(metrics.temperature))
    .replace(/{acInput}/g, String(metrics.acInputWatts))
    .replace(/{solarInput}/g, String(metrics.solarInputWatts))
    .replace(/{acOutput}/g, String(metrics.acOutputWatts))
    .replace(/{dcOutput}/g, String(metrics.dcOutputWatts))
    .replace(/{totalInput}/g, String(metrics.totalInputWatts))
    .replace(/{totalOutput}/g, String(metrics.totalOutputWatts))
    .replace(/{rule}/g, ruleName)
    .replace(/{online}/g, metrics.online ? 'Online' : 'Offline')
}

/**
 * Log action execution to operation_logs
 */
function logAction(
  action: RuleAction,
  metrics: DeviceMetrics,
  result: ActionExecutionResult,
  ruleName: string
): void {
  const operationType = 'AUTOMATION'
  const operationName = `Rule: ${ruleName} - ${formatActionName(action)}`

  insertLog(
    metrics.deviceId,
    operationType,
    operationName,
    JSON.stringify({
      action,
      deviceSerial: metrics.serialNumber,
    }),
    JSON.stringify(result.response || { error: result.error }),
    result.success,
    result.error || null
  )
}

/**
 * Format action name for logging
 */
function formatActionName(action: RuleAction): string {
  switch (action.type) {
    case 'setAcOutput':
      return `Set AC Output: ${action.params.enabled ? 'ON' : 'OFF'}`
    case 'setDcOutput':
      return `Set DC Output: ${action.params.enabled ? 'ON' : 'OFF'}`
    case 'setChargingPower':
      return `Set Charging Power: ${action.params.watts}W`
    case 'setMaxChargeSoc':
      return `Set Max Charge SOC: ${action.params.maxSoc}%`
    case 'setMinDischargeSoc':
      return `Set Min Discharge SOC: ${action.params.minSoc}%`
    case 'sendSlackNotification':
      return 'Send Slack Notification'
    default:
      return 'Unknown Action'
  }
}

/**
 * Validate action parameters
 */
export function validateAction(action: unknown): action is RuleAction {
  if (!action || typeof action !== 'object') return false

  const obj = action as Record<string, unknown>
  if (!obj.type || typeof obj.type !== 'string') return false
  if (!obj.params || typeof obj.params !== 'object') return false

  const params = obj.params as Record<string, unknown>

  switch (obj.type) {
    case 'setAcOutput':
    case 'setDcOutput':
      return typeof params.enabled === 'boolean'

    case 'setChargingPower':
      return (
        typeof params.watts === 'number' &&
        params.watts >= 200 &&
        params.watts <= 2900
      )

    case 'setMaxChargeSoc':
      return (
        typeof params.maxSoc === 'number' &&
        params.maxSoc >= 50 &&
        params.maxSoc <= 100
      )

    case 'setMinDischargeSoc':
      return (
        typeof params.minSoc === 'number' &&
        params.minSoc >= 0 &&
        params.minSoc <= 30
      )

    case 'sendSlackNotification':
      return typeof params.message === 'string' && params.message.length > 0

    default:
      return false
  }
}

/**
 * Validate all actions in a rule
 */
export function validateActions(actions: unknown): actions is RuleAction[] {
  if (!Array.isArray(actions)) return false
  if (actions.length === 0) return false
  return actions.every(a => validateAction(a))
}
