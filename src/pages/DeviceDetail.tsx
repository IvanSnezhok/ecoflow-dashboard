import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Battery,
  Power,
  BarChart3,
  ExternalLink,
  AlertTriangle,
  Cpu,
  Stethoscope,
} from "lucide-react";
import { useDeviceStore } from "@/stores/deviceStore";
import { EnergyFlowDiagram } from "@/components/devices/EnergyFlowDiagram";
import { BatteryPack, packCapacityWh } from "@/components/devices/BatteryPack";
import { TechnicalToggle } from "@/components/ui/TechnicalToggle";
import { TechnicalSlider } from "@/components/ui/TechnicalSlider";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import {
  BatteryChartPanel,
  PowerChartPanel,
  PeriodSelector,
  useChartData,
  parseServerTimestamp,
} from "@/components/charts";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { dataSourceChip, powerStatus, remainingTime } from "@/lib/deviceStatus";
import { DeviceIssues } from "@/components/devices/DeviceIssues";
import { DeviceInfoCard } from "@/components/devices/DeviceInfoCard";
import { DataAccessCheck } from "@/components/devices/DataAccessCheck";
import { collectDeviceIssues } from "@/utils/errorCodes";
import type { ChartPeriod, DeviceState } from "@/types/device";
import { usePanelAccess } from "@/hooks/usePanelAccess";

type CommandField = "acOutEnabled" | "maxChgSoc" | "minDsgSoc" | "acChargingPower";

