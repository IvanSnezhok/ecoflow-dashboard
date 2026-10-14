import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Cpu, Wifi, WifiOff } from 'lucide-react'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { parseServerTimestamp } from '@/components/charts'
import type { ConnectionSummary } from '@/types/device'

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

const NotReported = () => <span className="text-muted-foreground/60">not reported</span>

export function DeviceInfoCard({ serialNumber, online }: DeviceInfoCardProps) {
  const { data: info, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['deviceInfo', serialNumber, online],
    queryFn: async () => (await api.getDeviceInfo(serialNumber)).data,
    // Firmware and serials rarely change; RSSI and connection uptime are worth a periodic refresh
    refetchInterval: 60_000,
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
