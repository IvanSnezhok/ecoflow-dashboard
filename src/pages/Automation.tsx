import { useState, useEffect } from 'react'
import {
  Zap,
  Plus,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Power,
  PowerOff,
  Clock,
  Battery,
  Sun,
  Thermometer,
  Activity,
  Bell,
  Trash2,
  Play,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Pencil,
  ArrowRight,
} from 'lucide-react'
import { api } from '@/services/api'
import { useDeviceStore } from '@/stores/deviceStore'
import { cn } from '@/lib/utils'
import type {
  AutomationRule,
  AutomationLog,
  RuleAction,
  ConditionGroup,
  SingleCondition,
  CreateAutomationRuleDto,
} from '@/types/automation'
import { RuleEditor } from '@/components/automation/RuleEditor'

// Get icon for condition type
function getConditionIcon(condition: SingleCondition | ConditionGroup): React.ReactNode {
  if ('operator' in condition) {
    return <Zap className="w-3 h-3" />
  }

  const c = condition as SingleCondition
  switch (c.type) {
    case 'metric': {
      const field = (c as { field: string }).field
      if (field.includes('soc') || field.includes('Soc')) return <Battery className="w-3 h-3 text-energy-green" />
      if (field.includes('temp') || field.includes('Temp')) return <Thermometer className="w-3 h-3 text-energy-yellow" />
      if (field.includes('solar') || field.includes('Solar')) return <Sun className="w-3 h-3 text-energy-yellow" />
      return <Activity className="w-3 h-3 text-energy-blue" />
    }
    case 'time':
      return <Clock className="w-3 h-3 text-energy-purple" />
    case 'dayOfWeek':
      return <Clock className="w-3 h-3 text-energy-purple" />
    case 'event':
      return <Zap className="w-3 h-3 text-energy-blue" />
    default:
      return <Activity className="w-3 h-3" />
  }
}

// Format condition for display
function formatCondition(condition: SingleCondition | ConditionGroup): string {
  if ('operator' in condition) {
    const parts = condition.conditions.map(c => formatCondition(c as SingleCondition | ConditionGroup))
    return `(${parts.join(` ${condition.operator} `)})`
  }

  const c = condition as SingleCondition
  switch (c.type) {
    case 'metric': {
      const field = (c as { field: string }).field
      const op = (c as { op: string }).op
      const value = (c as { value: number | [number, number] }).value
      const fieldLabel = field.replace(/([A-Z])/g, ' $1').trim()
      if (op === 'between' && Array.isArray(value)) {
        return `${fieldLabel} between ${value[0]} and ${value[1]}`
      }
      return `${fieldLabel} ${op} ${value}`
    }
    case 'time': {
      const op = (c as { op: string }).op
      const value = (c as { value: string | [string, string] }).value
      if (op === 'between' && Array.isArray(value)) {
        return `Time between ${value[0]} and ${value[1]}`
      }
      return `Time equals ${value}`
    }
    case 'dayOfWeek': {
      const op = (c as { op: string }).op
      const days = (c as { value: string[] }).value
      return `Day ${op === 'in' ? 'is' : 'is not'} ${days.join(', ')}`
    }
    case 'event': {
      const eventType = (c as { eventType: string }).eventType
      return `Event: ${eventType}`
    }
    default:
      return 'Unknown condition'
  }
}