export default function DeviceDetail() {
  const { serialNumber } = useParams<{ serialNumber: string }>();
  // Only this device: updates of other devices do not re-render the page
  const device = useDeviceStore((s) => s.devices.find((d) => d.serialNumber === serialNumber));
  const [busy, setBusy] = useState<Partial<Record<CommandField, boolean>>>({});
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("24h");
  // A viewer sees the controls but cannot use them (the server refuses the commands too)
  const { canControl } = usePanelAccess();

  const {
    data: chartData,
    isLoading: isChartLoading,
    isFetching: isChartFetching,
    error: chartError,
    refetch: refetchChart,
  } = useChartData(serialNumber || "", chartPeriod);

  /**
   * Shows the new value at once and holds it against older server values until the
   * device confirms it; on failure the previous value comes back.
   */
  const runCommand = async <F extends CommandField>(
    field: F,
    value: DeviceState[F],
    send: (sn: string) => Promise<unknown>,
    what: string,
  ) => {
    if (!device?.state || busy[field]) return;
    const sn = device.serialNumber;
    const previous = device.state[field];
    const { setPendingCommand, updateDeviceState, removePendingCommand } = useDeviceStore.getState();

    setBusy((b) => ({ ...b, [field]: true }));
    setPendingCommand(sn, field, value);
    updateDeviceState(sn, { [field]: value });
    try {
      await send(sn);
    } catch (error) {
      console.error(`Failed to set ${what}:`, error);
      removePendingCommand(sn, field);
      updateDeviceState(sn, { [field]: previous });
      alert(`Failed to set ${what}: ` + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setBusy((b) => ({ ...b, [field]: false }));
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
  const status = state ? powerStatus(state) : "standby";
  const source = dataSourceChip(device);
  const offline = !device.online;
  // A read-only device (e.g. a DELTA Max read from MQTT) shows only the settings it
  // reports, not a slider's default value
  const showAcToggle = device.capabilities?.acOutput !== false;
  const showChargePower = state?.acChargingPower !== undefined || device.capabilities?.chargingPower !== undefined || !device.capabilities;
  const showChargeLimits = state?.maxChgSoc !== undefined || device.capabilities?.chargeLimits !== false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/"
          aria-label="Back to Dashboard"
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
            {/* Data that does not come from the cloud REST quota: Bluetooth, MQTT push, app channel */}
            {source && (
              <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono uppercase bg-primary/10 text-primary" title={source.title}>
                {source.label}
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">
            {device.deviceType} • {device.serialNumber}
          </p>
        </div>
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
      {offline && device.lastKnownErrors && (
        <DeviceIssues
          title="Last known issues"
          subtitle={`recorded ${new Date(parseServerTimestamp(device.lastKnownErrors.timestamp)).toLocaleString()}`}
          issues={collectDeviceIssues(device.lastKnownErrors).filter((issue) => issue.info.severity !== "info")}
        />
      )}

      {state && (
        <EnergyFlowDiagram
          solarInput={state.solarInputWatts}
          acInput={state.acInputWatts}
          acOutput={state.acOutputWatts}
          batterySoc={state.batterySoc}
          status={status}
          remaining={remainingTime(state, status)}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {state && (
          <BatteryPack
            mainSoc={state.batterySoc}
            mainIsCharging={status === "charging"}
            mainTemp={state.temperature}
            mainErrCode={state.errorCodes?.bmsMasterErrCode}
            extraBattery1={state.extraBattery1}
            extraBattery2={state.extraBattery2}
            mainCapacityWh={packCapacityWh(device.deviceType)}
            extraBatteryCapacityWh={packCapacityWh(device.deviceType)}
          />
        )}

        {/* AC output and charge settings */}
        <div className="rounded-sm border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Power className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider">Controls</span>
            {!canControl && (
              <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">View only</span>
            )}
          </div>
          <div className="p-4 space-y-4">
            {!state ? (
              <p className="text-center text-muted-foreground py-4 text-xs">No data</p>
            ) : !showAcToggle && !showChargePower && !showChargeLimits ? (
              <p className="text-center text-muted-foreground py-4 text-xs">Not reported by this device</p>
            ) : (
              <>
                {showAcToggle && (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">AC Output</span>
                      <p className="text-[10px] text-muted-foreground">
                        {busy.acOutEnabled ? "Switching..." : state.acOutEnabled ? "Enabled" : "Disabled"}
                      </p>
                    </div>
                    <TechnicalToggle
                      checked={state.acOutEnabled}
                      onChange={() => runCommand("acOutEnabled", !state.acOutEnabled, (sn) => api.setAcOutput(sn, !state.acOutEnabled), "AC output")}
                      disabled={!canControl || offline || !!busy.acOutEnabled}
                      size="md"
                    />
                  </div>
                )}
                {showAcToggle && (showChargePower || showChargeLimits) && <div className="border-t border-border/50" />}
                {showChargePower && (
                  <div>
                    <TechnicalSlider
                      label="AC Charging Power"
                      value={state.acChargingPower ?? 1800}
                      min={200}
                      max={2900}
                      step={100}
                      unit="W"
                      onChange={(watts) => runCommand("acChargingPower", watts, (sn) => api.setChargingPower(sn, watts), "charging power")}
                      disabled={!canControl || offline || (device.capabilities !== undefined && device.capabilities.chargingPower === undefined) || !!state.fastChargingEnabled || !!busy.acChargingPower}
                      accentColor="purple"
                    />
                    {state.fastChargingEnabled && (
                      <p className="text-[10px] text-energy-yellow mt-2">
                        Fast charging enabled
                      </p>
                    )}
                  </div>
                )}
                {showChargeLimits && (
                  <>
                    <TechnicalSlider
                      label="Max Charge Level"
                      value={state.maxChgSoc ?? 100}
                      min={50}
                      max={100}
                      step={1}
                      unit="%"
                      onChange={(soc) => runCommand("maxChgSoc", soc, (sn) => api.setMaxChargeSoc(sn, soc), "max charge level")}
                      disabled={!canControl || offline || device.capabilities?.chargeLimits === false || !!busy.maxChgSoc}
                      accentColor="green"
                    />
                    <TechnicalSlider
                      label="Min Discharge Level"
                      value={state.minDsgSoc ?? 0}
                      min={0}
                      max={30}
                      step={1}
                      unit="%"
                      onChange={(soc) => runCommand("minDsgSoc", soc, (sn) => api.setMinDischargeSoc(sn, soc), "min discharge level")}
                      disabled={!canControl || offline || device.capabilities?.chargeLimits === false || !!busy.minDsgSoc}
                      accentColor="blue"
                    />
                  </>
                )}
              </>
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

      {/* Technical details, closed until asked for */}
      <CollapsibleCard
        id="device-info"
        icon={<Cpu className="w-4 h-4 text-primary" />}
        title="Device info"
        hint="Wi-Fi, connection uptime, Bluetooth, firmware"
      >
        <DeviceInfoCard serialNumber={device.serialNumber} online={device.online} />
      </CollapsibleCard>

      {/* Which EcoFlow channels serve this device's data, e.g. for a shared device */}
      {canControl && (
        <CollapsibleCard
          id="data-access"
          icon={<Stethoscope className="w-4 h-4 text-primary" />}
          title="Data access check"
          hint="Which EcoFlow channels serve this device"
          keepMounted
        >
          <DataAccessCheck key={device.serialNumber} serialNumber={device.serialNumber} />
        </CollapsibleCard>
      )}
    </div>
  );
}
