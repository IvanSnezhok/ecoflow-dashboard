/**
 * Automation System Types (Frontend)
 */

// Condition Types
export type MetricField =
  | 'soc'
  | 'temperature'
  | 'acInputWatts'
  | 'solarInputWatts'
  | 'acOutputWatts'
  | 'dcOutputWatts'
  | 'totalInputWatts'
  | 'totalOutputWatts'

export type ComparisonOp = '>' | '<' | '>=' | '<=' | '==' | 'between'
export type TimeOp = 'between' | 'equals'
export type DayOp = 'in' | 'notIn'
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type EventType = 'error' | 'offline' | 'online' | 'lowBattery' | 'fullBattery'

export interface MetricCondition {
  type: 'metric'
  field: MetricField
  op: ComparisonOp
  value: number | [number, number]
}

export interface TimeCondition {
  type: 'time'
  op: TimeOp
  value: string | [string, string]
}

export interface DayOfWeekCondition {
  type: 'dayOfWeek'
  op: DayOp
  value: DayOfWeek[]
}

export interface EventCondition {
  type: 'event'
  eventType: EventType
}

export type SingleCondition =
  | MetricCondition
  | TimeCondition
  | DayOfWeekCondition
  | EventCondition

export interface ConditionGroup {
  operator: 'AND' | 'OR'
  conditions: (SingleCondition | ConditionGroup)[]
}

export type RuleConditions = ConditionGroup

// Action Types
export type ActionType =
  | 'setAcOutput'
  | 'setDcOutput'
  | 'setChargingPower'
  | 'setMaxChargeSoc'
  | 'setMinDischargeSoc'
  | 'sendSlackNotification'

export interface SetAcOutputAction {
  type: 'setAcOutput'
  params: { enabled: boolean }
}

export interface SetDcOutputAction {
  type: 'setDcOutput'
  params: { enabled: boolean }
}

export interface SetChargingPowerAction {
  type: 'setChargingPower'
  params: { watts: number }
}

export interface SetMaxChargeSocAction {
  type: 'setMaxChargeSoc'
  params: { maxSoc: number }
}

export interface SetMinDischargeSocAction {
  type: 'setMinDischargeSoc'
  params: { minSoc: number }
}

export interface SendSlackNotificationAction {
  type: 'sendSlackNotification'
  params: {
    message: string
    channel?: string
  }
}

export type RuleAction =
  | SetAcOutputAction
  | SetDcOutputAction
  | SetChargingPowerAction
  | SetMaxChargeSocAction
  | SetMinDischargeSocAction
  | SendSlackNotificationAction

// Rule Definition
export interface AutomationRule {
  id: number
  name: string
  description?: string
  deviceId?: number
  enabled: boolean
  conditions: RuleConditions
  actions: RuleAction[]
  cooldownSeconds: number
  priority: number
  createdAt: string
  updatedAt: string
  lastTriggeredAt?: string
  executionCount?: number
  cooldownStatus?: {
    inCooldown: boolean
    remainingSeconds?: number
  }
}

// Create/Update DTOs
export interface CreateAutomationRuleDto {
  name: string
  description?: string
  deviceId?: number
  enabled?: boolean
  conditions: RuleConditions
  actions: RuleAction[]
  cooldownSeconds?: number
  priority?: number
}

export interface UpdateAutomationRuleDto {
  name?: string
  description?: string
  deviceId?: number | null
  enabled?: boolean
  conditions?: RuleConditions
  actions?: RuleAction[]
  cooldownSeconds?: number
  priority?: number
}

// Automation Log
export interface AutomationLog {
  id: number
  ruleId: number
  ruleName?: string
  deviceId?: number
  deviceSerial?: string
  triggerDetails?: Record<string, unknown>
  actionsExecuted: Array<{
    type: string
    params: Record<string, unknown>
    success: boolean
    error?: string
  }>
  success: boolean
  errorMessage?: string
  executionTimeMs: number
  timestamp: string
}

// Slack Settings
export interface SlackSettings {
  id: number
  webhookUrl?: string
  incomingSecret?: string
  defaultChannel?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface UpdateSlackSettingsDto {
  webhookUrl?: string
  incomingSecret?: string
  defaultChannel?: string
  enabled?: boolean
}

// Test Result
export interface RuleTestResult {
  matches: boolean
  matchedConditions: string[]
  failedConditions?: string[]
  wouldExecute: RuleAction[]
  currentMetrics: {
    soc: number
    temperature: number
    acInputWatts: number
    solarInputWatts: number
    acOutputWatts: number
    dcOutputWatts: number
  }
}
