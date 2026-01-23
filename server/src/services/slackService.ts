/**
 * Slack Service
 * Handles sending notifications to Slack and processing incoming commands
 */

import { getSlackSettings } from '../db/database.js'

interface SlackMessagePayload {
  text?: string
  channel?: string
  blocks?: SlackBlock[]
  attachments?: SlackAttachment[]
}

interface SlackBlock {
  type: string
  text?: {
    type: string
    text: string
  }
  [key: string]: unknown
}

interface SlackAttachment {
  color?: string
  title?: string
  text?: string
  fields?: Array<{
    title: string
    value: string
    short?: boolean
  }>
  footer?: string
  ts?: number
}

/**
 * Send a message to Slack
 */
export async function sendSlackMessage(
  message: string,
  channel?: string
): Promise<void> {
  const settings = getSlackSettings()

  if (!settings || !settings.enabled || !settings.webhook_url) {
    console.log('[SlackService] Slack not configured or disabled, skipping message')
    return
  }

  const payload: SlackMessagePayload = {
    text: message,
  }

  if (channel || settings.default_channel) {
    payload.channel = channel || settings.default_channel || undefined
  }

  try {
    const response = await fetch(settings.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Slack webhook error: ${response.status} ${response.statusText}`)
    }

    console.log(`[SlackService] Message sent successfully`)
  } catch (error) {
    console.error('[SlackService] Error sending message:', error)
    throw error
  }
}

/**
 * Send a rich formatted message to Slack
 */
export async function sendSlackRichMessage(options: {
  title: string
  message: string
  color?: 'good' | 'warning' | 'danger' | string
  fields?: Array<{ title: string; value: string; short?: boolean }>
  channel?: string
}): Promise<void> {
  const settings = getSlackSettings()

  if (!settings || !settings.enabled || !settings.webhook_url) {
    console.log('[SlackService] Slack not configured or disabled, skipping message')
    return
  }

  const attachment: SlackAttachment = {
    color: options.color || 'good',
    title: options.title,
    text: options.message,
    fields: options.fields,
    footer: 'Ecoflow Dashboard Automation',
    ts: Math.floor(Date.now() / 1000),
  }

  const payload: SlackMessagePayload = {
    attachments: [attachment],
  }

  if (options.channel || settings.default_channel) {
    payload.channel = options.channel || settings.default_channel || undefined
  }

  try {
    const response = await fetch(settings.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Slack webhook error: ${response.status} ${response.statusText}`)
    }

    console.log(`[SlackService] Rich message sent successfully`)
  } catch (error) {
    console.error('[SlackService] Error sending rich message:', error)
    throw error
  }
}

/**
 * Test Slack connection
 */
export async function testSlackConnection(): Promise<{ success: boolean; error?: string }> {
  const settings = getSlackSettings()

  if (!settings || !settings.webhook_url) {
    return { success: false, error: 'Slack webhook URL not configured' }
  }

  try {
    const payload: SlackMessagePayload = {
      text: 'Test message from Ecoflow Dashboard',
    }

    const response = await fetch(settings.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Parse incoming Slack command
 * Format: /ecoflow <command> [params] [device]
 */
export interface SlackCommand {
  command: string
  params: string[]
  deviceSerial?: string
  userId: string
  channelId: string
  responseUrl: string
}

export function parseSlackCommand(text: string): {
  action: string
  value?: string | number | boolean
  deviceSerial?: string
} | null {
  const parts = text.trim().toLowerCase().split(/\s+/)
  if (parts.length === 0) return null

  const action = parts[0]

  switch (action) {
    case 'ac':
      if (parts[1] === 'on') return { action: 'setAcOutput', value: true, deviceSerial: parts[2] }
      if (parts[1] === 'off') return { action: 'setAcOutput', value: false, deviceSerial: parts[2] }
      break

    case 'dc':
      if (parts[1] === 'on') return { action: 'setDcOutput', value: true, deviceSerial: parts[2] }
      if (parts[1] === 'off') return { action: 'setDcOutput', value: false, deviceSerial: parts[2] }
      break

    case 'soc':
    case 'maxsoc': {
      const value = parseInt(parts[1], 10)
      if (!isNaN(value) && value >= 50 && value <= 100) {
        return { action: 'setMaxChargeSoc', value, deviceSerial: parts[2] }
      }
      break
    }

    case 'minsoc': {
      const value = parseInt(parts[1], 10)
      if (!isNaN(value) && value >= 0 && value <= 30) {
        return { action: 'setMinDischargeSoc', value, deviceSerial: parts[2] }
      }
      break
    }

    case 'power': {
      const value = parseInt(parts[1], 10)
      if (!isNaN(value) && value >= 200 && value <= 2900) {
        return { action: 'setChargingPower', value, deviceSerial: parts[2] }
      }
      break
    }

    case 'status':
      return { action: 'getStatus', deviceSerial: parts[1] }

    case 'help':
      return { action: 'help' }
  }

  return null
}

/**
 * Format help message for Slack
 */
export function getSlackHelpMessage(): string {
  return `*Ecoflow Dashboard Commands*

\`/ecoflow ac on [device]\` - Turn AC output on
\`/ecoflow ac off [device]\` - Turn AC output off
\`/ecoflow dc on [device]\` - Turn DC output on
\`/ecoflow dc off [device]\` - Turn DC output off
\`/ecoflow maxsoc <50-100> [device]\` - Set max charge SOC
\`/ecoflow minsoc <0-30> [device]\` - Set min discharge SOC
\`/ecoflow power <200-2900> [device]\` - Set charging power (watts)
\`/ecoflow status [device]\` - Get device status
\`/ecoflow help\` - Show this help message

_If device is omitted, command applies to the first device._`
}
