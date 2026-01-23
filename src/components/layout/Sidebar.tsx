import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, FileText, Settings, Battery, Zap, Wifi, WifiOff, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDeviceStore } from '@/stores/deviceStore'
import { useMqtt } from '@/hooks/useMqtt'

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Automation', href: '/automation', icon: Zap },
  { name: 'Logs', href: '/logs', icon: FileText },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const location = useLocation()
  const { devices, isLoading } = useDeviceStore()
  const { wsConnected, mqttConnected } = useMqtt()

  // Calculate online devices count
  const onlineDevices = devices.filter(d => d.online && d.state)

  return (
    <aside className="w-56 border-r bg-card flex flex-col min-h-[calc(100vh-4rem)]">
      {/* Navigation - Compact */}
      <nav className="p-3 space-y-0.5">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm text-sm font-medium transition-all',
                'border-l-2',
                isActive
                  ? 'bg-primary/10 text-primary border-l-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground border-l-transparent'
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* Devices Section - Compact */}
      <div className="flex-1 p-3 pt-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Devices
          </h3>
          {onlineDevices.length > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {onlineDevices.length} online
            </span>
          )}
        </div>

        <div className="space-y-0.5">
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Battery className="w-4 h-4 animate-pulse" />
              <span>Loading...</span>
            </div>
          ) : devices.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Battery className="w-4 h-4" />
              <span>No devices</span>
            </div>
          ) : (
            devices.map((device) => {
              const isActive = location.pathname === `/device/${device.serialNumber}`
              const soc = device.state?.batterySoc || 0
              const isCharging = device.state ? device.state.batteryWatts > 0 : false

              return (
                <Link
                  key={device.serialNumber}
                  to={`/device/${device.serialNumber}`}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-all',
                    'border-l-2',
                    isActive
                      ? 'bg-accent/50 border-l-accent'
                      : 'hover:bg-muted border-l-transparent',
                    !device.online && 'opacity-50'
                  )}
                >
                  {/* Status indicator */}
                  <div
                    className={cn(
                      'w-1.5 h-1.5 rounded-full flex-shrink-0',
                      device.online
                        ? isCharging
                          ? 'bg-energy-green animate-pulse'
                          : 'bg-energy-green'
                        : 'bg-muted-foreground'
                    )}
                  />

                  {/* Device name */}
                  <span className="flex-1 truncate font-medium text-foreground">
                    {device.name?.replace('EcoFlow ', '').replace('DELTA ', 'D ') || device.serialNumber}
                  </span>

                  {/* Battery percentage inline */}
                  {device.state && (
                    <span className={cn(
                      'font-mono font-semibold tabular-nums',
                      soc <= 20 ? 'text-energy-red' :
                      soc <= 40 ? 'text-energy-yellow' : 'text-energy-green'
                    )}>
                      {soc}%
                    </span>
                  )}
                </Link>
              )
            })
          )}
        </div>
      </div>

      {/* System Status Block - Bottom */}
      <div className="p-3 border-t bg-muted/30">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          System
        </h3>
        <div className="space-y-1.5">
          {/* WebSocket Status */}
          <div className="flex items-center gap-2 text-xs">
            {wsConnected ? (
              <Wifi className="w-3.5 h-3.5 text-energy-green" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-energy-red" />
            )}
            <span className={cn(
              'font-medium',
              wsConnected ? 'text-energy-green' : 'text-energy-red'
            )}>
              WS
            </span>
            <span className="text-muted-foreground">
              {wsConnected ? 'Connected' : 'Offline'}
            </span>
          </div>

          {/* MQTT Status */}
          <div className="flex items-center gap-2 text-xs">
            <Radio className={cn(
              'w-3.5 h-3.5',
              mqttConnected ? 'text-energy-green' : 'text-energy-yellow animate-pulse'
            )} />
            <span className={cn(
              'font-medium',
              mqttConnected ? 'text-energy-green' : 'text-energy-yellow'
            )}>
              MQTT
            </span>
            <span className="text-muted-foreground">
              {mqttConnected ? 'Live' : 'Connecting...'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
