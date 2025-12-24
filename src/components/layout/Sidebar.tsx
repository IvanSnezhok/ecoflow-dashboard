import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, FileText, Settings, Battery, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDeviceStore } from '@/stores/deviceStore'

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Logs', href: '/logs', icon: FileText },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const location = useLocation()
  const { devices, isLoading } = useDeviceStore()

  return (
    <aside className="w-64 border-r bg-card min-h-[calc(100vh-4rem)]">
      <nav className="p-4 space-y-2">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t mt-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Devices
        </h3>
        <div className="space-y-1">
          {isLoading ? (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground">
              <Battery className="w-5 h-5 animate-pulse" />
              <span>Loading...</span>
            </div>
          ) : devices.length === 0 ? (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground">
              <Battery className="w-5 h-5" />
              <span>No devices</span>
            </div>
          ) : (
            devices.map((device) => {
              const isActive = location.pathname === `/device/${device.serialNumber}`
              return (
                <Link
                  key={device.serialNumber}
                  to={`/device/${device.serialNumber}`}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Battery className="w-5 h-5" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">
                      {device.name || device.serialNumber}
                    </div>
                    {device.state && (
                      <div className="text-xs opacity-70">
                        {device.state.batterySoc}%
                      </div>
                    )}
                  </div>
                  <Circle
                    className={cn(
                      'w-2 h-2 flex-shrink-0',
                      device.online
                        ? 'fill-green-500 text-green-500'
                        : 'fill-gray-400 text-gray-400'
                    )}
                  />
                </Link>
              )
            })
          )}
        </div>
      </div>
    </aside>
  )
}
