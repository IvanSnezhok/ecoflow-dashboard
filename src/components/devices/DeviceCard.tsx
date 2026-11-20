import { memo } from "react";
import { Link } from "react-router-dom";
import { Plug, Sun, Zap, ArrowRight, Power, Battery } from "lucide-react";
import { cn } from "@/lib/utils";
import { POWER_STATUS, dataSourceChip, packFlowView, powerStatus, remainingTime, socBgColor, socTextColor } from "@/lib/deviceStatus";
import type { DeviceWithState } from "@/types/device";

interface DeviceCardProps {
  device: DeviceWithState;
}

const deviceTypeLabels: Record<string, string> = {
  DELTA_PRO: "Delta Pro",
  DELTA_PRO_3: "Delta Pro 3",
  "DELTA Pro": "Delta Pro",
  "DELTA Max": "Delta Max 2000",
  RIVER: "River",
  RIVER_MAX: "River Max",
  RIVER_PRO: "River Pro",
  SMART_PLUG: "Smart Plug",
};

export const DeviceCard = memo(function DeviceCard({ device }: DeviceCardProps) {
  const state = device.state;

  const status = state ? powerStatus(state) : "standby";
  const isCharging = status === "charging";
  const isDischarging = status === "discharging";
  const soc = state?.batterySoc || 0;
  const remaining = state ? remainingTime(state, status) : null;
  const source = dataSourceChip(device);

  const extraPacks = [
    { label: "Extra 1", pack: state?.extraBattery1 },
    { label: "Extra 2", pack: state?.extraBattery2 },
  ].flatMap(({ label, pack }) => (pack ? [{ label, pack }] : []));

  const totalInput = (state?.acInputWatts || 0) + (state?.solarInputWatts || 0);
  const acOutput = state?.acOutputWatts || 0;

  return (
    <Link
      to={`/device/${device.serialNumber}`}
      className={cn(
        "group block rounded-sm border bg-card overflow-hidden",
        "transition-all duration-200 ease-out",
        "hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5",
        // Colored left border for status
        "border-l-4",
        device.online
          ? isCharging
            ? "border-l-energy-green"
            : isDischarging
              ? "border-l-energy-blue"
              : "border-l-energy-green/50"
          : "border-l-muted-foreground/30",
        !device.online && "opacity-60",
      )}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
              {device.name || device.serialNumber}
            </h3>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {deviceTypeLabels[device.deviceType] || device.deviceType}
            </p>
          </div>
          {/* Status badge */}
          <div className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-medium",
            device.online
              ? "bg-energy-green/10 text-energy-green"
              : "bg-muted text-muted-foreground"
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              device.online ? "bg-energy-green" : "bg-muted-foreground"
            )} />
            {device.online ? "ON" : "OFF"}
            {source && <span className="text-primary" title={source.title}>· {source.label}</span>}
          </div>
        </div>
      </div>

      {state ? (
        <>
          {/* Horizontal Battery Bar */}
          <div className="px-4 pb-3">
            <div className="flex items-center gap-3">
              {/* Battery container */}
              <div className="relative flex-1">
                <div className="relative h-8 rounded-sm border-2 border-border bg-muted/30 overflow-hidden">
                  {/* Segment lines */}
                  <div className="absolute inset-0 flex">
                    {[...Array(9)].map((_, i) => (
                      <div key={i} className="flex-1 border-r border-border/20 last:border-r-0" />
                    ))}
                  </div>
                  {/* Fill */}
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 transition-all duration-500",
                      socBgColor(soc),
                      isCharging && "animate-pulse"
                    )}
                    style={{ width: `${soc}%` }}
                  >
                    {/* Diagonal stripes */}
                    <div
                      className="absolute inset-0 opacity-20"
                      style={{
                        backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(255,255,255,0.4) 3px, rgba(255,255,255,0.4) 6px)',
                      }}
                    />
                  </div>
                  {/* Percentage inside */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-mono text-sm font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                      {soc}%
                    </span>
                  </div>
                </div>
                {/* Battery terminal */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full w-1.5 h-4 rounded-r-sm border-2 border-l-0 border-border bg-muted" />
              </div>

              {/* Charging indicator */}
              {isCharging && (
                <Zap className="w-5 h-5 text-energy-green animate-pulse" fill="currentColor" />
              )}
            </div>
          </div>

          {/* Power Flow: IN → OUT format */}
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-xs">
              {/* Input */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {state.solarInputWatts > 0 && (
                    <Sun className="w-3.5 h-3.5 text-energy-yellow" />
                  )}
                  {state.acInputWatts > 0 && (
                    <Plug className="w-3.5 h-3.5 text-energy-purple" />
                  )}
                  {totalInput === 0 && (
                    <Plug className="w-3.5 h-3.5 text-muted-foreground/50" />
                  )}
                </div>
                <span className={cn(
                  "font-mono font-semibold tabular-nums",
                  totalInput > 0 ? "text-energy-green" : "text-muted-foreground"
                )}>
                  {totalInput}W
                </span>
              </div>

              {/* Arrow */}
              <ArrowRight className="w-4 h-4 text-muted-foreground/50" />

              {/* AC Output */}
              <div className="flex items-center gap-2">
                <span className={cn(
                  "font-mono font-semibold tabular-nums",
                  acOutput > 0 ? "text-energy-blue" : "text-muted-foreground"
                )}>
                  {acOutput}W
                </span>
                <Power className={cn(
                  "w-3.5 h-3.5",
                  acOutput > 0 ? "text-energy-blue" : "text-muted-foreground/50"
                )} />
              </div>
            </div>
          </div>

          {/* Extra batteries: level and what each one is doing */}
          {extraPacks.length > 0 && (
            <div className="px-4 pb-3 space-y-1 text-[10px] font-mono">
              {extraPacks.map(({ label, pack }) => {
                const flow = pack.flow ? packFlowView(pack.flow) : null;
                return (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground uppercase tracking-wider">{label}</span>
                    <span className="flex items-center gap-2">
                      {flow && (
                        <span className={cn("tabular-nums", POWER_STATUS[flow.status].text)}>
                          {flow.status === "standby"
                            ? "idle"
                            : `${flow.status === "charging" ? "+" : "−"}${flow.watts} W`}
                        </span>
                      )}
                      <span className={cn("font-semibold tabular-nums w-9 text-right", socTextColor(pack.soc))}>
                        {pack.soc}%
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* What the battery is doing, and for how long it can */}
          <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between gap-2 text-[10px] font-mono">
            <span className={cn("font-semibold uppercase tracking-wider", POWER_STATUS[status].text)}>
              {POWER_STATUS[status].label}
              {remaining && <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground">{remaining}</span>}
            </span>
            {device.capabilities?.acOutput !== false && !state.acOutEnabled && (
              <span className="text-muted-foreground" title="The AC sockets are switched off">AC off</span>
            )}
          </div>
        </>
      ) : (
        <div className="px-4 pb-4 flex items-start gap-2 text-xs text-muted-foreground">
          <Battery className="w-4 h-4 shrink-0 text-muted-foreground/50" />
          <div className="min-w-0">
            <p>
              {!device.online
                ? "Offline: the EcoFlow cloud does not see this device"
                : device.quotaError
                  ? "EcoFlow cloud sends no data for this device"
                  : device.profileStatus === "read-only" ? "Read-only profile — telemetry mapping pending" : "No data"}
            </p>
            {device.online && device.quotaError && (
              <p className="mt-1 text-[10px] font-mono text-muted-foreground/70 break-words">
                {device.quotaError} · Details → Data access check
              </p>
            )}
          </div>
        </div>
      )}
    </Link>
  );
});
