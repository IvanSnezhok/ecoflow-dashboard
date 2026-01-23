import { useState } from 'react'
import { X, Save, Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConditionBuilder } from './ConditionBuilder'
import { ActionBuilder } from './ActionBuilder'
import type {
  AutomationRule,
  CreateAutomationRuleDto,
  ConditionGroup,
  RuleAction,
} from '@/types/automation'

interface RuleEditorProps {
  rule?: AutomationRule | null
  devices: Array<{ id: number; serialNumber: string; name: string }>
  onSave: (dto: CreateAutomationRuleDto) => Promise<void>
  onClose: () => void
}

interface RuleTemplate {
  name: string
  description: string
  category: 'simple' | 'complex'
  conditions: ConditionGroup
  actions: RuleAction[]
  cooldownSeconds: number
}

const RULE_TEMPLATES: RuleTemplate[] = [
  // Simple templates
  {
    name: 'Low Battery Alert',
    description: 'Notify when battery drops below 20%',
    category: 'simple',
    conditions: {
      operator: 'AND',
      conditions: [
        { type: 'metric', field: 'soc', op: '<', value: 20 },
      ],
    },
    actions: [
      { type: 'sendSlackNotification', params: { message: '🔋 Low battery alert! {device} is at {soc}%' } },
    ],
    cooldownSeconds: 1800,
  },
  {
    name: 'Battery Full',
    description: 'Notify when battery reaches 100%',
    category: 'simple',
    conditions: {
      operator: 'AND',
      conditions: [
        { type: 'metric', field: 'soc', op: '==', value: 100 },
      ],
    },
    actions: [
      { type: 'sendSlackNotification', params: { message: '✅ {device} is fully charged (100%)' } },
    ],
    cooldownSeconds: 3600,
  },
  {
    name: 'High Temperature Warning',
    description: 'Alert when temperature exceeds 40°C',
    category: 'simple',
    conditions: {
      operator: 'AND',
      conditions: [
        { type: 'metric', field: 'temperature', op: '>', value: 40 },
      ],
    },
    actions: [
      { type: 'sendSlackNotification', params: { message: '🌡️ High temperature warning! {device} is at {temperature}°C' } },
    ],
    cooldownSeconds: 600,
  },
  {
    name: 'Device Offline Alert',
    description: 'Notify when device goes offline',
    category: 'simple',
    conditions: {
      operator: 'AND',
      conditions: [
        { type: 'event', eventType: 'offline' },
      ],
    },
    actions: [
      { type: 'sendSlackNotification', params: { message: '⚠️ {device} went offline!' } },
    ],
    cooldownSeconds: 300,
  },
  // Complex templates
  {
    name: 'Night Charging Optimization',
    description: 'Reduce charging power at night when battery is already high',
    category: 'complex',
    conditions: {
      operator: 'AND',
      conditions: [
        { type: 'time', op: 'between', value: ['22:00', '06:00'] },
        { type: 'metric', field: 'soc', op: '>', value: 80 },
        { type: 'metric', field: 'acInputWatts', op: '>', value: 100 },
      ],
    },
    actions: [
      { type: 'setChargingPower', params: { watts: 200 } },
      { type: 'sendSlackNotification', params: { message: '🌙 Night mode: Reduced charging power for {device} (SOC: {soc}%)' } },
    ],
    cooldownSeconds: 3600,
  },
  {
    name: 'Workday Solar Surplus',
    description: 'Enable AC output during work hours when solar input is high',
    category: 'complex',
    conditions: {
      operator: 'AND',
      conditions: [
        { type: 'dayOfWeek', op: 'in', value: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        { type: 'time', op: 'between', value: ['09:00', '17:00'] },
        { type: 'metric', field: 'solarInputWatts', op: '>', value: 500 },
        { type: 'metric', field: 'soc', op: '>', value: 50 },
      ],
    },
    actions: [
      { type: 'setAcOutput', params: { enabled: true } },
      { type: 'sendSlackNotification', params: { message: '☀️ Solar surplus! Enabled AC output for {device} (Solar: {solarInputWatts}W)' } },
    ],
    cooldownSeconds: 1800,
  },
  {
    name: 'Critical Battery Under Load',
    description: 'Alert and reduce output when battery is low with high consumption',
    category: 'complex',
    conditions: {
      operator: 'AND',
      conditions: [
        { type: 'metric', field: 'soc', op: '<', value: 30 },
        { type: 'metric', field: 'totalOutputWatts', op: '>', value: 500 },
      ],
    },
    actions: [
      { type: 'setDcOutput', params: { enabled: false } },
      { type: 'sendSlackNotification', params: { message: '🚨 Critical! {device} at {soc}% with high load. DC output disabled.' } },
    ],
    cooldownSeconds: 600,
  },
  {
    name: 'Weekend Battery Preservation',
    description: 'Limit max charge to 80% on weekends to extend battery life',
    category: 'complex',
    conditions: {
      operator: 'AND',
      conditions: [
        { type: 'dayOfWeek', op: 'in', value: ['sat', 'sun'] },
        { type: 'metric', field: 'soc', op: 'between', value: [75, 85] },
      ],
    },
    actions: [
      { type: 'setMaxChargeSoc', params: { maxSoc: 80 } },
      { type: 'sendSlackNotification', params: { message: '🔋 Weekend mode: {device} charge limit set to 80%' } },
    ],
    cooldownSeconds: 7200,
  },
]

const DEFAULT_CONDITIONS: ConditionGroup = {
  operator: 'AND',
  conditions: [
    { type: 'metric', field: 'soc', op: '<', value: 20 },
  ],
}

const DEFAULT_ACTIONS: RuleAction[] = [
  { type: 'sendSlackNotification', params: { message: 'Device {device}: Low battery alert! SOC is {soc}%' } },
]

export function RuleEditor({ rule, devices, onSave, onClose }: RuleEditorProps) {
  const [name, setName] = useState(rule?.name || '')
  const [description, setDescription] = useState(rule?.description || '')
  const [deviceId, setDeviceId] = useState<number | undefined>(rule?.deviceId)
  const [conditions, setConditions] = useState<ConditionGroup>(rule?.conditions || DEFAULT_CONDITIONS)
  const [actions, setActions] = useState<RuleAction[]>(rule?.actions || DEFAULT_ACTIONS)
  const [cooldownSeconds, setCooldownSeconds] = useState(rule?.cooldownSeconds || 300)
  const [priority] = useState(rule?.priority || 0)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(!rule)

  const applyTemplate = (template: RuleTemplate) => {
    setName(template.name)
    setDescription(template.description)
    setConditions(template.conditions)
    setActions(template.actions)
    setCooldownSeconds(template.cooldownSeconds)
    setShowTemplates(false)
  }

  const simpleTemplates = RULE_TEMPLATES.filter(t => t.category === 'simple')
  const complexTemplates = RULE_TEMPLATES.filter(t => t.category === 'complex')

  const isValid = name.trim() && conditions.conditions.length > 0 && actions.length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return

    setIsSaving(true)
    setError(null)

    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        deviceId,
        conditions,
        actions,
        cooldownSeconds,
        priority,
        enabled: true,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-card border shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">
            {rule ? 'Edit Rule' : 'Create New Rule'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(90vh-8rem)] p-4 space-y-6">
          {/* Templates Section - only for new rules */}
          {!rule && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Start from template</span>
                </div>
                {!showTemplates && (
                  <button
                    type="button"
                    onClick={() => setShowTemplates(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Show templates
                  </button>
                )}
              </div>

              {showTemplates && (
                <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
                  {/* Simple Templates */}
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                      Simple Rules
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {simpleTemplates.map((template, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => applyTemplate(template)}
                          className="text-left p-3 rounded-lg border bg-background hover:bg-accent hover:border-primary/50 transition-colors"
                        >
                          <div className="font-medium text-sm">{template.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {template.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Complex Templates */}
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                      Advanced Rules
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {complexTemplates.map((template, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => applyTemplate(template)}
                          className="text-left p-3 rounded-lg border bg-background hover:bg-accent hover:border-primary/50 transition-colors"
                        >
                          <div className="font-medium text-sm">{template.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {template.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowTemplates(false)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Or start from scratch
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Divider after templates */}
          {!rule && <div className="border-t" />}

          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Rule Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Low Battery Alert"
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Device</label>
                <select
                  value={deviceId || ''}
                  onChange={(e) => setDeviceId(e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">All Devices</option>
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name || d.serialNumber}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Cooldown (seconds)</label>
                <input
                  type="number"
                  min={0}
                  max={86400}
                  value={cooldownSeconds}
                  onChange={(e) => setCooldownSeconds(parseInt(e.target.value) || 0)}
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Conditions */}
          <ConditionBuilder conditions={conditions} onChange={setConditions} />

          {/* Divider */}
          <div className="border-t" />

          {/* Actions */}
          <ActionBuilder actions={actions} onChange={setActions} />

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || isSaving}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              (!isValid || isSaving) && "opacity-50 cursor-not-allowed"
            )}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {rule ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}
