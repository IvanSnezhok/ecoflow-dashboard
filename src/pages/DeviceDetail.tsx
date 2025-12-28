import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Plug,
  Sun,
  Zap,
  Battery,
  Thermometer,
  Power,
  Loader2,
  BatteryCharging,
  BarChart3,
  ExternalLink,
  Clock,
  Cpu,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { useDeviceStore } from "@/stores/deviceStore";
import { BatteryGauge } from "@/components/devices/BatteryGauge";
import { ExtraBatteryCard } from "@/components/devices/ExtraBatteryCard";
import {
  BatteryChart,
  PowerChart,
  PeriodSelector,
  ChartContainer,
  useChartData,
} from "@/components/charts";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { ErrorTooltip } from "@/components/ui/ErrorTooltip";
import type { ChartPeriod, DeviceErrorCodes, LastKnownErrors } from "@/types/device";

// Helper function to check if there are any errors
function hasErrors(errorCodes: DeviceErrorCodes | LastKnownErrors): boolean {
  const hasBaseErrors =
    errorCodes.bmsMasterErrCode !== 0 ||
    errorCodes.invErrCode !== 0 ||
    errorCodes.mpptFaultCode !== 0 ||
    errorCodes.overloadState !== 0 ||
    !errorCodes.emsIsNormal;

  // Check extra battery errors if present (LastKnownErrors)
  if ("bmsSlave1ErrCode" in errorCodes || "bmsSlave2ErrCode" in errorCodes) {
    const lastKnown = errorCodes as LastKnownErrors;
    return (
      hasBaseErrors ||
      (lastKnown.bmsSlave1ErrCode !== undefined && lastKnown.bmsSlave1ErrCode !== 0) ||
      (lastKnown.bmsSlave2ErrCode !== undefined && lastKnown.bmsSlave2ErrCode !== 0)
    );
  }

  return hasBaseErrors;
}

// Power flow card component
function PowerFlowCard({
  icon,
  label,
  value,
  colorClass,
  bgClass,
  isActive,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  colorClass: string;
  bgClass: string;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        "p-4 rounded-xl transition-all duration-300",
        "border border-transparent",
        isActive ? bgClass : "bg-muted/30",
        isActive && "border-current/10 shadow-sm",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "p-1.5 rounded-lg transition-colors duration-300",
            isActive ? colorClass : "bg-muted",
          )}
        >
          {icon}
        </div>
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "text-2xl font-bold tabular-nums transition-colors duration-300",
          isActive && "text-foreground",
        )}
      >
        {value}
        <span className="text-sm font-normal text-muted-foreground ml-1">
          W
        </span>
      </div>
    </div>
  );
}

// Toggle switch component
function ToggleSwitch({
  label,
  description,
  enabled,
  isLoading,
  disabled,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  isLoading: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={isLoading || disabled}
      className={cn(
        "w-full flex items-center justify-between p-4 rounded-xl",
        "transition-all duration-300",
        "hover:bg-muted/60 active:scale-[0.99]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        enabled
          ? "bg-primary/5 border border-primary/20"
          : "bg-muted/30 border border-transparent",
      )}
    >
      <div className="text-left">
        <div className="font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">
          {isLoading ? "Switching..." : description}
        </div>
      </div>
      <div
        className={cn(
          "w-14 h-7 rounded-full transition-all duration-300 relative",
          "shadow-inner",
          enabled ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 absolute top-1 left-1/2 -translate-x-1/2 text-white animate-spin" />
        ) : (
          <div
            className={cn(
              "w-5 h-5 rounded-full bg-white shadow-md",
              "transform transition-all duration-300",
              "absolute top-1",
              enabled ? "left-8" : "left-1",
            )}
          />
        )}
      </div>
    </button>
  );
}

