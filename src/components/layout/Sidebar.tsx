import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, FileText, Settings, Battery, Zap, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDeviceStore } from '@/stores/deviceStore'
import { useMqtt } from '@/hooks/useMqtt'
import { usePanelAccess } from '@/hooks/usePanelAccess'
import { powerStatus, socTextColor } from '@/lib/deviceStatus'

type Access = ReturnType<typeof usePanelAccess>

// Pages an invited user cannot open are left out (the server refuses them anyway)
const navigation: Array<{ name: string; href: string; icon: typeof Zap; show?: (access: Access) => boolean }> = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Automation', href: '/automation', icon: Zap, show: (access) => access.isOwner },
  { name: 'Power reserve', href: '/resilience', icon: ShieldCheck, show: (access) => access.powerReserve },
  { name: 'Logs', href: '/logs', icon: FileText, show: (access) => access.isOwner },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar({ className }: { className?: string }) {
  const location = useLocation()
  const devices = useDeviceStore((s) => s.devices)
  const isLoading = useDeviceStore((s) => s.isLoading)
  const { wsConnected, mqttConnected, lost } = useMqtt()
  const access = usePanelAccess()

  const onlineCount = devices.filter(d => d.online && d.state).length
  // One line for both links: the panel's socket to its server, the server's to EcoFlow MQTT
  const live = !wsConnected
    ? lost
      ? { label: 'Server connection lost', hint: 'Reconnecting; values may be stale', dot: 'bg-energy-red' }
      : { label: 'Connecting…', hint: 'Opening the live-update connection', dot: 'bg-muted-foreground animate-pulse' }
    : !mqttConnected
      ? { label: 'EcoFlow MQTT reconnecting', hint: 'Values refresh every 10 s meanwhile', dot: 'bg-energy-yellow animate-pulse' }
      : { label: 'Live updates', hint: 'Connected to the server and EcoFlow MQTT', dot: 'bg-energy-green' }

  return (
    <aside className={cn('w-56 shrink-0 border-r bg-card flex-col overflow-y-auto', className)}>
      {/* Navigation - Compact */}
      <nav className="p-3 space-y-0.5">
        {navigation.filter((item) => !item.show || item.show(access)).map((item) => {
          const isActive = location.pathname === item.href
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2.5 md:py-1.5 rounded-sm text-sm font-medium transition-all',
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
          {onlineCount > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {onlineCount} online
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
              const isCharging = device.state ? powerStatus(device.state) === 'charging' : false

              return (
                <Link
                  key={device.serialNumber}
                  to={`/device/${device.serialNumber}`}
                  className={cn(
                    'flex items-center gap-2 px-2 py-2.5 md:py-1.5 rounded-sm text-xs transition-all',
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
                    <span className={cn('font-mono font-semibold tabular-nums', socTextColor(soc))}>
                      {soc}%
                    </span>
                  )}
                </Link>
              )
            })
          )}
        </div>
      </div>

      {/* Live-update status */}
      <div className="px-3 py-2.5 border-t bg-muted/30 flex items-center gap-2 text-xs" title={live.hint}>
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', live.dot)} />
        <span className="text-muted-foreground truncate">{live.label}</span>
      </div>
    </aside>
  )
}
