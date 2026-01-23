import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Zap,
  Battery,
  Power,
  BarChart3,
  ExternalLink,
  Clock,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { useDeviceStore } from "@/stores/deviceStore";
import { EnergyFlowDiagram } from "@/components/devices/EnergyFlowDiagram";
import { BatteryPack } from "@/components/devices/BatteryPack";
import { TechnicalToggle } from "@/components/ui/TechnicalToggle";
import { TechnicalSlider } from "@/components/ui/TechnicalSlider";
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

// Status codes to hide (charging status, not actual errors)
const HIDDEN_STATUS_CODES = [5, 6, 23];

// Helper to check if error code is a real error (not a status)
function isRealError(code: number): boolean {
  return code !== 0 && !HIDDEN_STATUS_CODES.includes(code);
}

// Helper function to check if there are any errors
function hasErrors(errorCodes: DeviceErrorCodes | LastKnownErrors): boolean {
  const hasBaseErrors =
    isRealError(errorCodes.bmsMasterErrCode) ||
    errorCodes.invErrCode !== 0 ||
    errorCodes.mpptFaultCode !== 0 ||
    errorCodes.overloadState !== 0 ||
    !errorCodes.emsIsNormal;

  // Check extra battery errors if present (LastKnownErrors)
  if ("bmsSlave1ErrCode" in errorCodes || "bmsSlave2ErrCode" in errorCodes) {
    const lastKnown = errorCodes as LastKnownErrors;
    return (
      hasBaseErrors ||
      (lastKnown.bmsSlave1ErrCode !== undefined && isRealError(lastKnown.bmsSlave1ErrCode)) ||
      (lastKnown.bmsSlave2ErrCode !== undefined && isRealError(lastKnown.bmsSlave2ErrCode))
    );
  }

  return hasBaseErrors;
}