// Format action for display
function formatAction(action: RuleAction): { text: string; icon: React.ReactNode } {
  switch (action.type) {
    case 'setAcOutput':
      return {
        text: `AC Output: ${action.params.enabled ? 'ON' : 'OFF'}`,
        icon: <Power className={cn("w-3 h-3", action.params.enabled ? "text-energy-green" : "text-muted-foreground")} />
      }
    case 'setDcOutput':
      return {
        text: `DC Output: ${action.params.enabled ? 'ON' : 'OFF'}`,
        icon: <Power className={cn("w-3 h-3", action.params.enabled ? "text-energy-green" : "text-muted-foreground")} />
      }
    case 'setChargingPower':
      return {
        text: `Charging Power: ${action.params.watts}W`,
        icon: <Zap className="w-3 h-3 text-energy-purple" />
      }
    case 'setMaxChargeSoc':
      return {
        text: `Max Charge: ${action.params.maxSoc}%`,
        icon: <Battery className="w-3 h-3 text-energy-green" />
      }
    case 'setMinDischargeSoc':
      return {
        text: `Min Discharge: ${action.params.minSoc}%`,
        icon: <Battery className="w-3 h-3 text-energy-blue" />
      }
    case 'sendSlackNotification':
      return {
        text: `Slack: "${action.params.message.substring(0, 25)}${action.params.message.length > 25 ? '...' : ''}"`,
        icon: <Bell className="w-3 h-3 text-energy-yellow" />
      }
    default:
      return { text: 'Unknown action', icon: <Activity className="w-3 h-3" /> }
  }
}

// Get flat list of conditions for display
function getConditionsList(condition: SingleCondition | ConditionGroup): SingleCondition[] {
  if ('operator' in condition) {
    return condition.conditions.flatMap(c => getConditionsList(c as SingleCondition | ConditionGroup))
  }
  return [condition as SingleCondition]
}

