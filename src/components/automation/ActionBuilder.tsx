import { Plus, X, Zap, Power, Battery, MessageSquare, BatteryCharging } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  RuleAction,
  ActionType,
} from '@/types/automation'

const ACTION_OPTIONS: { value: ActionType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'setAcOutput', label: 'Set AC Output', icon: Power },
  { value: 'setDcOutput', label: 'Set DC Output', icon: Zap },
  { value: 'setChargingPower', label: 'Set Charging Power', icon: BatteryCharging },
  { value: 'setMaxChargeSoc', label: 'Set Max Charge SOC', icon: Battery },
  { value: 'setMinDischargeSoc', label: 'Set Min Discharge SOC', icon: Battery },
  { value: 'sendSlackNotification', label: 'Send Slack Notification', icon: MessageSquare },
]

interface ActionBuilderProps {
  actions: RuleAction[]
  onChange: (actions: RuleAction[]) => void
}

function createDefaultAction(type: ActionType): RuleAction {
  switch (type) {
    case 'setAcOutput':
      return { type: 'setAcOutput', params: { enabled: true } }
    case 'setDcOutput':
      return { type: 'setDcOutput', params: { enabled: true } }
    case 'setChargingPower':
      return { type: 'setChargingPower', params: { watts: 1000 } }
    case 'setMaxChargeSoc':
      return { type: 'setMaxChargeSoc', params: { maxSoc: 80 } }
    case 'setMinDischargeSoc':
      return { type: 'setMinDischargeSoc', params: { minSoc: 10 } }
    case 'sendSlackNotification':
      return { type: 'sendSlackNotification', params: { message: 'Device {device}: SOC is {soc}%' } }
  }
}

function ActionEditor({
  action,
  onChange,
  onRemove,
}: {
  action: RuleAction
  onChange: (action: RuleAction) => void
  onRemove: () => void
}) {
  const renderActionInputs = () => {
    switch (action.type) {
      case 'setAcOutput':
      case 'setDcOutput': {
        const enabled = action.params.enabled
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">Turn</span>
            <button
              type="button"
              onClick={() => onChange({ ...action, params: { enabled: true } })}
              className={cn(
                "px-3 py-1 text-sm rounded-md border transition-colors",
                enabled ? "bg-green-500 text-white border-green-500" : "hover:bg-accent"
              )}
            >
              ON
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...action, params: { enabled: false } })}
              className={cn(
                "px-3 py-1 text-sm rounded-md border transition-colors",
                !enabled ? "bg-red-500 text-white border-red-500" : "hover:bg-accent"
              )}
            >
              OFF
            </button>
          </div>
        )
      }
      case 'setChargingPower': {
        const watts = action.params.watts
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">Set to</span>
            <input
              type="number"
              min={200}
              max={2900}
              step={100}
              value={watts}
              onChange={(e) => onChange({
                ...action,
                params: { watts: Math.min(2900, Math.max(200, parseInt(e.target.value) || 200)) }
              })}
              className="h-9 w-24 rounded-md border bg-background px-3 text-sm"
            />
            <span className="text-sm text-muted-foreground">W (200-2900)</span>
          </div>
        )
      }
      case 'setMaxChargeSoc': {
        const maxSoc = action.params.maxSoc
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">Set to</span>
            <input
              type="number"
              min={50}
              max={100}
              value={maxSoc}
              onChange={(e) => onChange({
                ...action,
                params: { maxSoc: Math.min(100, Math.max(50, parseInt(e.target.value) || 50)) }
              })}
              className="h-9 w-20 rounded-md border bg-background px-3 text-sm"
            />
            <span className="text-sm text-muted-foreground">% (50-100)</span>
          </div>
        )
      }
      case 'setMinDischargeSoc': {
        const minSoc = action.params.minSoc
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">Set to</span>
            <input
              type="number"
              min={0}
              max={30}
              value={minSoc}
              onChange={(e) => onChange({
                ...action,
                params: { minSoc: Math.min(30, Math.max(0, parseInt(e.target.value) || 0)) }
              })}
              className="h-9 w-20 rounded-md border bg-background px-3 text-sm"
            />
            <span className="text-sm text-muted-foreground">% (0-30)</span>
          </div>
        )
      }
      case 'sendSlackNotification': {
        return (
          <div className="flex-1 space-y-2">
            <textarea
              value={action.params.message}
              onChange={(e) => onChange({
                ...action,
                params: { ...action.params, message: e.target.value }
              })}
              placeholder="Message template..."
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
            />
            <div className="text-xs text-muted-foreground">
              Variables: {'{device}'}, {'{soc}'}, {'{temperature}'}, {'{acInput}'}, {'{solarInput}'}, {'{rule}'}
            </div>
          </div>
        )
      }
    }
  }

  const ActionIcon = ACTION_OPTIONS.find(a => a.value === action.type)?.icon || Zap

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-background">
      <div className="p-2 rounded-lg bg-primary/10">
        <ActionIcon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 space-y-2">
        <select
          value={action.type}
          onChange={(e) => onChange(createDefaultAction(e.target.value as ActionType))}
          className="h-9 rounded-md border bg-muted px-3 text-sm font-medium"
        >
          {ACTION_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="pl-1">
          {renderActionInputs()}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="p-1 hover:bg-red-500/10 text-red-500 rounded transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

export function ActionBuilder({ actions, onChange }: ActionBuilderProps) {
  const addAction = (type: ActionType) => {
    onChange([...actions, createDefaultAction(type)])
  }

  const removeAction = (index: number) => {
    onChange(actions.filter((_, i) => i !== index))
  }

  const updateAction = (index: number, action: RuleAction) => {
    const newActions = [...actions]
    newActions[index] = action
    onChange(newActions)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Actions</h3>
      <div className="space-y-2">
        {actions.map((action, index) => (
          <ActionEditor
            key={index}
            action={action}
            onChange={(a) => updateAction(index, a)}
            onRemove={() => removeAction(index)}
          />
        ))}
      </div>
      {actions.length === 0 && (
        <div className="p-4 rounded-lg border border-dashed text-center text-sm text-muted-foreground">
          No actions configured. Add at least one action.
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Add action:</span>
        {ACTION_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => addAction(opt.value)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border hover:bg-accent transition-colors"
          >
            <Plus className="w-3 h-3" />
            <opt.icon className="w-3 h-3" />
          </button>
        ))}
      </div>
    </div>
  )
}