export default function DeviceDetail() {
  const { serialNumber } = useParams<{ serialNumber: string }>();
  const { devices, updateDeviceState, setPendingCommand, removePendingCommand } = useDeviceStore();
  const [isTogglingAc, setIsTogglingAc] = useState(false);
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
      {/* Header - Minimalist */}
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center justify-center w-8 h-8 rounded-sm border bg-card hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold tracking-tight truncate">
              {device.name || device.serialNumber}
            </h2>
            <span className={cn(
              "px-1.5 py-0.5 rounded-sm text-[10px] font-mono uppercase",
              device.online
                ? "bg-energy-green/10 text-energy-green"
                : "bg-muted text-muted-foreground"
            )}>
              {device.online ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            {device.deviceType} • {device.serialNumber}
          </p>
        </div>
        {/* Last sync time */}
        {state && (
          <div className="text-right hidden sm:block">
            <span className="text-[10px] text-muted-foreground">Last sync</span>
            <p className="text-xs font-mono">
              {new Date(state.timestamp).toLocaleTimeString("en-US", { hour12: false })}
            </p>
          </div>
        )}
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
            {isRealError(state.errorCodes.bmsMasterErrCode) && (
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
            {isRealError(device.lastKnownErrors.bmsMasterErrCode) && (
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
            {device.lastKnownErrors.bmsSlave1ErrCode !== undefined && isRealError(device.lastKnownErrors.bmsSlave1ErrCode) && (
              <ErrorTooltip errorCode={device.lastKnownErrors.bmsSlave1ErrCode} errorType="battery">
                <div className="flex items-center gap-2 text-sm bg-amber-500/10 rounded-lg px-3 py-2">
                  <span className="text-amber-600 font-medium">Extra Battery 1:</span>
                  <span className="font-mono">{device.lastKnownErrors.bmsSlave1ErrCode}</span>
                </div>
              </ErrorTooltip>
            )}
            {device.lastKnownErrors.bmsSlave2ErrCode !== undefined && isRealError(device.lastKnownErrors.bmsSlave2ErrCode) && (
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

      {/* Energy Flow Diagram - Full Width */}
      {state && (
        <EnergyFlowDiagram
          solarInput={state.solarInputWatts}
          acInput={state.acInputWatts}
          acOutput={state.acOutputWatts}
          batterySoc={state.batterySoc}
          isCharging={isCharging}
          isDischarging={isDischarging}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Battery Pack - spans 1 column */}
        {state && (
          <BatteryPack
            mainSoc={state.batterySoc}
            mainIsCharging={isCharging}
            mainTemp={state.temperature}
            extraBattery1={state.extraBattery1}
            extraBattery2={state.extraBattery2}
          />
        )}

        {/* Controls - AC Output Only */}
        <div className="rounded-sm border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Power className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider">Controls</span>
          </div>
          <div className="p-4 space-y-4">
            {state ? (
              <>
                {/* AC Output Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">AC Output</span>
                    <p className="text-[10px] text-muted-foreground">
                      {isTogglingAc ? "Switching..." : state.acOutEnabled ? "Enabled" : "Disabled"}
                    </p>
                  </div>
                  <TechnicalToggle
                    checked={state.acOutEnabled}
                    onChange={handleToggleAc}
                    disabled={!device.online || isTogglingAc}
                    size="md"
                  />
                </div>

                {/* Status Info */}
                <div className="pt-3 border-t border-border/50">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Status</span>
                      <p className={cn(
                        "font-mono font-semibold",
                        isCharging ? "text-energy-green" :
                        isDischarging ? "text-energy-blue" :
                        "text-muted-foreground"
                      )}>
                        {isCharging ? "CHARGING" : isDischarging ? "DISCHARGING" : "IDLE"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Temp</span>
                      <p className="font-mono font-semibold">{state.temperature}°C</p>
                    </div>
                  </div>
                </div>

                {/* Time remaining */}
                {(isCharging && state.chgRemainTime && state.chgRemainTime > 0) && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {state.chgRemainTime >= 60
                      ? `${Math.floor(state.chgRemainTime / 60)}h ${state.chgRemainTime % 60}m to full`
                      : `${state.chgRemainTime}m to full`}
                  </div>
                )}
                {(isDischarging && state.dsgRemainTime && state.dsgRemainTime > 0) && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {state.dsgRemainTime >= 60
                      ? `${Math.floor(state.dsgRemainTime / 60)}h ${state.dsgRemainTime % 60}m remaining`
                      : `${state.dsgRemainTime}m remaining`}
                  </div>
                )}
              </>
            ) : (
              <p className="text-center text-muted-foreground py-4 text-xs">
                No data
              </p>
            )}
          </div>
        </div>

        {/* Charge Settings - third column */}
        <div className="rounded-sm border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider">Charge Settings</span>
          </div>
          <div className="p-4">
            {state ? (
              <div className="space-y-4">
                <div>
                  <TechnicalSlider
                    label="AC Charging Power"
                    value={state.acChargingPower ?? 1800}
                    min={200}
                    max={2900}
                    step={100}
                    unit="W"
                    onChange={handleSetChargePower}
                    disabled={!device.online || !!state.fastChargingEnabled || isSettingChargePower}
                    accentColor="purple"
                  />
                  {state.fastChargingEnabled && (
                    <p className="text-[10px] text-energy-yellow mt-2">
                      Fast charging enabled
                    </p>
                  )}
                </div>
                <TechnicalSlider
                  label="Max Charge Level"
                  value={state.maxChgSoc ?? 100}
                  min={50}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={handleSetMaxSoc}
                  disabled={!device.online || isSettingMaxSoc}
                  accentColor="green"
                />
                <TechnicalSlider
                  label="Min Discharge Level"
                  value={state.minDsgSoc ?? 0}
                  min={0}
                  max={30}
                  step={1}
                  unit="%"
                  onChange={handleSetMinSoc}
                  disabled={!device.online || isSettingMinSoc}
                  accentColor="blue"
                />
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4 text-xs">
                No data
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Usage Charts Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Usage Charts
            </span>
          </div>
          <div className="flex items-center gap-3">
            <PeriodSelector value={chartPeriod} onChange={setChartPeriod} />
            <Link
              to={`/device/${serialNumber}/errors`}
              className="flex items-center gap-1 text-[10px] font-medium text-energy-yellow hover:text-energy-yellow/80 transition-colors"
            >
              <AlertTriangle className="w-3 h-3" />
              Errors
            </Link>
            <Link
              to={`/statistics/${serialNumber}`}
              className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Statistics
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ChartContainer
            title="Battery Level"
            icon={<Battery className="w-4 h-4 text-energy-green" />}
            isLoading={isChartLoading}
            error={chartError}
            onRefresh={refetchChart}
            isEmpty={chartData.length === 0}
          >
            <BatteryChart data={chartData} period={chartPeriod} height={180} />
          </ChartContainer>

          <ChartContainer
            title="Power"
            icon={<Zap className="w-4 h-4 text-energy-blue" />}
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
