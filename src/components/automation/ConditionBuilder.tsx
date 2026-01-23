import { Plus, X, Clock, Calendar, Activity, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ConditionGroup,
  SingleCondition,
  MetricCondition,
  TimeCondition,
  DayOfWeekCondition,
  EventCondition,
  MetricField,
  ComparisonOp,
  DayOfWeek,
  EventType,
} from '@/types/automation'

const METRIC_OPTIONS: { value: MetricField; label: string }[] = [
  { value: 'soc', label: 'SOC (%)' },
  { value: 'temperature', label: 'Temperature (°C)' },
  { value: 'acInputWatts', label: 'AC Input (W)' },
  { value: 'solarInputWatts', label: 'Solar Input (W)' },
  { value: 'acOutputWatts', label: 'AC Output (W)' },
  { value: 'dcOutputWatts', label: 'DC Output (W)' },
  { value: 'totalInputWatts', label: 'Total Input (W)' },
  { value: 'totalOutputWatts', label: 'Total Output (W)' },
]

const COMPARISON_OPTIONS: { value: ComparisonOp; label: string }[] = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '==', label: '=' },
  { value: 'between', label: 'between' },
]

const DAY_OPTIONS: { value: DayOfWeek; label: string }[] = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
]

const EVENT_OPTIONS: { value: EventType; label: string }[] = [
  { value: 'error', label: 'Device has error' },
  { value: 'offline', label: 'Device goes offline' },
  { value: 'online', label: 'Device comes online' },
  { value: 'lowBattery', label: 'Battery below 20%' },
  { value: 'fullBattery', label: 'Battery at 100%' },
]

interface ConditionBuilderProps {
  conditions: ConditionGroup
  onChange: (conditions: ConditionGroup) => void
}

type ConditionType = 'metric' | 'time' | 'dayOfWeek' | 'event'

function createDefaultCondition(type: ConditionType): SingleCondition {
  switch (type) {
    case 'metric':
      return { type: 'metric', field: 'soc', op: '>', value: 50 }
    case 'time':
      return { type: 'time', op: 'between', value: ['09:00', '18:00'] }
    case 'dayOfWeek':
      return { type: 'dayOfWeek', op: 'in', value: ['mon', 'tue', 'wed', 'thu', 'fri'] }
    case 'event':
      return { type: 'event', eventType: 'lowBattery' }
  }
}