// Rule Card Component with WHEN/THEN structure
function RuleCard({
  rule,
  onToggle,
  onDelete,
  onTest,
  onEdit,
  expanded,
  onExpand,
  deviceName,
}: {
  rule: AutomationRule
  onToggle: (id: number, enabled: boolean) => void
  onDelete: (id: number) => void
  onTest: (id: number) => void
  onEdit: (rule: AutomationRule) => void
  expanded: boolean
  onExpand: (id: number) => void
  deviceName?: string
}) {
  const [isTogglingState, setIsTogglingState] = useState(false)
  const [isDeletingState, setIsDeletingState] = useState(false)

  const handleToggle = async () => {
    setIsTogglingState(true)
    await onToggle(rule.id, !rule.enabled)
    setIsTogglingState(false)
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the rule "${rule.name}"?`)) return
    setIsDeletingState(true)
    await onDelete(rule.id)
    setIsDeletingState(false)
  }

  const conditions = getConditionsList(rule.conditions)

  return (
    <div className={cn(
      "rounded-sm border bg-card overflow-hidden transition-all",
      rule.enabled ? "border-l-4 border-l-energy-green" : "border-l-4 border-l-muted-foreground/30 opacity-60"
    )}>
      <div
        className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => onExpand(rule.id)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Rule name and status */}
            <div className="flex items-center gap-2 mb-2">
              <Zap className={cn(
                "w-4 h-4 flex-shrink-0",
                rule.enabled ? "text-energy-green" : "text-muted-foreground"
              )} />
              <h3 className="font-semibold text-sm truncate">{rule.name}</h3>
              {rule.enabled && rule.cooldownStatus?.inCooldown && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-energy-yellow/10 text-energy-yellow font-mono">
                  Cooldown: {rule.cooldownStatus.remainingSeconds}s
                </span>
              )}
            </div>

            {/* WHEN / THEN preview */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-10">WHEN</span>
              <div className="flex items-center gap-1 flex-wrap">
                {conditions.slice(0, 2).map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted rounded-sm">
                    {getConditionIcon(c)}
                    <span className="font-mono text-[10px] truncate max-w-[100px]">
                      {formatCondition(c).split(' ').slice(0, 3).join(' ')}
                    </span>
                  </span>
                ))}
                {conditions.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">+{conditions.length - 2}</span>
                )}
              </div>
              <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">THEN</span>
              <div className="flex items-center gap-1">
                {rule.actions.slice(0, 2).map((a, i) => {
                  const { icon, text } = formatAction(a)
                  return (
                    <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted rounded-sm">
                      {icon}
                      <span className="font-mono text-[10px] truncate max-w-[80px]">{text.split(':')[0]}</span>
                    </span>
                  )
                })}
                {rule.actions.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">+{rule.actions.length - 2}</span>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground font-mono">
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                {deviceName || 'All devices'}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {rule.cooldownSeconds}s cooldown
              </span>
              {rule.executionCount !== undefined && rule.executionCount > 0 && (
                <span className="flex items-center gap-1">
                  <Play className="w-3 h-3" />
                  {rule.executionCount}x
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleToggle()
              }}
              disabled={isTogglingState}
              className={cn(
                "p-1.5 rounded-sm transition-colors",
                rule.enabled
                  ? "bg-energy-green/10 text-energy-green hover:bg-energy-green/20"
                  : "bg-muted hover:bg-muted/80"
              )}
            >
              {isTogglingState ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : rule.enabled ? (
                <Power className="w-4 h-4" />
              ) : (
                <PowerOff className="w-4 h-4" />
              )}
            </button>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/20 p-4 space-y-4">
          {/* Description */}
          {rule.description && (
            <p className="text-xs text-muted-foreground">{rule.description}</p>
          )}

          {/* Conditions - WHEN */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-energy-blue"></span>
              When
            </h4>
            <div className="space-y-1">
              {conditions.map((c, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-card rounded-sm px-3 py-2 text-xs border">
                  {getConditionIcon(c)}
                  <span className="font-mono">{formatCondition(c)}</span>
                </div>
              ))}
              {'operator' in rule.conditions && (
                <div className="text-[10px] text-muted-foreground font-mono px-3">
                  Combined with: {rule.conditions.operator.toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* Actions - THEN */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-energy-green"></span>
              Then
            </h4>
            <div className="space-y-1">
              {rule.actions.map((action, idx) => {
                const { icon, text } = formatAction(action)
                return (
                  <div key={idx} className="flex items-center gap-2 bg-card rounded-sm px-3 py-2 text-xs border">
                    {icon}
                    <span className="font-mono">{text}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Actions buttons */}
          <div className="flex items-center justify-between pt-3 border-t">
            <button
              onClick={() => onTest(rule.id)}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm border hover:bg-muted transition-colors"
            >
              <Play className="w-3 h-3" />
              Test
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(rule)
                }}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm border hover:bg-muted transition-colors"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeletingState}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm text-energy-red hover:bg-energy-red/10 transition-colors"
              >
                {isDeletingState ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Log Entry Component
function LogEntry({ log }: { log: AutomationLog }) {
  return (
    <div className={cn(
      "flex items-start gap-2 p-2 rounded-sm border",
      log.success ? "border-energy-green/30 bg-energy-green/5" : "border-energy-red/30 bg-energy-red/5"
    )}>
      {log.success ? (
        <CheckCircle className="w-4 h-4 text-energy-green flex-shrink-0 mt-0.5" />
      ) : (
        <XCircle className="w-4 h-4 text-energy-red flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-medium truncate">{log.ruleName || `Rule #${log.ruleId}`}</span>
          <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
            {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
          {log.deviceSerial || 'Unknown'} • {log.executionTimeMs}ms
        </div>
        {log.errorMessage && (
          <div className="text-[10px] text-energy-red mt-1 font-mono">{log.errorMessage}</div>
        )}
      </div>
    </div>
  )
}

export default function Automation() {
  const { devices } = useDeviceStore()
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [logs, setLogs] = useState<AutomationLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null)

  const fetchData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [rulesRes, logsRes] = await Promise.all([
        api.getAutomationRules(),
        api.getAutomationLogs({ limit: 50 }),
      ])
      setRules(rulesRes.data.data)
      setLogs(logsRes.data.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      const res = await api.toggleAutomationRule(id, enabled)
      setRules(rules.map(r => r.id === id ? res.data.data : r))
    } catch (err) {
      console.error('Failed to toggle rule:', err)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.deleteAutomationRule(id)
      setRules(rules.filter(r => r.id !== id))
    } catch (err) {
      console.error('Failed to delete rule:', err)
    }
  }

  const handleTest = async (id: number) => {
    const device = devices[0]
    if (!device) {
      alert('No devices available for testing')
      return
    }

    try {
      const res = await api.testAutomationRule(id, device.serialNumber)
      const result = res.data.data
      alert(
        `Test Result: ${result.matches ? 'WOULD TRIGGER' : 'Would NOT trigger'}\n\n` +
        `Matched: ${result.matchedConditions.join(', ') || 'None'}\n` +
        `Failed: ${result.failedConditions?.join(', ') || 'None'}\n\n` +
        `Current metrics:\n` +
        `SOC: ${result.currentMetrics.soc}%\n` +
        `Temperature: ${result.currentMetrics.temperature}°C\n` +
        `AC Input: ${result.currentMetrics.acInputWatts}W\n` +
        `Solar Input: ${result.currentMetrics.solarInputWatts}W`
      )
    } catch (err) {
      console.error('Failed to test rule:', err)
      alert('Failed to test rule: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const getDeviceName = (deviceId?: number) => {
    if (!deviceId) return undefined
    const device = devices.find(d => d.id === deviceId)
    return device?.name || device?.serialNumber
  }

  const handleCreateRule = async (dto: CreateAutomationRuleDto) => {
    const res = await api.createAutomationRule(dto)
    setRules([...rules, res.data.data])
  }

  const handleUpdateRule = async (dto: CreateAutomationRuleDto) => {
    if (!editingRule) return
    const res = await api.updateAutomationRule(editingRule.id, dto)
    setRules(rules.map(r => r.id === editingRule.id ? res.data.data : r))
  }

  const openEditor = (rule?: AutomationRule) => {
    setEditingRule(rule || null)
    setShowEditor(true)
  }

  const closeEditor = () => {
    setShowEditor(false)
    setEditingRule(null)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertTriangle className="w-10 h-10 text-energy-red mb-4" />
        <p className="text-sm font-medium text-energy-red">Error Loading Data</p>
        <p className="text-xs text-muted-foreground mt-1 font-mono">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 px-3 py-1.5 rounded-sm bg-primary text-primary-foreground text-xs font-mono uppercase tracking-wider hover:bg-primary/90"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Automation</h1>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Rules to automate device control
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-1.5 rounded-sm border hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-sm border text-xs font-mono uppercase tracking-wider transition-colors",
              showLogs && "bg-muted"
            )}
          >
            <Activity className="w-3.5 h-3.5" />
            Logs
          </button>
          <button
            onClick={() => openEditor()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-primary text-primary-foreground text-xs font-mono uppercase tracking-wider hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Rule
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Rules List */}
        <div className={cn("space-y-3", showLogs ? "lg:col-span-2" : "lg:col-span-3")}>
          {rules.length === 0 ? (
            <div className="rounded-sm border bg-card p-8 text-center">
              <Zap className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-sm font-medium">No Automation Rules</h3>
              <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                Create your first rule to automate device control
              </p>
              <button
                onClick={() => openEditor()}
                className="mt-4 px-3 py-1.5 rounded-sm bg-primary text-primary-foreground text-xs font-mono uppercase tracking-wider hover:bg-primary/90"
              >
                Create Rule
              </button>
            </div>
          ) : (
            rules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onTest={handleTest}
                onEdit={openEditor}
                expanded={expandedRuleId === rule.id}
                onExpand={(id) => setExpandedRuleId(expandedRuleId === id ? null : id)}
                deviceName={getDeviceName(rule.deviceId)}
              />
            ))
          )}
        </div>

        {/* Logs Panel */}
        {showLogs && (
          <div className="lg:col-span-1">
            <div className="rounded-sm border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider">Execution Logs</span>
              </div>
              <div className="max-h-[600px] overflow-y-auto p-2 space-y-2">
                {logs.length === 0 ? (
                  <div className="p-4 text-center text-[10px] text-muted-foreground font-mono">
                    No logs yet
                  </div>
                ) : (
                  logs.map(log => (
                    <LogEntry key={log.id} log={log} />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Rule Editor Modal */}
      {showEditor && (
        <RuleEditor
          rule={editingRule}
          devices={devices.map(d => ({ id: d.id, serialNumber: d.serialNumber, name: d.name }))}
          onSave={editingRule ? handleUpdateRule : handleCreateRule}
          onClose={closeEditor}
        />
      )}
    </div>
  )
}
