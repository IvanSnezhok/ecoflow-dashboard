import { cn } from '@/lib/utils'
import { Sun, Plug, Home, Battery, Zap } from 'lucide-react'

interface EnergyFlowDiagramProps {
  solarInput: number
  acInput: number
  acOutput: number
  batterySoc: number
  isCharging: boolean
  isDischarging: boolean
}

function FlowLine({
  active,
  color,
  className,
}: {
  active: boolean
  color: string
  className?: string
}) {
  // Convert bg color to stroke color for SVG
  const strokeColor = color.replace('bg-', 'stroke-')

  return (
    <div className={cn('relative flex-1 h-3 min-w-[40px]', className)}>
      <svg className="w-full h-full" preserveAspectRatio="none">
        {/* Base dashed line */}
        <line
          x1="0"
          y1="50%"
          x2="100%"
          y2="50%"
          className={cn(
            'transition-all duration-300',
            active ? strokeColor : 'stroke-border'
          )}
          strokeWidth="2"
          strokeDasharray="8 4"
          strokeLinecap="round"
        />
        {/* Animated flow overlay when active */}
        {active && (
          <line
            x1="0"
            y1="50%"
            x2="100%"
            y2="50%"
            className={cn(strokeColor, 'animate-flow-dash')}
            strokeWidth="2"
            strokeDasharray="8 4"
            strokeLinecap="round"
            style={{ opacity: 0.6 }}
          />
        )}
      </svg>
    </div>
  )
}

function FlowArrow({
  active,
  color,
  direction = 'right',
}: {
  active: boolean
  color: string
  direction?: 'right' | 'left'
}) {
  const borderClass = direction === 'right'
    ? color.replace('bg-', 'border-l-')
    : color.replace('bg-', 'border-r-')

  return (
    <div
      className={cn(
        'w-0 h-0 border-y-[5px] border-y-transparent transition-colors flex-shrink-0',
        direction === 'right' ? 'border-l-[8px]' : 'border-r-[8px]',
        active ? borderClass : direction === 'right' ? 'border-l-border' : 'border-r-border'
      )}
    />
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
    <div className="flex flex-col items-center gap-1 min-w-[70px]">
      <div
        className={cn(
          'p-2.5 rounded-lg transition-all duration-300',
          active ? colorClass : 'bg-muted/50 text-muted-foreground'
        )}
      >
        {icon}
      </div>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </span>
      <span className={cn(
        'text-base font-mono font-bold tabular-nums',
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
  isCharging,
  isDischarging,
}: EnergyFlowDiagramProps) {
  const totalInput = solarInput + acInput
  const netPower = totalInput - acOutput

  return (
    <div className="p-4 rounded-sm border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" />
          Energy Flow
        </h4>
        <span className={cn(
          'text-[10px] font-mono px-2 py-0.5 rounded-sm',
          isCharging ? 'bg-energy-green/10 text-energy-green' :
          isDischarging ? 'bg-energy-blue/10 text-energy-blue' :
          'bg-muted text-muted-foreground'
        )}>
          {isCharging ? 'CHARGING' : isDischarging ? 'DISCHARGING' : 'STANDBY'}
        </span>
      </div>

      {/* Flow Diagram - Horizontal Layout */}
      <div className="flex items-center gap-3">
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
        <div className="flex flex-col gap-4 flex-1">
          {/* Solar line */}
          <div className="flex items-center h-[70px]">
            <FlowLine active={solarInput > 0} color="bg-energy-yellow" />
            <FlowArrow active={solarInput > 0} color="bg-energy-yellow" />
          </div>
          {/* AC Input line */}
          <div className="flex items-center h-[70px]">
            <FlowLine active={acInput > 0} color="bg-energy-purple" />
            <FlowArrow active={acInput > 0} color="bg-energy-purple" />
          </div>
        </div>

        {/* Battery (Center) */}
        <div className="flex flex-col items-center px-4">
          <div
            className={cn(
              'relative p-5 rounded-lg border-2 transition-all duration-300',
              isCharging ? 'bg-energy-green/5 border-energy-green/40' :
              isDischarging ? 'bg-energy-blue/5 border-energy-blue/40' :
              'bg-muted/30 border-border'
            )}
          >
            {/* Battery Icon with charging bolt */}
            <div className="relative flex items-center justify-center">
              {/* Offset battery icon to visually center it (compensate for terminal on right) */}
              <Battery className={cn(
                'w-14 h-14 transition-colors -mr-1',
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
              <span className={cn(
                'text-3xl font-mono font-bold tabular-nums',
                batterySoc <= 20 ? 'text-energy-red' :
                batterySoc <= 40 ? 'text-energy-yellow' :
                'text-energy-green'
              )}>
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
        <div className="flex items-center flex-1">
          <FlowLine active={acOutput > 0} color="bg-energy-blue" />
          <FlowArrow active={acOutput > 0} color="bg-energy-blue" />
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

      {/* CSS for animated dashed flow */}
      <style>{`
        @keyframes flow-dash {
          0% { stroke-dashoffset: 24; }
          100% { stroke-dashoffset: 0; }
        }
        .animate-flow-dash {
          animation: flow-dash 0.8s linear infinite;
        }
        .stroke-energy-yellow { stroke: #F59E0B; }
        .stroke-energy-purple { stroke: #A855F7; }
        .stroke-energy-blue { stroke: #3B82F6; }
        .stroke-energy-green { stroke: #10B981; }
        .stroke-border { stroke: #E2E8F0; }
      `}</style>
    </div>
  )
}
