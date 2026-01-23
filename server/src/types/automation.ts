/**
 * Automation System Types
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
  | 'totalOutputWatts';

export type ComparisonOp = '>' | '<' | '>=' | '<=' | '==' | 'between';
export type TimeOp = 'between' | 'equals';
export type DayOp = 'in' | 'notIn';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type EventType = 'error' | 'offline' | 'online' | 'lowBattery' | 'fullBattery';

export interface MetricCondition {
  type: 'metric';
  field: MetricField;
  op: ComparisonOp;
  value: number | [number, number]; // single value or [min, max] for 'between'
}

export interface TimeCondition {
  type: 'time';
  op: TimeOp;
  value: string | [string, string]; // "HH:mm" or ["HH:mm", "HH:mm"] for between
}

export interface DayOfWeekCondition {
  type: 'dayOfWeek';
  op: DayOp;
  value: DayOfWeek[];
}

export interface EventCondition {
  type: 'event';
  eventType: EventType;
}

export type SingleCondition =
  | MetricCondition
  | TimeCondition
  | DayOfWeekCondition
  | EventCondition;

export interface ConditionGroup {
  operator: 'AND' | 'OR';
  conditions: (SingleCondition | ConditionGroup)[];
}

export type RuleConditions = ConditionGroup;

// Action Types
export type ActionType =
  | 'setAcOutput'
  | 'setDcOutput'
  | 'setChargingPower'
  | 'setMaxChargeSoc'
  | 'setMinDischargeSoc'
  | 'sendSlackNotification';

export interface SetAcOutputAction {
  type: 'setAcOutput';
  params: { enabled: boolean };
}

export interface SetDcOutputAction {
  type: 'setDcOutput';
  params: { enabled: boolean };
}

export interface SetChargingPowerAction {
  type: 'setChargingPower';
  params: { watts: number }; // 200-2900
}

export interface SetMaxChargeSocAction {
  type: 'setMaxChargeSoc';
  params: { maxSoc: number }; // 50-100
}

export interface SetMinDischargeSocAction {
  type: 'setMinDischargeSoc';
  params: { minSoc: number }; // 0-30
}

export interface SendSlackNotificationAction {
  type: 'sendSlackNotification';
  params: {
    message: string;
    channel?: string; // Optional, uses default if not set
  };
}

export type RuleAction =
  | SetAcOutputAction
  | SetDcOutputAction
  | SetChargingPowerAction
  | SetMaxChargeSocAction
  | SetMinDischargeSocAction
  | SendSlackNotificationAction;

// Rule Definition
export interface AutomationRule {
  id: number;
  name: string;
  description?: string;
  deviceId?: number; // null = applies to all devices
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleAction[];
  cooldownSeconds: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
}

// Database row (snake_case)
export interface AutomationRuleRow {
  id: number;
  name: string;
  description: string | null;
  device_id: number | null;
  enabled: number;
  conditions: string; // JSON
  actions: string; // JSON
  cooldown_seconds: number;
  priority: number;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
}

// Create/Update DTOs
export interface CreateAutomationRuleDto {
  name: string;
  description?: string;
  deviceId?: number;
  enabled?: boolean;
  conditions: RuleConditions;
  actions: RuleAction[];
  cooldownSeconds?: number;
  priority?: number;
}

export interface UpdateAutomationRuleDto {
  name?: string;
  description?: string;
  deviceId?: number | null;
  enabled?: boolean;
  conditions?: RuleConditions;
  actions?: RuleAction[];
  cooldownSeconds?: number;
  priority?: number;
}

// Automation Log
export interface AutomationLog {
  id: number;
  ruleId: number;
  ruleName?: string;
  deviceId?: number;
  deviceSerial?: string;
  triggerDetails?: Record<string, unknown>;
  actionsExecuted: RuleAction[];
  success: boolean;
  errorMessage?: string;
  executionTimeMs: number;
  timestamp: string;
}

export interface AutomationLogRow {
  id: number;
  rule_id: number;
  rule_name: string | null;
  device_id: number | null;
  device_serial: string | null;
  trigger_details: string | null; // JSON
  actions_executed: string | null; // JSON
  success: number;
  error_message: string | null;
  execution_time_ms: number | null;
  timestamp: string;
}

// Slack Settings
export interface SlackSettings {
  id: number;
  webhookUrl?: string;
  incomingSecret?: string;
  defaultChannel?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlackSettingsRow {
  id: number;
  webhook_url: string | null;
  incoming_secret: string | null;
  default_channel: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface UpdateSlackSettingsDto {
  webhookUrl?: string;
  incomingSecret?: string;
  defaultChannel?: string;
  enabled?: boolean;
}

// Device metrics for condition evaluation
export interface DeviceMetrics {
  serialNumber: string;
  deviceId: number;
  online: boolean;
  soc: number;
  temperature: number;
  acInputWatts: number;
  solarInputWatts: number;
  acOutputWatts: number;
  dcOutputWatts: number;
  totalInputWatts: number;
  totalOutputWatts: number;
  hasError: boolean;
  errorCodes: number[];
}

// Evaluation context
export interface EvaluationContext {
  metrics: DeviceMetrics;
  currentTime: Date;
  previousMetrics?: DeviceMetrics; // For detecting changes
}

// Evaluation result
export interface EvaluationResult {
  matches: boolean;
  matchedConditions: string[]; // Human-readable descriptions
  failedConditions?: string[];
}

// Action execution result
export interface ActionExecutionResult {
  action: RuleAction;
  success: boolean;
  error?: string;
  response?: unknown;
}
