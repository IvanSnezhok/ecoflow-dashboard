import { cn } from '@/lib/utils'
import { Sun, Plug, Home, Battery, Zap } from 'lucide-react'
import { POWER_STATUS, socTextColor, type PowerStatus } from '@/lib/deviceStatus'

interface EnergyFlowDiagramProps {
  solarInput: number
  acInput: number
  acOutput: number
  batterySoc: number
  status: PowerStatus
  /** e.g. "1h 20m to full" */
  remaining?: string | null
}

// Literal class names, so Tailwind generates them
const FLOW_TONES = {
  yellow: { line: 'stroke-energy-yellow', arrow: 'border-l-energy-yellow' },
  purple: { line: 'stroke-energy-purple', arrow: 'border-l-energy-purple' },
  blue: { line: 'stroke-energy-blue', arrow: 'border-l-energy-blue' },
}

/** A dashed line with an arrowhead; the dashes move while power flows */
function Flow({ active, tone }: { active: boolean; tone: keyof typeof FLOW_TONES }) {
  return (
    <>
      <div className="relative flex-1 h-3 min-w-[12px] sm:min-w-[40px]">
        <svg className="w-full h-full" preserveAspectRatio="none">
          <line
            x1="0"
            y1="50%"
            x2="100%"
            y2="50%"
            className={cn('transition-colors duration-300', active ? cn(FLOW_TONES[tone].line, 'animate-flow-dash') : 'stroke-border')}
            strokeWidth="2"
            strokeDasharray="8 4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div
        className={cn(
          'w-0 h-0 border-y-[5px] border-y-transparent border-l-[8px] transition-colors flex-shrink-0',
          active ? FLOW_TONES[tone].arrow : 'border-l-border'
        )}
      />
    </>
  )
}

function EnergyNode({
  icon,
  label,
  value,
  unit,
  active,
  colorClass,
}: {
  icon: React.ReactNode
  label: string
  value: number
  unit: string
  active: boolean
  colorClass: string
}) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[52px] sm:min-w-[70px]">
      <div
        className={cn(
          'p-2 sm:p-2.5 rounded-lg transition-all duration-300',
          active ? colorClass : 'bg-muted/50 text-muted-foreground'
        )}
      >
        {icon}
      </div>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </span>
      <span className={cn(
        'text-sm sm:text-base font-mono font-bold tabular-nums',
        active ? 'text-foreground' : 'text-muted-foreground'
      )}>
        {value}
        <span className="text-[10px] font-normal text-muted-foreground">{unit}</span>
      </span>
    </div>
  )
}

export function EnergyFlowDiagram({
  solarInput,
  acInput,
  acOutput,
  batterySoc,
  status,
  remaining,
}: EnergyFlowDiagramProps) {
  const totalInput = solarInput + acInput
  const netPower = totalInput - acOutput
  const isCharging = status === 'charging'
  const isDischarging = status === 'discharging'

  return (
    <div className="p-3 sm:p-4 rounded-sm border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" />
          Energy Flow
        </h4>
        <div className="flex items-center gap-2 min-w-0">
          {remaining && <span className="text-[10px] font-mono text-muted-foreground truncate">{remaining}</span>}
          <span
            className={cn('text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm shrink-0', POWER_STATUS[status].badge)}
            title={status === 'bypass' ? 'AC input powers the AC output directly; the battery is resting' : undefined}
          >
            {POWER_STATUS[status].label}
          </span>
        </div>
      </div>

      {/* Flow Diagram - Horizontal Layout */}
      <div className="flex items-center gap-1.5 sm:gap-3">
        {/* Input Sources Column */}
        <div className="flex flex-col gap-4">
          {/* Solar */}
          <EnergyNode
            icon={<Sun className="w-5 h-5" />}
            label="Solar"
            value={solarInput}
            unit="W"
            active={solarInput > 0}
            colorClass="bg-energy-yellow/20 text-energy-yellow"
          />
          {/* AC Input */}
          <EnergyNode
            icon={<Plug className="w-5 h-5" />}
            label="AC In"
            value={acInput}
            unit="W"
            active={acInput > 0}
            colorClass="bg-energy-purple/20 text-energy-purple"
          />
        </div>

        {/* Input Lines to Battery */}
        <div className="flex flex-col gap-4 flex-1 min-w-0">
          {/* Solar line */}
          <div className="flex items-center h-[70px]">
            <Flow active={solarInput > 0} tone="yellow" />
          </div>
          {/* AC Input line */}
          <div className="flex items-center h-[70px]">
            <Flow active={acInput > 0} tone="purple" />
          </div>
        </div>

        {/* Battery (Center) */}
        <div className="flex flex-col items-center px-0 sm:px-4">
          <div
            className={cn(
              'relative p-3 sm:p-5 rounded-lg border-2 transition-all duration-300',
              isCharging ? 'bg-energy-green/5 border-energy-green/40' :
              isDischarging ? 'bg-energy-blue/5 border-energy-blue/40' :
              'bg-muted/30 border-border'
            )}
          >
            {/* Battery Icon with charging bolt */}
            <div className="relative flex items-center justify-center">
              {/* Offset battery icon to visually center it (compensate for terminal on right) */}
              <Battery className={cn(
                'w-10 h-10 sm:w-14 sm:h-14 transition-colors -mr-1',
                isCharging ? 'text-energy-green' :
                isDischarging ? 'text-energy-blue' :
                'text-muted-foreground'
              )} />
              {/* Charging bolt - centered on battery body */}
              {isCharging && (
                <Zap
                  className="w-5 h-5 text-energy-green absolute animate-pulse"
                  fill="currentColor"
                  style={{
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-60%, -50%)'
                  }}
                />
              )}
            </div>
            {/* SOC display */}
            <div className="text-center mt-2">
              <span className={cn('text-2xl sm:text-3xl font-mono font-bold tabular-nums', socTextColor(batterySoc))}>
                {batterySoc}%
              </span>
            </div>
          </div>

          {/* Net flow indicator */}
          <div className="mt-2 text-center">
            <span className={cn(
              'text-sm font-mono font-semibold',
              netPower > 0 ? 'text-energy-green' :
              netPower < 0 ? 'text-energy-blue' :
              'text-muted-foreground'
            )}>
              {netPower > 0 ? `+${netPower}W` : netPower < 0 ? `${netPower}W` : '0W'}
            </span>
          </div>
        </div>

        {/* Output Line from Battery */}
        <div className="flex items-center flex-1 min-w-0">
          <Flow active={acOutput > 0} tone="blue" />
        </div>

        {/* Output Node */}
        <EnergyNode
          icon={<Home className="w-5 h-5" />}
          label="AC Out"
          value={acOutput}
          unit="W"
          active={acOutput > 0}
          colorClass="bg-energy-blue/20 text-energy-blue"
        />
      </div>
    </div>
  )
}
