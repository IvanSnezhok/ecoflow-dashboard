import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
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
import { BatteryPack, packCapacityWh } from "@/components/devices/BatteryPack";
import { TechnicalToggle } from "@/components/ui/TechnicalToggle";
import { TechnicalSlider } from "@/components/ui/TechnicalSlider";
import {
  BatteryChartPanel,
  PowerChartPanel,
  PeriodSelector,
  useChartData,
  parseServerTimestamp,
} from "@/components/charts";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { DeviceIssues } from "@/components/devices/DeviceIssues";
import { DeviceInfoCard } from "@/components/devices/DeviceInfoCard";
import { DataAccessCheck } from "@/components/devices/DataAccessCheck";
import { collectDeviceIssues } from "@/utils/errorCodes";
import type { ChartPeriod } from "@/types/device";
import { usePanelAccess } from "@/hooks/usePanelAccess";

function ViewOnly() {
  return (
    <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">View only</span>
  );
}

export default function DeviceDetail() {
  const { serialNumber } = useParams<{ serialNumber: string }>();
  const { devices, updateDeviceState, setPendingCommand, removePendingCommand } = useDeviceStore();
  const [isTogglingAc, setIsTogglingAc] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("24h");
  // A viewer sees the controls but cannot use them (the server refuses the commands too)
  const { canControl } = usePanelAccess();

  // Charge settings states
  const [isSettingMaxSoc, setIsSettingMaxSoc] = useState(false);
  const [isSettingMinSoc, setIsSettingMinSoc] = useState(false);
  const [isSettingChargePower, setIsSettingChargePower] = useState(false);

  const device = devices.find((d) => d.serialNumber === serialNumber);
  const {
    data: chartData,
    isLoading: isChartLoading,
    isFetching: isChartFetching,
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
  // AC input feeds the AC output while the battery rests; a few watts either way are
  // conversion losses in the station's in/out sums, not charging
  const isBypass = !!state && state.acInputWatts > 0 && state.acOutputWatts > 0 && Math.abs(state.batteryWatts) <= 30;
  const isCharging = state && !isBypass ? state.batteryWatts > 0 : false;
  const isDischarging = state && !isBypass ? state.batteryWatts < 0 : false;
  // A read-only device (e.g. a DELTA Max read from MQTT) shows only the settings it
  // reports, not a slider's default value
  const showChargePower = state?.acChargingPower !== undefined || device.capabilities?.chargingPower !== undefined || !device.capabilities;
  const showChargeLimits = state?.maxChgSoc !== undefined || device.capabilities?.chargeLimits !== false;

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
            {/* Shown when the data arrives over Bluetooth, e.g. while Wi-Fi is down */}
            {device.online && (device.dataSource === "ble" || device.dataSource === "cloud+ble") && (
              <span
                className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono uppercase bg-primary/10 text-primary"
                title={device.cloudOnline ? "Live data over Bluetooth; cloud connected too" : "Cloud unreachable; live data over Bluetooth"}
              >
                {device.cloudOnline ? "BLE" : "BLE ONLY"}
              </span>
            )}
            {/* The cloud refuses this device's REST quota (e.g. a shared device): read from its
                MQTT push, or in full through the EcoFlow app channel */}
            {device.online && (device.dataSource === "mqtt" || device.dataSource === "app") && (
              <span
                className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono uppercase bg-primary/10 text-primary"
                title={device.dataSource === "app"
                  ? "EcoFlow refuses this device's REST quota; live data through the EcoFlow app channel (Settings)"
                  : "EcoFlow refuses this device's REST quota; live data from its MQTT push"}
              >
                {device.dataSource === "app" ? "APP" : "MQTT"}
              </span>
            )}
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

      {/* Current issues (live) or last known ones (offline). Status codes such as
          "fully charged" are shown as chips, not as errors. */}
      {state?.errorCodes && (
        <DeviceIssues
          issues={[
            // Battery and DC status flags are shown in the Battery Pack instead
            ...collectDeviceIssues(state.errorCodes).filter(
              (issue) => issue.info.severity !== "info" || (issue.type !== "bms" && issue.type !== "mppt"),
            ),
            // Extra-battery status (e.g. fully charged) is shown in the Battery Pack;
            // only real problems belong in the banner
            ...collectDeviceIssues({
              ...state.errorCodes,
              bmsMasterErrCode: 0, invErrCode: 0, mpptFaultCode: 0, overloadState: 0,
              emsIsNormal: true, bmsFault: 0, bmsWarningState: 0,
              bmsSlave1ErrCode: state.extraBattery1?.errCode,
              bmsSlave2ErrCode: state.extraBattery2?.errCode,
              timestamp: state.timestamp,
            }).filter((issue) => issue.info.severity !== "info"),
          ]}
        />
      )}
      {!device.online && device.lastKnownErrors && (
        <DeviceIssues
          title="Last known issues"
          subtitle={`recorded ${new Date(parseServerTimestamp(device.lastKnownErrors.timestamp)).toLocaleString()}`}
          issues={collectDeviceIssues(device.lastKnownErrors).filter((issue) => issue.info.severity !== "info")}
        />
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
          isBypass={isBypass}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Battery Pack - spans 1 column */}
        {state && (
          <BatteryPack
            mainSoc={state.batterySoc}
            mainIsCharging={isCharging}
            mainTemp={state.temperature}
            mainErrCode={state.errorCodes?.bmsMasterErrCode}
            extraBattery1={state.extraBattery1}
            extraBattery2={state.extraBattery2}
            mainCapacityWh={packCapacityWh(device.deviceType)}
            extraBatteryCapacityWh={packCapacityWh(device.deviceType)}
          />
        )}

        {/* Controls - AC Output Only */}
        <div className="rounded-sm border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Power className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider">Controls</span>
            {!canControl && <ViewOnly />}
          </div>
          <div className="p-4 space-y-4">
            {state ? (
              <>
                {/* AC Output Toggle */}
                {device.capabilities?.acOutput !== false && <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">AC Output</span>
                    <p className="text-[10px] text-muted-foreground">
                      {isTogglingAc ? "Switching..." : state.acOutEnabled ? "Enabled" : "Disabled"}
                    </p>
                  </div>
                  <TechnicalToggle
                    checked={state.acOutEnabled}
                    onChange={handleToggleAc}
                    disabled={!canControl || !device.online || isTogglingAc}
                    size="md"
                  />
                </div>}

                {/* Status Info */}
                <div className="pt-3 border-t border-border/50">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Status</span>
                      <p className={cn(
                        "font-mono font-semibold",
                        isBypass ? "text-energy-purple" :
                        isCharging ? "text-energy-green" :
                        isDischarging ? "text-energy-blue" :
                        "text-muted-foreground"
                      )}>
                        {isBypass ? "BYPASS" : isCharging ? "CHARGING" : isDischarging ? "DISCHARGING" : "IDLE"}
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
            {!canControl && <ViewOnly />}
          </div>
          <div className="p-4">
            {state && (showChargePower || showChargeLimits) ? (
              <div className="space-y-4">
                {showChargePower && <div>
                  <TechnicalSlider
                    label="AC Charging Power"
                    value={state.acChargingPower ?? 1800}
                    min={200}
                    max={2900}
                    step={100}
                    unit="W"
                    onChange={handleSetChargePower}
                    disabled={!canControl || !device.online || (device.capabilities !== undefined && device.capabilities.chargingPower === undefined) || !!state.fastChargingEnabled || isSettingChargePower}
                    accentColor="purple"
                  />
                  {state.fastChargingEnabled && (
                    <p className="text-[10px] text-energy-yellow mt-2">
                      Fast charging enabled
                    </p>
                  )}
                </div>}
                {showChargeLimits && <>
                <TechnicalSlider
                  label="Max Charge Level"
                  value={state.maxChgSoc ?? 100}
                  min={50}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={handleSetMaxSoc}
                  disabled={!canControl || !device.online || device.capabilities?.chargeLimits === false || isSettingMaxSoc}
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
                  disabled={!canControl || !device.online || device.capabilities?.chargeLimits === false || isSettingMinSoc}
                  accentColor="blue"
                />
                </>}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4 text-xs">
                {state ? "Not reported by this device" : "No data"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Usage Charts Section */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 mr-auto">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Usage Charts
            </span>
          </div>
          <div className="flex items-center gap-3 sm:order-last">
            <Link
              to={`/device/${serialNumber}/errors`}
              className="flex items-center gap-1 py-1 text-[11px] sm:text-[10px] font-medium text-energy-yellow hover:text-energy-yellow/80 transition-colors"
            >
              <AlertTriangle className="w-3 h-3" />
              Errors
            </Link>
            <Link
              to={`/statistics/${serialNumber}`}
              className="flex items-center gap-1 py-1 text-[11px] sm:text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Statistics
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          <PeriodSelector value={chartPeriod} onChange={setChartPeriod} className="w-full sm:w-auto" />
        </div>

        {/* Charging and consumption get separate charts: one shared chart with four
            similar lines was hard to read */}
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BatteryChartPanel
            data={chartData}
            period={chartPeriod}
            isLoading={isChartLoading}
            isFetching={isChartFetching}
            error={chartError}
            onRefresh={refetchChart}
            height={180}
            className="md:col-span-2 xl:col-span-1"
          />
          <PowerChartPanel
            mode="input"
            data={chartData}
            period={chartPeriod}
            isLoading={isChartLoading}
            isFetching={isChartFetching}
            error={chartError}
            onRefresh={refetchChart}
            height={180}
          />
          <PowerChartPanel
            mode="output"
            data={chartData}
            period={chartPeriod}
            isLoading={isChartLoading}
            isFetching={isChartFetching}
            error={chartError}
            onRefresh={refetchChart}
            height={180}
          />
        </div>
      </div>

      {/* Serial numbers, firmware and Wi-Fi details */}
      <DeviceInfoCard serialNumber={device.serialNumber} online={device.online} />

      {/* Which EcoFlow channels serve this device's data, e.g. for a shared device */}
      {canControl && <DataAccessCheck key={device.serialNumber} serialNumber={device.serialNumber} />}
    </div>
  );
}
