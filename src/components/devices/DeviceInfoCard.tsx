import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bluetooth, Cpu, Wifi, WifiOff } from 'lucide-react'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { parseServerTimestamp } from '@/components/charts'
import type { BleStatus, ConnectionSummary, DataSource } from '@/types/device'

interface DeviceInfoCardProps {
  serialNumber: string
  online: boolean
}

// Common RSSI bands for 2.4 GHz Wi-Fi
function signalQuality(rssi: number): { label: string; bars: number; color: string } {
  if (rssi >= -50) return { label: 'Excellent', bars: 4, color: 'text-energy-green' }
  if (rssi >= -60) return { label: 'Good', bars: 3, color: 'text-energy-green' }
  if (rssi >= -70) return { label: 'Fair', bars: 2, color: 'text-energy-yellow' }
  return { label: 'Weak', bars: 1, color: 'text-energy-red' }
}

function SignalBars({ bars, className }: { bars: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-end gap-0.5 h-3', className)} aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn('w-1 rounded-[1px]', i <= bars ? 'bg-current' : 'bg-muted-foreground/25')}
          style={{ height: `${i * 25}%` }}
        />
      ))}
    </span>
  )
}

function Row({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn('text-right break-all', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

const formatMoment = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function ConnectionRows({ connection, now }: { connection: ConnectionSummary; now: number }) {
  if (connection.online === null || !connection.since) {
    return <Row label="Connection uptime" value={<span className="text-muted-foreground/60">tracking starts now</span>} />
  }

  const streakMs = now - new Date(connection.since).getTime()
  const outage = connection.lastOutage
  return (
    <>
      <Row
        label={connection.online ? 'Connected for' : 'Offline for'}
        value={
          <span className="inline-flex flex-col items-end">
            <span className={connection.online ? 'text-energy-green' : 'text-energy-red'}>
              {connection.sinceExact ? '' : '≥ '}
              {formatDuration(streakMs)}
            </span>
            <span className="text-[10px] text-muted-foreground">since {formatMoment(connection.since)}</span>
          </span>
        }
      />
      <Row
        label="Last outage"
        value={
          outage ? (
            <span className="inline-flex flex-col items-end">
              <span>
                {outage.exact ? '' : '≥ '}
                {formatDuration(outage.durationMs)}
                {outage.end === null && ' (ongoing)'}
              </span>
              <span className="text-[10px] text-muted-foreground">{formatMoment(outage.start)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/60">none</span>
          )
        }
      />
      <Row label="Disconnects" value={`${connection.disconnects24h} / 24h · ${connection.disconnects7d} / 7d`} />
    </>
  )
}

// BLE advertisement RSSI is lower than Wi-Fi for the same link quality
function bleQuality(rssi: number): { label: string; bars: number; color: string } {
  if (rssi >= -65) return { label: 'Excellent', bars: 4, color: 'text-energy-green' }
  if (rssi >= -75) return { label: 'Good', bars: 3, color: 'text-energy-green' }
  if (rssi >= -85) return { label: 'Fair', bars: 2, color: 'text-energy-yellow' }
  return { label: 'Weak', bars: 1, color: 'text-energy-red' }
}

const BLE_STATES: Record<string, string> = {
  searching: 'Searching',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  paused: 'Paused',
  waiting_for_user_id: 'Needs EcoFlow user ID',
  unsupported: 'Model not supported',
}

const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  cloud: 'Cloud',
  ble: 'Bluetooth',
  'cloud+ble': 'Bluetooth + cloud',
}

function BleSection({ ble, dataSource, now, serialNumber, onChange }: {
  ble: BleStatus
  dataSource: DataSource | null
  now: number
  serialNumber: string
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const device = ble.device

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await run()
      onChange()
    } catch (err) {
      alert('Bluetooth: ' + (err instanceof Error ? err.message : 'request failed'))
    } finally {
      setBusy(false)
    }
  }

  let status: ReactNode
  if (!ble.reachable) status = <span className="text-energy-red">Bridge offline</span>
  else if (ble.scannerError) status = <span className="text-energy-red">Adapter error</span>
  else if (!device) status = <span className="text-muted-foreground">Not in range</span>
  else if (device.live) status = <span className="text-energy-green">Connected</span>
  else if (device.state === 'paused' && device.pausedUntil)
    status = <span className="text-energy-yellow">Paused until {formatMoment(new Date(device.pausedUntil).toISOString())}</span>
  else if (device.state === 'waiting_for_user_id')
    status = <Link to="/settings" className="text-energy-yellow underline">Sign in to EcoFlow in Settings</Link>
  else status = <span className="text-energy-yellow">{BLE_STATES[device.state] ?? device.state.replace(/_/g, ' ')}</span>

  const quality = device?.rssi != null ? bleQuality(device.rssi) : null
  const problem = !ble.reachable ? ble.error : ble.scannerError ?? (device && !device.live ? device.error : null)

  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
        <Bluetooth className="w-3 h-3" /> Bluetooth
      </h3>
      <div className="divide-y divide-border/50">
        <Row label="Status" value={status} />
        {dataSource && <Row label="Data via" value={DATA_SOURCE_LABELS[dataSource]} mono={false} />}
        {quality && device?.rssi != null && (
          <Row
            label="Signal"
            value={
              <span className={cn('inline-flex items-center gap-1.5', quality.color)}>
                <SignalBars bars={quality.bars} />
                {device.rssi} dBm · {quality.label}
              </span>
            }
          />
        )}
        {device?.live && device.authenticatedSince && (
          <Row label="Connected for" value={formatDuration(now - device.authenticatedSince)} />
        )}
        {device?.lastPacketAt && !device.live && (
          <Row label="Last data" value={formatMoment(new Date(device.lastPacketAt).toISOString())} />
        )}
        {problem && <Row label="Error" value={<span className="text-energy-red">{problem}</span>} mono={false} />}
      </div>
      {device && ble.reachable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {device.state === 'paused' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.resumeBle(serialNumber))}
              className="px-2 py-1 rounded-sm border text-[11px] font-medium hover:bg-muted disabled:opacity-50"
            >
              Reconnect now
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.pauseBle(serialNumber, 15))}
              className="px-2 py-1 rounded-sm border text-[11px] font-medium hover:bg-muted disabled:opacity-50"
            >
              Free for EcoFlow app · 15 min
            </button>
          )}
          <span className="text-[10px] text-muted-foreground/70">
            {ble.mode === 'prefer' ? 'Bluetooth first, cloud as backup' : 'Cloud first, Bluetooth as backup'}
          </span>
        </div>
      )}
    </section>
  )
}

