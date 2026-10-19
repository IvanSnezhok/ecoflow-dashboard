import { cn } from '@/lib/utils'
import { Battery, Zap, Thermometer, Heart, RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import type { ExtraBatteryState } from '@/types/device'
import { ErrorTooltip } from '@/components/ui/ErrorTooltip'
import { getErrorInfo } from '@/utils/errorCodes'

// Capacity of a DELTA Pro and its Smart Extra Battery in Wh
const BATTERY_CAPACITY_WH = 3600

/** Wh per pack for a product: the DELTA Max (2000) and its extra battery hold 2016 Wh each. */
export function packCapacityWh(deviceType: string): number {
  return /^DELTA[ _-]?MAX$/i.test(deviceType.trim()) ? 2016 : BATTERY_CAPACITY_WH
}

interface BatteryPackProps {
  mainSoc: number
  mainIsCharging: boolean
  mainTemp?: number
  /** bmsMaster.errCode; status values like 6 (full) show as a green badge */
  mainErrCode?: number
  mainCapacityWh?: number // Optional main battery capacity, defaults to 3600Wh
  extraBatteryCapacityWh?: number // Optional extra battery capacity, defaults to 3600Wh
  extraBattery1?: ExtraBatteryState | null
  extraBattery2?: ExtraBatteryState | null
}

interface BatteryUnitProps {
  label: string
  soc: number
  isCharging: boolean
  temp?: number
  cycles?: number
  soh?: number
  voltage?: number
  remainingWh?: number
  fullCapacityWh?: number
  errCode?: number
  errType?: 'bms' | 'battery'
  isMain?: boolean
  /** ISO time of the pack's last report, shown when the latest quota omitted it */
  heldSince?: string
}

function ageText(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  return minutes < 1 ? 'just now' : `${minutes} min ago`
}

// Calculate Wh from SOC and capacity
function calculateWhFromSoc(soc: number, capacityWh: number): number {
  return Math.round((soc / 100) * capacityWh)
}

function BatteryUnit({
  label,
  soc,
  isCharging,
  temp,
  cycles,
  soh,
  voltage,
  remainingWh,
  fullCapacityWh,
  errCode,
  errType = 'battery',
  isMain = false,
  heldSince,
}: BatteryUnitProps) {
  const getBatteryColor = () => {
    if (soc <= 20) return 'bg-energy-red'
    if (soc <= 40) return 'bg-energy-yellow'
    return 'bg-energy-green'
  }

  const getTextColor = () => {
    if (soc <= 20) return 'text-energy-red'
    if (soc <= 40) return 'text-energy-yellow'
    return 'text-energy-green'
  }

  // errCode 6 = fully charged, 23 = charged to the user's limit: status, not an error
  const errInfo = errCode ? getErrorInfo(errType, errCode) : null
  const hasError = errInfo !== null && errInfo.severity !== 'info'

  return (
    <div
      className={cn(
        'p-3 rounded-sm border transition-all',
        isMain ? 'bg-card border-border' : 'bg-muted/30 border-border/50',
        hasError && (errInfo?.severity === 'error' ? 'border-energy-red/50' : 'border-energy-yellow/50')
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-semibold uppercase tracking-wider',
            isMain ? 'text-foreground' : 'text-muted-foreground'
          )}>
            {label}
          </span>
          {isCharging && (
            <Zap className="w-3 h-3 text-energy-green animate-pulse" fill="currentColor" />
          )}
          {heldSince && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
              title="The device skipped this battery in its latest report; showing its last values"
            >
              <Clock className="w-3 h-3" />
              {ageText(heldSince)}
            </span>
          )}
        </div>
        {/* Wh display */}
        {remainingWh !== undefined && (
          <span className="text-xs font-mono font-semibold text-foreground">
            {remainingWh.toLocaleString()}
            <span className="text-muted-foreground text-[10px]">Wh</span>
            {fullCapacityWh && (
              <span className="text-muted-foreground text-[10px]">/{fullCapacityWh}</span>
            )}
          </span>
        )}
      </div>
      {errInfo && errCode !== undefined && (
        <div className="-mt-1 mb-2">
          <ErrorTooltip errorCode={errCode} errorType={errType}>
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
              errInfo.severity === 'info' && 'bg-green-500/10 text-green-700 dark:text-green-400',
              errInfo.severity === 'warning' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
              errInfo.severity === 'error' && 'bg-red-500/10 text-red-600 dark:text-red-400'
            )}>
              {errInfo.severity === 'info'
                ? <CheckCircle2 className="w-3 h-3" />
                : <AlertTriangle className="w-3 h-3" />}
              {errInfo.title}
              {errInfo.severity !== 'info' && <span className="font-mono">#{errCode}</span>}
            </span>
          </ErrorTooltip>
        </div>
      )}

      {/* Battery Bar */}
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1 h-6 rounded-sm border border-border bg-muted/50 overflow-hidden">
          {/* Segments */}
          <div className="absolute inset-0 flex">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="flex-1 border-r border-border/30 last:border-r-0" />
            ))}
          </div>
          {/* Fill */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-all duration-500',
              getBatteryColor(),
              isCharging && 'animate-pulse'
            )}
            style={{ width: `${soc}%` }}
          >
            {/* Stripes */}
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)',
              }}
            />
          </div>
        </div>
        {/* Percentage */}
        <span className={cn('font-mono text-sm font-bold tabular-nums w-12 text-right', getTextColor())}>
          {soc}%
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 text-[10px]">
        {temp !== undefined && (
          <div className="flex items-center gap-1">
            <Thermometer className="w-3 h-3 text-energy-yellow" />
            <span className="font-mono">{temp}°</span>
          </div>
        )}
        {cycles !== undefined && (
          <div className="flex items-center gap-1">
            <RefreshCw className="w-3 h-3 text-energy-purple" />
            <span className="font-mono">{cycles}</span>
          </div>
        )}
        {soh !== undefined && (
          <div className="flex items-center gap-1">
            <Heart className={cn(
              'w-3 h-3',
              soh >= 90 ? 'text-energy-green' : soh >= 70 ? 'text-energy-yellow' : 'text-energy-red'
            )} />
            <span className="font-mono">{soh}%</span>
          </div>
        )}
        {voltage !== undefined && (
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-energy-blue" />
            <span className="font-mono">{(voltage / 1000).toFixed(1)}V</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function BatteryPack({
  mainSoc,
  mainIsCharging,
  mainTemp,
  mainErrCode,
  mainCapacityWh = BATTERY_CAPACITY_WH,
  extraBatteryCapacityWh = BATTERY_CAPACITY_WH,
  extraBattery1,
  extraBattery2,
}: BatteryPackProps) {
  // Calculate battery Wh based on SOC and fixed capacity (3600Wh for all EcoFlow batteries)
  const mainRemainingWh = calculateWhFromSoc(mainSoc, mainCapacityWh)

  // Calculate extra batteries Wh based on SOC (all have 3600Wh capacity)
  const extra1RemainingWh = extraBattery1 ? calculateWhFromSoc(extraBattery1.soc, extraBatteryCapacityWh) : 0
  const extra2RemainingWh = extraBattery2 ? calculateWhFromSoc(extraBattery2.soc, extraBatteryCapacityWh) : 0

  const batteries = [
    {
      label: 'Main',
      soc: mainSoc,
      isCharging: mainIsCharging,
      temp: mainTemp,
      remainingWh: mainRemainingWh,
      fullCapacityWh: mainCapacityWh,
      errCode: mainErrCode,
      errType: 'bms',
      isMain: true
    },
    extraBattery1 && {
      label: 'Extra 1',
      soc: extraBattery1.soc,
      isCharging: extraBattery1.inputWatts > extraBattery1.outputWatts,
      temp: extraBattery1.temp,
      cycles: extraBattery1.cycles,
      soh: extraBattery1.soh,
      voltage: extraBattery1.vol,
      remainingWh: extra1RemainingWh,
      fullCapacityWh: extraBatteryCapacityWh,
      errCode: extraBattery1.errCode,
      heldSince: extraBattery1.held ? extraBattery1.lastUpdated : undefined,
    },
    extraBattery2 && {
      label: 'Extra 2',
      soc: extraBattery2.soc,
      isCharging: extraBattery2.inputWatts > extraBattery2.outputWatts,
      temp: extraBattery2.temp,
      cycles: extraBattery2.cycles,
      soh: extraBattery2.soh,
      voltage: extraBattery2.vol,
      remainingWh: extra2RemainingWh,
      fullCapacityWh: extraBatteryCapacityWh,
      errCode: extraBattery2.errCode,
      heldSince: extraBattery2.held ? extraBattery2.lastUpdated : undefined,
    },
  ].filter(Boolean) as BatteryUnitProps[]

  // Calculate totals
  const totalSoc = batteries.reduce((sum, b) => sum + b.soc, 0)
  const avgSoc = Math.round(totalSoc / batteries.length)
  const totalRemainingWh = mainRemainingWh + extra1RemainingWh + extra2RemainingWh
  const totalCapacityWh = mainCapacityWh + (extraBattery1 ? extraBatteryCapacityWh : 0) + (extraBattery2 ? extraBatteryCapacityWh : 0)

  return (
    <div className="rounded-sm border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Battery className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider">Battery Pack</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">{batteries.length} units</span>
          <span className="font-mono font-bold text-foreground">
            {avgSoc}%
          </span>
        </div>
      </div>

      {/* Total Capacity Bar */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Total Capacity
          </span>
          <span className="text-sm font-mono font-bold text-foreground">
            {totalRemainingWh.toLocaleString()}
            <span className="text-muted-foreground text-[10px]">Wh</span>
            <span className="text-muted-foreground text-[10px]"> / {totalCapacityWh.toLocaleString()}</span>
          </span>
        </div>
        <div className="relative h-3 rounded-sm bg-muted overflow-hidden">
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-all duration-500',
              avgSoc <= 20 ? 'bg-energy-red' : avgSoc <= 40 ? 'bg-energy-yellow' : 'bg-energy-green'
            )}
            style={{ width: `${avgSoc}%` }}
          />
          {/* Dividers showing individual batteries */}
          {batteries.length > 1 && batteries.slice(0, -1).map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-0.5 bg-card"
              style={{ left: `${((i + 1) / batteries.length) * 100}%` }}
            />
          ))}
        </div>
      </div>

      {/* Individual Battery Units */}
      <div className="p-3 space-y-2">
        {batteries.map((battery, i) => (
          <BatteryUnit key={i} {...battery} />
        ))}
      </div>
    </div>
  )
}
