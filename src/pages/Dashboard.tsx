import { DeviceList } from '@/components/devices/DeviceList'
import { SummaryBar } from '@/components/dashboard/SummaryBar'

export default function Dashboard() {
  return (
    <div className="space-y-4">
      <SummaryBar />
      <DeviceList />
    </div>
  )
}