const NotReported = () => <span className="text-muted-foreground/60">not reported</span>

export function DeviceInfoCard({ serialNumber, online }: DeviceInfoCardProps) {
  const { data: info, isLoading, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['deviceInfo', serialNumber, online],
    queryFn: async () => (await api.getDeviceInfo(serialNumber)).data,
    // Firmware and serials rarely change; signal, uptime and the Bluetooth session are
    // worth a periodic refresh
    refetchInterval: (query) => (query.state.data?.ble.enabled ? 15_000 : 60_000),
    staleTime: 30_000,
  })

  const quality = info?.wifi.rssi != null ? signalQuality(info.wifi.rssi) : null

  return (
    <div className="rounded-sm border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider">Device Info</span>
        {info?.recordedAt && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            as of {new Date(parseServerTimestamp(info.recordedAt)).toLocaleString()}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground py-6 text-xs">Loading…</p>
      ) : error || !info ? (
        <p className="text-center text-muted-foreground py-6 text-xs">Device info unavailable</p>
      ) : (
        <div className="grid gap-x-8 gap-y-4 p-4 md:grid-cols-3">
          <div className="space-y-4">
            <section>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                General
              </h3>
              <div className="divide-y divide-border/50">
                <Row label="Serial number" value={info.serialNumber} />
                <Row label="Product" value={info.productName} mono={false} />
                {info.model != null && <Row label="Model code" value={info.model} />}
                {info.batteryPacks
                  .filter((pack) => pack.serialNumber)
                  .map((pack) => (
                    <Row key={pack.label} label={`${pack.label} S/N`} value={pack.serialNumber} />
                  ))}
              </div>
            </section>
            {info.ble.enabled && (
              <BleSection
                ble={info.ble}
                dataSource={info.dataSource}
                now={dataUpdatedAt}
                serialNumber={serialNumber}
                onChange={() => void refetch()}
              />
            )}
          </div>

          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Wi-Fi
            </h3>
            <div className="divide-y divide-border/50">
              <Row
                label="Signal"
                value={
                  quality && info.wifi.rssi != null ? (
                    <span className={cn('inline-flex items-center gap-1.5', quality.color)}>
                      <SignalBars bars={quality.bars} />
                      {info.wifi.rssi} dBm · {quality.label}
                    </span>
                  ) : online ? (
                    <NotReported />
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <WifiOff className="w-3 h-3" /> offline
                    </span>
                  )
                }
              />
              <ConnectionRows connection={info.connection} now={dataUpdatedAt} />
              <Row label="Network (SSID)" value={info.wifi.ssid ?? <NotReported />} />
              <Row label="MAC address" value={info.wifi.macAddress ?? <NotReported />} />
              {info.wifi.firmware && <Row label="Wi-Fi module firmware" value={info.wifi.firmware} />}
            </div>
            {info.connection.online !== null && (
              <p className="mt-2 text-[10px] leading-snug text-muted-foreground/70">
                Uptime is the device's link to the EcoFlow cloud, checked every 10 s, so router or internet
                outages count too.
                {info.connection.unobservedMs > 0 &&
                  ` The dashboard was not running for ${formatDuration(info.connection.unobservedMs)} of this period.`}
                {info.connection.trackingSince &&
                  ` Tracked since ${formatMoment(info.connection.trackingSince)}.`}
              </p>
            )}
            {(!info.wifi.ssid || !info.wifi.macAddress) && (
              <p className="mt-2 flex gap-1 text-[10px] leading-snug text-muted-foreground/70">
                <Wifi className="w-3 h-3 shrink-0 mt-px" />
                The EcoFlow Open API does not expose SSID or MAC for this device; check the EcoFlow app or
                your router's client list.
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Firmware
            </h3>
            <div className="divide-y divide-border/50">
              {info.firmware.length === 0 && info.batteryPacks.every((pack) => !pack.firmware) ? (
                <Row label="Versions" value={<NotReported />} />
              ) : (
                <>
                  {info.firmware.map((fw) => (
                    <Row key={fw.module} label={fw.module} value={fw.version} />
                  ))}
                  {info.batteryPacks
                    .filter((pack) => pack.firmware && pack.label !== 'Main battery')
                    .map((pack) => (
                      <Row key={pack.label} label={`${pack.label} BMS`} value={pack.firmware} />
                    ))}
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
