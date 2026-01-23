import { Link } from "react-router-dom";
import { Plug, Sun, Zap, ArrowRight, Power, Battery } from "lucide-react";
import { cn } from "@/lib/utils";
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

export function DeviceCard({ device }: DeviceCardProps) {
  const state = device.state;

  const isCharging = state ? state.batteryWatts > 0 : false;
  const isDischarging = state ? state.batteryWatts < 0 : false;
  const soc = state?.batterySoc || 0;

  const totalInput = (state?.acInputWatts || 0) + (state?.solarInputWatts || 0);
  const acOutput = state?.acOutputWatts || 0;

  // Battery color based on level
  const getBatteryColor = () => {
    if (soc <= 20) return 'bg-energy-red';
    if (soc <= 40) return 'bg-energy-yellow';
    return 'bg-energy-green';
  };

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
                      getBatteryColor(),
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

          {/* AC Status indicator */}
          <div className="px-4 pb-4 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              {/* AC Status */}
              <div className={cn(
                "flex items-center gap-1.5 text-[10px] font-mono",
                state.acOutputWatts > 0 ? "text-energy-blue" : "text-muted-foreground/50"
              )}>
                <span className={cn(
                  "w-1.5 h-1.5 rounded-sm",
                  state.acOutputWatts > 0 ? "bg-energy-blue" : "bg-muted-foreground/30"
                )} />
                AC OUTPUT
              </div>

              {/* Details link */}
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground group-hover:text-primary transition-colors">
                <span>Details</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="px-4 py-8 text-center">
          <Battery className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No data</p>
        </div>
      )}
    </Link>
  );
}
