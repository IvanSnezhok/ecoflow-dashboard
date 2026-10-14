import { Zap, RefreshCw, Menu, X } from 'lucide-react'
import { useDeviceStore } from '@/stores/deviceStore'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { useState } from 'react'

interface HeaderProps {
  isNavOpen?: boolean
  onMenuClick?: () => void
}

export function Header({ isNavOpen = false, onMenuClick }: HeaderProps) {
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
    <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur-sm">
      <div className="flex h-12 items-center px-3 sm:px-4">
        {/* Menu toggle - phones/tablets only */}
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label={isNavOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isNavOpen}
            className="md:hidden -ml-1 mr-2 p-2 rounded-sm hover:bg-muted transition-colors"
          >
            {isNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        )}

        {/* Logo and Title - Compact */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-sm bg-primary">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-bold tracking-tight">Energy Control</h1>
            <span className="hidden min-[400px]:inline text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
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
              'flex items-center gap-1.5 px-2.5 py-2 sm:py-1 rounded-sm text-xs font-medium',
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
