/**
 * Automation Routes
 * CRUD operations for automation rules, logs, and Slack settings
 */

import { Router, type Request, type Response } from 'express'
import {
  getAllAutomationRules,
  getAutomationRuleById,
  createAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
  toggleAutomationRule,
  getAutomationLogs,
  getSlackSettings,
  upsertSlackSettings,
  getDeviceBySn,
} from '../db/database.js'
import type {
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
  UpdateSlackSettingsDto,
  AutomationRule,
  AutomationRuleRow,
  RuleConditions,
  RuleAction,
  SlackSettings,
  SlackSettingsRow,
  AutomationLog,
  AutomationLogRow,
} from '../types/automation.js'
import { validateConditions } from '../services/conditionEvaluator.js'
import { validateActions } from '../services/actionExecutor.js'
import { testRule, buildDeviceMetrics, clearRuleCooldown, getRuleCooldownStatus } from '../services/automationEngine.js'
import { testSlackConnection, parseSlackCommand, getSlackHelpMessage } from '../services/slackService.js'
import { ecoflowApi } from '../services/ecoflowApi.js'

export const automationRouter = Router()

// ==================== Helper Functions ====================

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

function rowToSlackSettings(row: SlackSettingsRow): SlackSettings {
  return {
    id: row.id,
    webhookUrl: row.webhook_url || undefined,
    incomingSecret: row.incoming_secret || undefined,
    defaultChannel: row.default_channel || undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToLog(row: AutomationLogRow): AutomationLog {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name || undefined,
    deviceId: row.device_id || undefined,
    deviceSerial: row.device_serial || undefined,
    triggerDetails: row.trigger_details ? JSON.parse(row.trigger_details) : undefined,
    actionsExecuted: row.actions_executed ? JSON.parse(row.actions_executed) : [],
    success: row.success === 1,
    errorMessage: row.error_message || undefined,
    executionTimeMs: row.execution_time_ms || 0,
    timestamp: row.timestamp,
  }
}

// ==================== Rules CRUD ====================

// GET /api/automation/rules - List all rules
automationRouter.get('/rules', (_req: Request, res: Response) => {
  try {
    const rows = getAllAutomationRules()
    const rules = rows.map(rowToRule)
    res.json({ success: true, data: rules })
  } catch (error) {
    console.error('[AutomationRoutes] Error getting rules:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// GET /api/automation/rules/:id - Get single rule
automationRouter.get('/rules/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid rule ID' })
      return
    }

    const row = getAutomationRuleById(id)
    if (!row) {
      res.status(404).json({ success: false, error: 'Rule not found' })
      return
    }

    const rule = rowToRule(row)

    // Add cooldown status
    const cooldownStatus = getRuleCooldownStatus(rule.id, rule.cooldownSeconds)

    res.json({
      success: true,
      data: {
        ...rule,
        cooldownStatus,
      },
    })
  } catch (error) {
    console.error('[AutomationRoutes] Error getting rule:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// POST /api/automation/rules - Create new rule
automationRouter.post('/rules', (req: Request, res: Response) => {
  try {
    const body = req.body as CreateAutomationRuleDto

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      res.status(400).json({ success: false, error: 'Name is required' })
      return
    }

    if (!body.conditions || !validateConditions(body.conditions)) {
      res.status(400).json({ success: false, error: 'Invalid conditions format' })
      return
    }

    if (!body.actions || !validateActions(body.actions)) {
      res.status(400).json({ success: false, error: 'Invalid actions format' })
      return
    }

    const id = createAutomationRule(body)
    const row = getAutomationRuleById(id)
    if (!row) {
      res.status(500).json({ success: false, error: 'Failed to create rule' })
      return
    }

    res.status(201).json({ success: true, data: rowToRule(row) })
  } catch (error) {
    console.error('[AutomationRoutes] Error creating rule:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// PUT /api/automation/rules/:id - Update rule
automationRouter.put('/rules/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid rule ID' })
      return
    }

    const body = req.body as UpdateAutomationRuleDto

    // Validate conditions if provided
    if (body.conditions && !validateConditions(body.conditions)) {
      res.status(400).json({ success: false, error: 'Invalid conditions format' })
      return
    }

    // Validate actions if provided
    if (body.actions && !validateActions(body.actions)) {
      res.status(400).json({ success: false, error: 'Invalid actions format' })
      return
    }

    const updated = updateAutomationRule(id, body)
    if (!updated) {
      res.status(404).json({ success: false, error: 'Rule not found or no changes' })
      return
    }

    const row = getAutomationRuleById(id)
    if (!row) {
      res.status(404).json({ success: false, error: 'Rule not found' })
      return
    }

    res.json({ success: true, data: rowToRule(row) })
  } catch (error) {
    console.error('[AutomationRoutes] Error updating rule:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// DELETE /api/automation/rules/:id - Delete rule
automationRouter.delete('/rules/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid rule ID' })
      return
    }

    const deleted = deleteAutomationRule(id)
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Rule not found' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[AutomationRoutes] Error deleting rule:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// POST /api/automation/rules/:id/toggle - Toggle rule enabled/disabled
automationRouter.post('/rules/:id/toggle', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid rule ID' })
      return
    }

    const { enabled } = req.body as { enabled: boolean }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ success: false, error: 'Enabled must be a boolean' })
      return
    }

    const toggled = toggleAutomationRule(id, enabled)
    if (!toggled) {
      res.status(404).json({ success: false, error: 'Rule not found' })
      return
    }

    const row = getAutomationRuleById(id)
    if (!row) {
      res.status(404).json({ success: false, error: 'Rule not found' })
      return
    }

    res.json({ success: true, data: rowToRule(row) })
  } catch (error) {
    console.error('[AutomationRoutes] Error toggling rule:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// POST /api/automation/rules/:id/test - Test rule (dry run)
automationRouter.post('/rules/:id/test', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid rule ID' })
      return
    }

    const { serialNumber } = req.body as { serialNumber: string }
    if (!serialNumber) {
      res.status(400).json({ success: false, error: 'Serial number is required' })
      return
    }

    // Get device and its quota
    const device = getDeviceBySn(serialNumber) as { id: number; online: number } | undefined
    if (!device) {
      res.status(404).json({ success: false, error: 'Device not found' })
      return
    }

    // Get current device data
    const quota = await ecoflowApi.getDeviceQuota(serialNumber)

    // Build metrics
    const metrics = buildDeviceMetrics(
      device.id,
      serialNumber,
      device.online === 1,
      quota as Record<string, unknown>
    )

    // Test rule
    const result = await testRule(id, metrics)

    res.json({
      success: true,
      data: {
        ...result,
        currentMetrics: {
          soc: metrics.soc,
          temperature: metrics.temperature,
          acInputWatts: metrics.acInputWatts,
          solarInputWatts: metrics.solarInputWatts,
          acOutputWatts: metrics.acOutputWatts,
          dcOutputWatts: metrics.dcOutputWatts,
        },
      },
    })
  } catch (error) {
    console.error('[AutomationRoutes] Error testing rule:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// POST /api/automation/rules/:id/clear-cooldown - Clear rule cooldown
automationRouter.post('/rules/:id/clear-cooldown', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid rule ID' })
      return
    }

    clearRuleCooldown(id)
    res.json({ success: true })
  } catch (error) {
    console.error('[AutomationRoutes] Error clearing cooldown:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// ==================== Logs ====================

// GET /api/automation/logs - Get execution logs
automationRouter.get('/logs', (req: Request, res: Response) => {
  try {
    const ruleId = req.query.ruleId ? parseInt(req.query.ruleId as string, 10) : undefined
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId as string, 10) : undefined
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0

    const rows = getAutomationLogs({ ruleId, deviceId, limit, offset })
    const logs = rows.map(rowToLog)

    res.json({ success: true, data: logs })
  } catch (error) {
    console.error('[AutomationRoutes] Error getting logs:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// ==================== Slack Settings ====================

// GET /api/automation/slack - Get Slack settings
automationRouter.get('/slack', (_req: Request, res: Response) => {
  try {
    const row = getSlackSettings()
    if (!row) {
      res.json({
        success: true,
        data: {
          id: 0,
          webhookUrl: undefined,
          incomingSecret: undefined,
          defaultChannel: undefined,
          enabled: false,
          createdAt: '',
          updatedAt: '',
        },
      })
      return
    }

    const settings = rowToSlackSettings(row)

    // Mask webhook URL for security
    if (settings.webhookUrl) {
      settings.webhookUrl = settings.webhookUrl.substring(0, 40) + '...'
    }

    res.json({ success: true, data: settings })
  } catch (error) {
    console.error('[AutomationRoutes] Error getting Slack settings:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// PUT /api/automation/slack - Update Slack settings
automationRouter.put('/slack', (req: Request, res: Response) => {
  try {
    const body = req.body as UpdateSlackSettingsDto

    upsertSlackSettings(body)

    const row = getSlackSettings()
    if (!row) {
      res.status(500).json({ success: false, error: 'Failed to update settings' })
      return
    }

    const settings = rowToSlackSettings(row)

    res.json({ success: true, data: settings })
  } catch (error) {
    console.error('[AutomationRoutes] Error updating Slack settings:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// POST /api/automation/slack/test - Test Slack connection
automationRouter.post('/slack/test', async (_req: Request, res: Response) => {
  try {
    const result = await testSlackConnection()
    res.json({ success: result.success, error: result.error })
  } catch (error) {
    console.error('[AutomationRoutes] Error testing Slack:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// POST /api/automation/slack/command - Incoming Slack command webhook
automationRouter.post('/slack/command', async (req: Request, res: Response) => {
  try {
    const { text, user_id, channel_id, response_url } = req.body

    console.log(`[SlackCommand] User ${user_id} in ${channel_id}: ${text}`)

    const parsed = parseSlackCommand(text || '')

    if (!parsed) {
      res.json({
        response_type: 'ephemeral',
        text: 'Invalid command. Use `/ecoflow help` for available commands.',
      })
      return
    }

    if (parsed.action === 'help') {
      res.json({
        response_type: 'ephemeral',
        text: getSlackHelpMessage(),
      })
      return
    }

    // TODO: Implement actual command execution
    // For now, return acknowledgment
    res.json({
      response_type: 'in_channel',
      text: `Command received: ${parsed.action} ${parsed.value || ''} ${parsed.deviceSerial || ''}`,
    })
  } catch (error) {
    console.error('[AutomationRoutes] Error processing Slack command:', error)
    res.json({
      response_type: 'ephemeral',
      text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
})
