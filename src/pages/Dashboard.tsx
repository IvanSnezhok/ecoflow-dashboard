import { DeviceList } from '@/components/devices/DeviceList'
import { SummaryBar } from '@/components/dashboard/SummaryBar'

export default function Dashboard() {
  return (
    <div className="space-y-4">
      {/* Page Header - Minimal */}
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            System overview and device status
          </p>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Live
        </span>
      </div>

      {/* Summary Bar - Aggregated Metrics */}
      <SummaryBar />

      {/* Device List */}
      <DeviceList />
    </div>
  )
}
