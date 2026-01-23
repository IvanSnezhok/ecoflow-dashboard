import { Zap, RefreshCw } from 'lucide-react'
import { useDeviceStore } from '@/stores/deviceStore'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export function Header() {
  const { isLoading, setDevices, setLoading, setError } = useDeviceStore()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    setLoading(true)
    try {
      const response = await api.getDevices()
      setDevices(response.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch devices')
    }
    setTimeout(() => setIsRefreshing(false), 500)
  }

  return (
    <header className="border-b bg-card/80 backdrop-blur-sm">
      <div className="flex h-12 items-center px-4">
        {/* Logo and Title - Compact */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-sm bg-primary">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-bold tracking-tight">Energy Control</h1>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              Center
            </span>
          </div>
        </div>

        {/* Center - Grid pattern indicator */}
        <div className="flex-1 flex justify-center">
          <div className="hidden md:flex items-center gap-1 text-[10px] font-mono text-muted-foreground/50">
            <span className="w-8 h-px bg-border" />
            <span>ECOFLOW MONITORING SYSTEM</span>
            <span className="w-8 h-px bg-border" />
          </div>
        </div>

        {/* Right side - Refresh button */}
        <div className="flex items-center gap-3">
          {/* Last update time */}
          <span className="text-[10px] font-mono text-muted-foreground hidden sm:block">
            {new Date().toLocaleTimeString('en-US', { hour12: false })}
          </span>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium',
              'border border-border bg-background hover:bg-muted transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <RefreshCw className={cn(
              'w-3.5 h-3.5',
              (isLoading || isRefreshing) && 'animate-spin'
            )} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>
    </header>
  )
}
