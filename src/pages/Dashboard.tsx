import { DeviceList } from '@/components/devices/DeviceList'

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Monitor and control your Ecoflow devices
        </p>
      </div>

      <DeviceList />
    </div>
  )
}
