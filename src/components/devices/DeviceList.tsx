import { DeviceCard } from './DeviceCard'
import { useDevices } from '@/hooks/useDevices'
import { Battery } from 'lucide-react'

export function DeviceList() {
  const { devices, isLoading, error } = useDevices()

  if (isLoading) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Battery className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Devices
          </h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-sm border border-l-4 border-l-muted bg-card p-4 animate-pulse">
              <div className="h-3 bg-muted rounded w-1/2 mb-3"></div>
              <div className="h-8 bg-muted rounded w-full mb-3"></div>
              <div className="h-3 bg-muted rounded w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-sm border border-l-4 border-l-energy-red bg-card p-4">
        <p className="text-energy-red text-sm font-medium">Error loading devices</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </div>
    )
  }

  if (devices.length === 0) {
    return (
      <div className="rounded-sm border bg-card p-6 text-center">
        <Battery className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          No devices found
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Make sure your backend server is running
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Battery className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Devices
          </h3>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {devices.length} total
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {devices.map((device) => (
          <DeviceCard key={device.serialNumber} device={device} />
        ))}
      </div>
    </div>
  )
}