// Single Condition Editor
function SingleConditionEditor({
  condition,
  onChange,
  onRemove,
}: {
  condition: SingleCondition
  onChange: (condition: SingleCondition) => void
  onRemove: () => void
}) {
  const renderConditionInputs = () => {
    switch (condition.type) {
      case 'metric': {
        const c = condition as MetricCondition
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={c.field}
              onChange={(e) => onChange({ ...c, field: e.target.value as MetricField })}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              {METRIC_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={c.op}
              onChange={(e) => {
                const newOp = e.target.value as ComparisonOp
                const newValue: number | [number, number] = newOp === 'between'
                  ? [0, 100] as [number, number]
                  : (Array.isArray(c.value) ? c.value[0] : c.value)
                onChange({ ...c, op: newOp, value: newValue })
              }}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              {COMPARISON_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {c.op === 'between' ? (
              <>
                <input
                  type="number"
                  value={Array.isArray(c.value) ? c.value[0] : 0}
                  onChange={(e) => onChange({
                    ...c,
                    value: [parseInt(e.target.value) || 0, Array.isArray(c.value) ? c.value[1] : 100]
                  })}
                  className="h-9 w-20 rounded-md border bg-background px-3 text-sm"
                />
                <span className="text-sm text-muted-foreground">and</span>
                <input
                  type="number"
                  value={Array.isArray(c.value) ? c.value[1] : 100}
                  onChange={(e) => onChange({
                    ...c,
                    value: [Array.isArray(c.value) ? c.value[0] : 0, parseInt(e.target.value) || 100]
                  })}
                  className="h-9 w-20 rounded-md border bg-background px-3 text-sm"
                />
              </>
            ) : (
              <input
                type="number"
                value={typeof c.value === 'number' ? c.value : 0}
                onChange={(e) => onChange({ ...c, value: parseInt(e.target.value) || 0 })}
                className="h-9 w-24 rounded-md border bg-background px-3 text-sm"
              />
            )}
          </div>
        )
      }
      case 'time': {
        const c = condition as TimeCondition
        return (
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm">Between</span>
            <input
              type="time"
              value={Array.isArray(c.value) ? c.value[0] : c.value}
              onChange={(e) => onChange({
                ...c,
                value: [e.target.value, Array.isArray(c.value) ? c.value[1] : '18:00']
              })}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            />
            <span className="text-sm text-muted-foreground">and</span>
            <input
              type="time"
              value={Array.isArray(c.value) ? c.value[1] : '18:00'}
              onChange={(e) => onChange({
                ...c,
                value: [Array.isArray(c.value) ? c.value[0] : '09:00', e.target.value]
              })}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            />
          </div>
        )
      }
      case 'dayOfWeek': {
        const c = condition as DayOfWeekCondition
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <select
              value={c.op}
              onChange={(e) => onChange({ ...c, op: e.target.value as 'in' | 'notIn' })}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="in">is</option>
              <option value="notIn">is not</option>
            </select>
            <div className="flex gap-1 flex-wrap">
              {DAY_OPTIONS.map(day => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => {
                    const newDays = c.value.includes(day.value)
                      ? c.value.filter(d => d !== day.value)
                      : [...c.value, day.value]
                    onChange({ ...c, value: newDays })
                  }}
                  className={cn(
                    "px-2 py-1 text-xs rounded-md border transition-colors",
                    c.value.includes(day.value)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-accent"
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        )
      }
      case 'event': {
        const c = condition as EventCondition
        return (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            <select
              value={c.eventType}
              onChange={(e) => onChange({ ...c, eventType: e.target.value as EventType })}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              {EVENT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )
      }
    }
  }

  return (
    <div className="flex items-center gap-2 p-3 rounded-lg border bg-background">
      <select
        value={condition.type}
        onChange={(e) => {
          const newType = e.target.value as ConditionType
          onChange(createDefaultCondition(newType))
        }}
        className="h-9 rounded-md border bg-muted px-3 text-sm font-medium"
      >
        <option value="metric">Metric</option>
        <option value="time">Time</option>
        <option value="dayOfWeek">Day</option>
        <option value="event">Event</option>
      </select>
      <div className="flex-1">
        {renderConditionInputs()}
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

// Condition Group Editor
function ConditionGroupEditor({
  group,
  onChange,
  depth = 0,
}: {
  group: ConditionGroup
  onChange: (group: ConditionGroup) => void
  depth?: number
}) {
  const addCondition = (type: ConditionType) => {
    onChange({
      ...group,
      conditions: [...group.conditions, createDefaultCondition(type)],
    })
  }

  const removeCondition = (index: number) => {
    onChange({
      ...group,
      conditions: group.conditions.filter((_, i) => i !== index),
    })
  }

  const updateCondition = (index: number, condition: SingleCondition | ConditionGroup) => {
    const newConditions = [...group.conditions]
    newConditions[index] = condition
    onChange({ ...group, conditions: newConditions })
  }

  return (
    <div className={cn(
      "rounded-lg border p-4 space-y-3",
      depth === 0 ? "bg-muted/30" : "bg-muted/10"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Match</span>
          <select
            value={group.operator}
            onChange={(e) => onChange({ ...group, operator: e.target.value as 'AND' | 'OR' })}
            className="h-8 rounded-md border bg-background px-2 text-sm font-medium"
          >
            <option value="AND">ALL (AND)</option>
            <option value="OR">ANY (OR)</option>
          </select>
          <span className="text-sm text-muted-foreground">of the following</span>
        </div>
      </div>

      <div className="space-y-2">
        {group.conditions.map((condition, index) => (
          <div key={index}>
            {'operator' in condition ? (
              <ConditionGroupEditor
                group={condition}
                onChange={(g) => updateCondition(index, g)}
                depth={depth + 1}
              />
            ) : (
              <SingleConditionEditor
                condition={condition}
                onChange={(c) => updateCondition(index, c)}
                onRemove={() => removeCondition(index)}
              />
            )}
            {index < group.conditions.length - 1 && (
              <div className="flex items-center justify-center py-1">
                <span className="text-xs font-medium text-muted-foreground px-2 py-0.5 rounded bg-muted">
                  {group.operator}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t">
        <button
          type="button"
          onClick={() => addCondition('metric')}
          className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border hover:bg-accent transition-colors"
        >
          <Plus className="w-3 h-3" />
          <Activity className="w-3 h-3" />
          Metric
        </button>
        <button
          type="button"
          onClick={() => addCondition('time')}
          className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border hover:bg-accent transition-colors"
        >
          <Plus className="w-3 h-3" />
          <Clock className="w-3 h-3" />
          Time
        </button>
        <button
          type="button"
          onClick={() => addCondition('dayOfWeek')}
          className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border hover:bg-accent transition-colors"
        >
          <Plus className="w-3 h-3" />
          <Calendar className="w-3 h-3" />
          Day
        </button>
        <button
          type="button"
          onClick={() => addCondition('event')}
          className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border hover:bg-accent transition-colors"
        >
          <Plus className="w-3 h-3" />
          <AlertTriangle className="w-3 h-3" />
          Event
        </button>
      </div>
    </div>
  )
}

export function ConditionBuilder({ conditions, onChange }: ConditionBuilderProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Conditions</h3>
      <ConditionGroupEditor group={conditions} onChange={onChange} />
    </div>
  )
}
