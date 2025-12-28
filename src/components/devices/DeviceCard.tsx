import { Link } from "react-router-dom";
import { Plug, Sun, Zap, Battery, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeviceWithState } from "@/types/device";
import { BatteryGauge } from "./BatteryGauge";

interface DeviceCardProps {
  device: DeviceWithState;
}

const deviceTypeLabels: Record<string, string> = {
  DELTA_PRO: "Delta Pro",
  DELTA_PRO_3: "Delta Pro 3",
  RIVER: "River",
  RIVER_MAX: "River Max",
  RIVER_PRO: "River Pro",
  SMART_PLUG: "Smart Plug",
};

function PowerMetric({
  icon,
  label,
  value,
  colorClass,
  isActive,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  colorClass: string;
  isActive?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 p-2 rounded-lg transition-all duration-300",
        isActive ? "bg-muted/60" : "bg-transparent",
      )}
    >
      <div
        className={cn(
          "p-1.5 rounded-md transition-colors duration-300",
          isActive ? colorClass : "bg-muted/50",
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </p>
        <p
          className={cn(
            "text-sm font-bold tabular-nums transition-colors duration-300",
            isActive && "text-foreground",
          )}
        >
          {value}
          <span className="text-xs font-normal text-muted-foreground ml-0.5">
            W
          </span>
        </p>
      </div>
    </div>
  );
}

export function DeviceCard({ device }: DeviceCardProps) {
  const state = device.state;

  const isCharging = state ? state.batteryWatts > 0 : false;
  const isDischarging = state ? state.batteryWatts < 0 : false;

  return (
    <Link
      to={`/device/${device.serialNumber}`}
      className={cn(
        "group block rounded-xl border bg-card overflow-hidden",
        "transition-all duration-300 ease-out",
        "hover:shadow-xl hover:shadow-primary/5 hover:border-primary/30",
        "hover:-translate-y-0.5",
        !device.online && "opacity-70",
      )}
    >
      {/* Header with status */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
              {device.name || device.serialNumber}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {deviceTypeLabels[device.deviceType] || device.deviceType}
            </p>
          </div>
          <div
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0",
              "transition-colors duration-300",
              device.online
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                device.online
                  ? "bg-green-500 animate-pulse"
                  : "bg-muted-foreground",
              )}
            />
            {device.online ? "Online" : "Offline"}
          </div>
        </div>
      </div>

      {state ? (
        <>
          {/* Battery section */}
          <div className="px-5 py-4 flex items-center justify-center bg-gradient-to-b from-transparent to-muted/20">
            <BatteryGauge
              soc={state.batterySoc}
              isCharging={isCharging}
              size="md"
            />
          </div>

          {/* Power flow indicators */}
          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-1.5">
              <PowerMetric
                icon={<Plug className="w-3.5 h-3.5 text-purple-500" />}
                label="AC Input"
                value={state.acInputWatts}
                colorClass="bg-purple-500/20"
                isActive={state.acInputWatts > 0}
              />
              <PowerMetric
                icon={<Sun className="w-3.5 h-3.5 text-amber-500" />}
                label="Solar"
                value={state.solarInputWatts}
                colorClass="bg-amber-500/20"
                isActive={state.solarInputWatts > 0}
              />
              <PowerMetric
                icon={<Zap className="w-3.5 h-3.5 text-blue-500" />}
                label="AC Output"
                value={state.acOutputWatts}
                colorClass="bg-blue-500/20"
                isActive={state.acOutputWatts > 0}
              />
              <PowerMetric
                icon={<Battery className="w-3.5 h-3.5 text-cyan-500" />}
                label="DC Output"
                value={state.dcOutputWatts}
                colorClass="bg-cyan-500/20"
                isActive={state.dcOutputWatts > 0}
              />
            </div>

            {/* Power flow summary bar */}
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      isCharging
                        ? "bg-green-500"
                        : isDischarging
                          ? "bg-orange-500"
                          : "bg-muted-foreground",
                    )}
                  />
                  <span className="text-muted-foreground">
                    {isCharging
                      ? "Charging"
                      : isDischarging
                        ? "Discharging"
                        : "Idle"}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground group-hover:text-primary transition-colors">
                  <span className="text-xs">Details</span>
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="px-5 py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
            <Battery className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No data available</p>
        </div>
      )}
    </Link>
  );
}