// Slider control component
function SliderControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  isLoading,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  isLoading: boolean;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);
  const pendingValueRef = useRef<number | null>(null);

  // Sync local value with prop when not dragging
  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Number(e.target.value);
    setLocalValue(newValue);
    pendingValueRef.current = newValue;
  };

  const commitChange = () => {
    const pendingValue = pendingValueRef.current;
    if (pendingValue !== null && pendingValue !== value) {
      onChange(pendingValue);
    }
    pendingValueRef.current = null;
    setIsDragging(false);
  };

  const handlePointerDown = () => {
    setIsDragging(true);
  };

  const percentage = ((localValue - min) / (max - min)) * 100;

  return (
    <div
      className={cn(
        "p-4 rounded-xl bg-muted/30 border border-transparent",
        "transition-all duration-300",
        disabled && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {isLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          )}
          <span className="text-lg font-bold tabular-nums">
            {localValue}
            <span className="text-sm font-normal text-muted-foreground ml-1">
              {unit}
            </span>
          </span>
        </div>
      </div>
      <div className="relative h-6 flex items-center">
        {/* Track background */}
        <div className="absolute w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-100"
            style={{ width: `${percentage}%` }}
          />
        </div>
        {/* Thumb */}
        <div
          className="absolute w-5 h-5 bg-white border-2 border-primary rounded-full shadow-md transition-all duration-100 pointer-events-none"
          style={{ left: `calc(${percentage}% - 10px)` }}
        />
        {/* Input */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue}
          onChange={handleChange}
          onPointerDown={handlePointerDown}
          onPointerUp={commitChange}
          onBlur={commitChange}
          disabled={disabled || isLoading}
          className="absolute w-full h-6 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground mt-2">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}

export default function DeviceDetail() {
  const { serialNumber } = useParams<{ serialNumber: string }>();
  const { devices, updateDeviceState, setPendingCommand, removePendingCommand } = useDeviceStore();
  const [isTogglingAc, setIsTogglingAc] = useState(false);
  const [isTogglingDc, setIsTogglingDc] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("24h");

  // Charge settings states
  const [isSettingMaxSoc, setIsSettingMaxSoc] = useState(false);
  const [isSettingMinSoc, setIsSettingMinSoc] = useState(false);
  const [isSettingChargePower, setIsSettingChargePower] = useState(false);

  const device = devices.find((d) => d.serialNumber === serialNumber);
  const {
    data: chartData,
    isLoading: isChartLoading,
    error: chartError,
    refetch: refetchChart,
  } = useChartData(serialNumber || "", chartPeriod);

  const handleToggleAc = async () => {
    if (!device?.state || isTogglingAc) return;

    setIsTogglingAc(true);
    const newState = !device.state.acOutEnabled;

    // Set pending command before optimistic update
    setPendingCommand(device.serialNumber, 'acOutEnabled', newState);
    updateDeviceState(device.serialNumber, { acOutEnabled: newState });

    try {
      await api.setAcOutput(device.serialNumber, newState);
    } catch (error) {
      console.error("Failed to toggle AC output:", error);
      // Remove pending on error and revert
      removePendingCommand(device.serialNumber, 'acOutEnabled');
      updateDeviceState(device.serialNumber, { acOutEnabled: !newState });
      alert(
        "Failed to toggle AC output: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      setIsTogglingAc(false);
    }
  };

  const handleToggleDc = async () => {
    if (!device?.state || isTogglingDc) return;

    setIsTogglingDc(true);
    const newState = !device.state.dcOutEnabled;

    // Set pending command before optimistic update
    setPendingCommand(device.serialNumber, 'dcOutEnabled', newState);
    updateDeviceState(device.serialNumber, { dcOutEnabled: newState });

    try {
      await api.setDcOutput(device.serialNumber, newState);
    } catch (error) {
      console.error("Failed to toggle DC output:", error);
      // Remove pending on error and revert
      removePendingCommand(device.serialNumber, 'dcOutEnabled');
      updateDeviceState(device.serialNumber, { dcOutEnabled: !newState });
      alert(
        "Failed to toggle DC output: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      setIsTogglingDc(false);
    }
  };

  const handleSetMaxSoc = async (value: number) => {
    if (!device?.state || isSettingMaxSoc) return;

    setIsSettingMaxSoc(true);

    // Set pending command before optimistic update
    setPendingCommand(device.serialNumber, 'maxChgSoc', value);
    updateDeviceState(device.serialNumber, { maxChgSoc: value });

    try {
      await api.setMaxChargeSoc(device.serialNumber, value);
    } catch (error) {
      console.error("Failed to set max charge SOC:", error);
      // Remove pending on error
      removePendingCommand(device.serialNumber, 'maxChgSoc');
      alert(
        "Failed to set max charge SOC: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      setIsSettingMaxSoc(false);
    }
  };

  const handleSetMinSoc = async (value: number) => {
    if (!device?.state || isSettingMinSoc) return;

    setIsSettingMinSoc(true);

    // Set pending command before optimistic update
    setPendingCommand(device.serialNumber, 'minDsgSoc', value);
    updateDeviceState(device.serialNumber, { minDsgSoc: value });

    try {
      await api.setMinDischargeSoc(device.serialNumber, value);
    } catch (error) {
      console.error("Failed to set min discharge SOC:", error);
      // Remove pending on error
      removePendingCommand(device.serialNumber, 'minDsgSoc');
      alert(
        "Failed to set min discharge SOC: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      setIsSettingMinSoc(false);
    }
  };

  const handleSetChargePower = async (value: number) => {
    if (!device?.state || isSettingChargePower) return;

    setIsSettingChargePower(true);

    // Set pending command before optimistic update
    setPendingCommand(device.serialNumber, 'acChargingPower', value);
    updateDeviceState(device.serialNumber, { acChargingPower: value });

    try {
      await api.setChargingPower(device.serialNumber, value);
    } catch (error) {
      console.error("Failed to set charging power:", error);
      // Remove pending on error
      removePendingCommand(device.serialNumber, 'acChargingPower');
      alert(
        "Failed to set charging power: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      setIsSettingChargePower(false);
    }
  };

  if (!device) {
    return (
      <div className="space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <div className="rounded-xl border bg-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Battery className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-medium text-muted-foreground">
            Device not found
          </p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {serialNumber}
          </p>
        </div>
      </div>
    );
  }

  const state = device.state;
  const isCharging = state ? state.batteryWatts > 0 : false;
  const isDischarging = state ? state.batteryWatts < 0 : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/"
          className={cn(
            "inline-flex items-center justify-center w-10 h-10 rounded-xl",
            "border bg-card hover:bg-muted transition-colors",
          )}
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold tracking-tight truncate">
            {device.name || device.serialNumber}
          </h2>
          <p className="text-sm text-muted-foreground">
            {device.deviceType} • {device.serialNumber}
          </p>
        </div>
        <div
          className={cn(
            "px-4 py-1.5 rounded-full text-sm font-medium shrink-0",
            "transition-colors duration-300",
            device.online
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full mr-2",
              device.online
                ? "bg-green-500 animate-pulse"
                : "bg-muted-foreground",
            )}
          />
          {device.online ? "Online" : "Offline"}
        </div>
      </div>

      {/* Error Alerts - show current errors or last known errors for offline devices */}
      {state?.errorCodes && hasErrors(state.errorCodes) && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4">
          <h3 className="font-semibold flex items-center gap-2 text-red-600 dark:text-red-400 mb-3">
            <AlertTriangle className="w-5 h-5" />
            Device Errors
            <span className="text-xs font-normal text-muted-foreground ml-2">
              (hover for details)
            </span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {state.errorCodes.bmsMasterErrCode !== 0 && (
              <ErrorTooltip errorCode={state.errorCodes.bmsMasterErrCode} errorType="bms">
                <div className="flex items-center gap-2 text-sm bg-red-500/10 rounded-lg px-3 py-2">
                  <span className="text-red-500 font-medium">BMS Error:</span>
                  <span className="font-mono">{state.errorCodes.bmsMasterErrCode}</span>
                </div>
              </ErrorTooltip>
            )}
            {state.errorCodes.invErrCode !== 0 && (
              <ErrorTooltip errorCode={state.errorCodes.invErrCode} errorType="inv">
                <div className="flex items-center gap-2 text-sm bg-red-500/10 rounded-lg px-3 py-2">
                  <span className="text-red-500 font-medium">Inverter Error:</span>
                  <span className="font-mono">{state.errorCodes.invErrCode}</span>
                </div>
              </ErrorTooltip>
            )}
            {state.errorCodes.mpptFaultCode !== 0 && (
              <ErrorTooltip errorCode={state.errorCodes.mpptFaultCode} errorType="mppt">
                <div className="flex items-center gap-2 text-sm bg-red-500/10 rounded-lg px-3 py-2">
                  <span className="text-red-500 font-medium">MPPT Fault:</span>
                  <span className="font-mono">{state.errorCodes.mpptFaultCode}</span>
                </div>
              </ErrorTooltip>
            )}
            {state.errorCodes.overloadState !== 0 && (
              <ErrorTooltip errorCode={state.errorCodes.overloadState} errorType="overload">
                <div className="flex items-center gap-2 text-sm bg-orange-500/10 rounded-lg px-3 py-2">
                  <span className="text-orange-500 font-medium">Overload:</span>
                  <span className="font-mono">Active</span>
                </div>
              </ErrorTooltip>
            )}
            {!state.errorCodes.emsIsNormal && (
              <ErrorTooltip errorCode={0} errorType="ems">
                <div className="flex items-center gap-2 text-sm bg-orange-500/10 rounded-lg px-3 py-2">
                  <span className="text-orange-500 font-medium">EMS Status:</span>
                  <span className="font-mono">Abnormal</span>
                </div>
              </ErrorTooltip>
            )}
          </div>
        </div>
      )}

      {/* Last Known Errors - show for offline devices */}
      {!device.online && device.lastKnownErrors && hasErrors(device.lastKnownErrors) && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
          <h3 className="font-semibold flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-3">
            <AlertTriangle className="w-5 h-5" />
            Last Known Errors
            <span className="text-xs font-normal text-muted-foreground ml-2">
              (from {new Date(device.lastKnownErrors.timestamp).toLocaleString()})
            </span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {device.lastKnownErrors.bmsMasterErrCode !== 0 && (
              <ErrorTooltip errorCode={device.lastKnownErrors.bmsMasterErrCode} errorType="bms">
                <div className="flex items-center gap-2 text-sm bg-amber-500/10 rounded-lg px-3 py-2">
                  <span className="text-amber-600 font-medium">BMS Error:</span>
                  <span className="font-mono">{device.lastKnownErrors.bmsMasterErrCode}</span>
                </div>
              </ErrorTooltip>
            )}
            {device.lastKnownErrors.invErrCode !== 0 && (
              <ErrorTooltip errorCode={device.lastKnownErrors.invErrCode} errorType="inv">
                <div className="flex items-center gap-2 text-sm bg-amber-500/10 rounded-lg px-3 py-2">
                  <span className="text-amber-600 font-medium">Inverter Error:</span>
                  <span className="font-mono">{device.lastKnownErrors.invErrCode}</span>
                </div>
              </ErrorTooltip>
            )}
            {device.lastKnownErrors.mpptFaultCode !== 0 && (
              <ErrorTooltip errorCode={device.lastKnownErrors.mpptFaultCode} errorType="mppt">
                <div className="flex items-center gap-2 text-sm bg-amber-500/10 rounded-lg px-3 py-2">
                  <span className="text-amber-600 font-medium">MPPT Fault:</span>
                  <span className="font-mono">{device.lastKnownErrors.mpptFaultCode}</span>
                </div>
              </ErrorTooltip>
            )}
            {device.lastKnownErrors.overloadState !== 0 && (
              <ErrorTooltip errorCode={device.lastKnownErrors.overloadState} errorType="overload">
                <div className="flex items-center gap-2 text-sm bg-amber-500/10 rounded-lg px-3 py-2">
                  <span className="text-amber-600 font-medium">Overload:</span>
                  <span className="font-mono">Active</span>
                </div>
              </ErrorTooltip>
            )}
            {!device.lastKnownErrors.emsIsNormal && (
              <ErrorTooltip errorCode={0} errorType="ems">
                <div className="flex items-center gap-2 text-sm bg-amber-500/10 rounded-lg px-3 py-2">
                  <span className="text-amber-600 font-medium">EMS Status:</span>
                  <span className="font-mono">Abnormal</span>
                </div>
              </ErrorTooltip>
            )}
            {device.lastKnownErrors.bmsSlave1ErrCode !== undefined && device.lastKnownErrors.bmsSlave1ErrCode !== 0 && (
              <ErrorTooltip errorCode={device.lastKnownErrors.bmsSlave1ErrCode} errorType="battery">
                <div className="flex items-center gap-2 text-sm bg-amber-500/10 rounded-lg px-3 py-2">
                  <span className="text-amber-600 font-medium">Extra Battery 1:</span>
                  <span className="font-mono">{device.lastKnownErrors.bmsSlave1ErrCode}</span>
                </div>
              </ErrorTooltip>
            )}
            {device.lastKnownErrors.bmsSlave2ErrCode !== undefined && device.lastKnownErrors.bmsSlave2ErrCode !== 0 && (
              <ErrorTooltip errorCode={device.lastKnownErrors.bmsSlave2ErrCode} errorType="battery">
                <div className="flex items-center gap-2 text-sm bg-amber-500/10 rounded-lg px-3 py-2">
                  <span className="text-amber-600 font-medium">Extra Battery 2:</span>
                  <span className="font-mono">{device.lastKnownErrors.bmsSlave2ErrCode}</span>
                </div>
              </ErrorTooltip>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Battery Status - spans 1 column */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold flex items-center gap-2">
              <Battery className="w-5 h-5 text-primary" />
              Battery Status
            </h3>
          </div>
          <div className="p-6">
            {state ? (
              <div className="flex flex-col items-center">
                <BatteryGauge
                  soc={state.batterySoc}
                  isCharging={isCharging}
                  size="lg"
                />
                <div className="mt-4 text-center">
                  <div
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium",
                      isCharging
                        ? "bg-green-500/10 text-green-600"
                        : isDischarging
                          ? "bg-orange-500/10 text-orange-600"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
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
                    {isCharging
                      ? "Charging"
                      : isDischarging
                        ? "Discharging"
                        : "Idle"}
                  </div>
                  {/* ETA display */}
                  {isCharging &&
                    state.chgRemainTime &&
                    state.chgRemainTime > 0 && (
                      <div className="mt-2 text-sm text-muted-foreground">
                        <Clock className="w-3.5 h-3.5 inline mr-1" />
                        {state.chgRemainTime >= 60
                          ? `${Math.floor(state.chgRemainTime / 60)}h ${state.chgRemainTime % 60}min to 100%`
                          : `${state.chgRemainTime}min to 100%`}
                      </div>
                    )}
                  {isDischarging &&
                    state.dsgRemainTime &&
                    state.dsgRemainTime > 0 && (
                      <div className="mt-2 text-sm text-muted-foreground">
                        <Clock className="w-3.5 h-3.5 inline mr-1" />
                        {state.dsgRemainTime >= 60
                          ? `${Math.floor(state.dsgRemainTime / 60)}h ${state.dsgRemainTime % 60}min remaining`
                          : `${state.dsgRemainTime}min remaining`}
                      </div>
                    )}
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No data available
              </p>
            )}
          </div>
        </div>

        {/* Power Flow - spans 2 columns */}
        <div className="lg:col-span-2 rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Power Flow
            </h3>
          </div>
          <div className="p-5">
            {state ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <PowerFlowCard
                  icon={<Plug className="w-4 h-4 text-purple-500" />}
                  label="AC Input"
                  value={state.acInputWatts}
                  colorClass="bg-purple-500/20"
                  bgClass="bg-purple-500/5"
                  isActive={state.acInputWatts > 0}
                />
                <PowerFlowCard
                  icon={<Sun className="w-4 h-4 text-amber-500" />}
                  label="Solar"
                  value={state.solarInputWatts}
                  colorClass="bg-amber-500/20"
                  bgClass="bg-amber-500/5"
                  isActive={state.solarInputWatts > 0}
                />
                <PowerFlowCard
                  icon={<Zap className="w-4 h-4 text-blue-500" />}
                  label="AC Output"
                  value={state.acOutputWatts}
                  colorClass="bg-blue-500/20"
                  bgClass="bg-blue-500/5"
                  isActive={state.acOutputWatts > 0}
                />
                <PowerFlowCard
                  icon={<Battery className="w-4 h-4 text-cyan-500" />}
                  label="DC Output"
                  value={state.dcOutputWatts}
                  colorClass="bg-cyan-500/20"
                  bgClass="bg-cyan-500/5"
                  isActive={state.dcOutputWatts > 0}
                />
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No data available
              </p>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold flex items-center gap-2">
              <Power className="w-5 h-5 text-primary" />
              Controls
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {state ? (
              <>
                <ToggleSwitch
                  label="AC Output"
                  description={state.acOutEnabled ? "Enabled" : "Disabled"}
                  enabled={state.acOutEnabled}
                  isLoading={isTogglingAc}
                  disabled={!device.online}
                  onToggle={handleToggleAc}
                />
                <ToggleSwitch
                  label="DC Output"
                  description={state.dcOutEnabled ? "Enabled" : "Disabled"}
                  enabled={state.dcOutEnabled}
                  isLoading={isTogglingDc}
                  disabled={!device.online}
                  onToggle={handleToggleDc}
                />
              </>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                No data available
              </p>
            )}
          </div>
        </div>

        {/* Charge Settings - spans 2 columns */}
        <div className="lg:col-span-2 rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5 text-primary" />
              Charge Settings
            </h3>
          </div>
          <div className="p-4">
            {state ? (
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <SliderControl
                    label="AC Charging Power"
                    value={state.acChargingPower ?? 1800}
                    min={200}
                    max={2900}
                    step={100}
                    unit="W"
                    isLoading={isSettingChargePower}
                    disabled={!device.online || !!state.fastChargingEnabled}
                    onChange={handleSetChargePower}
                  />
                  {state.fastChargingEnabled && (
                    <p className="text-xs text-amber-500 mt-2 px-4">
                      Fast charging enabled - power limit not available
                    </p>
                  )}
                </div>
                <SliderControl
                  label="Max Charge Level"
                  value={state.maxChgSoc ?? 100}
                  min={50}
                  max={100}
                  step={1}
                  unit="%"
                  isLoading={isSettingMaxSoc}
                  disabled={!device.online}
                  onChange={handleSetMaxSoc}
                />
                <SliderControl
                  label="Min Discharge Level"
                  value={state.minDsgSoc ?? 0}
                  min={0}
                  max={30}
                  step={1}
                  unit="%"
                  isLoading={isSettingMinSoc}
                  disabled={!device.online}
                  onChange={handleSetMinSoc}
                />
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                No data available
              </p>
            )}
          </div>
        </div>

        {/* Device Info - spans 2 columns */}
        <div className="lg:col-span-2 rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold flex items-center gap-2">
              <Cpu className="w-5 h-5 text-primary" />
              Device Info
            </h3>
          </div>
          <div className="p-5">
            {state ? (
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Thermometer className="w-4 h-4 text-orange-500" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Temperature
                    </span>
                  </div>
                  <div className="text-2xl font-bold tabular-nums">
                    {state.temperature}
                    <span className="text-sm font-normal text-muted-foreground ml-1">
                      °C
                    </span>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-blue-500" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Last Updated
                    </span>
                  </div>
                  <div className="text-2xl font-bold tabular-nums">
                    {new Date(state.timestamp).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="w-4 h-4 text-purple-500" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Device Type
                    </span>
                  </div>
                  <div className="text-lg font-bold truncate">
                    {device.deviceType}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No data available
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Extra Batteries Section */}
      {state && (state.extraBattery1 || state.extraBattery2) && (
        <div className="space-y-4">
          <h3 className="font-semibold flex items-center gap-2 text-lg">
            <BatteryCharging className="w-5 h-5 text-primary" />
            Extra Batteries
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            {state.extraBattery1 && (
              <ExtraBatteryCard battery={state.extraBattery1} index={1} />
            )}
            {state.extraBattery2 && (
              <ExtraBatteryCard battery={state.extraBattery2} index={2} />
            )}
          </div>
        </div>
      )}

      {/* Usage Charts Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h3 className="font-semibold flex items-center gap-2 text-lg">
            <BarChart3 className="w-5 h-5 text-primary" />
            Usage Charts
          </h3>
          <div className="flex items-center gap-4">
            <PeriodSelector value={chartPeriod} onChange={setChartPeriod} />
            <Link
              to={`/device/${serialNumber}/errors`}
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium",
                "text-orange-600 hover:text-orange-500 transition-colors",
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Error History
            </Link>
            <Link
              to={`/statistics/${serialNumber}`}
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium",
                "text-primary hover:text-primary/80 transition-colors",
              )}
            >
              Detailed Statistics
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ChartContainer
            title="Battery Level"
            icon={<Battery className="w-4 h-4 text-green-500" />}
            isLoading={isChartLoading}
            error={chartError}
            onRefresh={refetchChart}
            isEmpty={chartData.length === 0}
          >
            <BatteryChart data={chartData} period={chartPeriod} height={180} />
          </ChartContainer>

          <ChartContainer
            title="Power"
            icon={<Zap className="w-4 h-4 text-blue-500" />}
            isLoading={isChartLoading}
            error={chartError}
            onRefresh={refetchChart}
            isEmpty={chartData.length === 0}
          >
            <PowerChart data={chartData} period={chartPeriod} height={180} />
          </ChartContainer>
        </div>
      </div>
    </div>
  );
}
