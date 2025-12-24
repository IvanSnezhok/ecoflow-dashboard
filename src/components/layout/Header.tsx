import { Wifi, WifiOff, Zap } from 'lucide-react'
import { useMqtt } from '@/hooks/useMqtt'
import { cn } from '@/lib/utils'

export function Header() {
  const { wsConnected, mqttConnected } = useMqtt()

  return (
    <header className="border-b bg-card">
      <div className="flex h-16 items-center px-6">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary">
            <Zap className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Ecoflow Dashboard</h1>
            <p className="text-xs text-muted-foreground">Control & Monitoring</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              {wsConnected ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-500" />
              )}
              <span className={cn(wsConnected ? 'text-green-600' : 'text-red-600')}>
                {wsConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {wsConnected && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    mqttConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
                  )}
                />
                <span>{mqttConnected ? 'MQTT Live' : 'MQTT Connecting...'}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
