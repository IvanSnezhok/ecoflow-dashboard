import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bluetooth, CheckCircle, Loader2, LogIn, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { TechnicalToggle } from '@/components/ui/TechnicalToggle'
import type { BleOverview } from '@/types/device'

// Hosts eflib can log in to; "auto" picks api.ecoflow.com for e-mail logins
const REGIONS: Array<[value: string, label: string]> = [
  ['auto', 'Auto'],
  ['api-e', 'api-e.ecoflow.com (Europe)'],
  ['api', 'api.ecoflow.com'],
  ['api-a', 'api-a.ecoflow.com'],
  ['api-j', 'api-j.ecoflow.com'],
  ['api-r', 'api-r.ecoflow.com'],
  ['api-cn', 'api-cn.ecoflow.com (phone number)'],
]

const SOURCE_LABELS: Record<string, string> = {
  panel: 'set on this page',
  login: 'from .env login',
  env: 'from .env',
}

const errorText = (err: unknown) => {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data
  return data?.error ?? (err instanceof Error ? err.message : 'Request failed')
}

const inputClass = 'w-full h-10 rounded-md border bg-background px-3 text-sm'

export function BleAccountSettings() {
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['bleStatus'],
    queryFn: async () => (await api.getBleStatus()).data,
    refetchInterval: 5_000,
  })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [region, setRegion] = useState('auto')
  const [userId, setUserId] = useState('')
  const [busy, setBusy] = useState<'login' | 'id' | 'forget' | 'settings' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (kind: 'login' | 'id' | 'forget' | 'settings', call: () => Promise<{ data: BleOverview }>, success: string) => {
    setBusy(kind)
    setMessage(null)
    try {
      const res = await call()
      queryClient.setQueryData(['bleStatus'], res.data)
      void queryClient.invalidateQueries({ queryKey: ['deviceInfo'] })
      setMessage({ ok: true, text: success })
      return true
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) })
      return false
    } finally {
      setBusy(null)
    }
  }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await run('login', () => api.bleLogin(email.trim(), password, region), 'Signed in; Bluetooth will connect with this account')
    // The password is only needed for this one exchange
    setPassword('')
    if (ok) setEmail('')
  }

  const handleUserId = async (e: FormEvent) => {
    e.preventDefault()
    if (await run('id', () => api.bleSetUserId(userId.trim()), 'User ID saved')) setUserId('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Bluetooth className="w-5 h-5" />
        <h3 className="font-semibold">Bluetooth (BLE)</h3>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !status?.enabled ? (
        <p className="text-sm text-muted-foreground">
          The BLE bridge is not configured. It runs as the <code>ble-bridge</code> service in{' '}
          <code>compose.yaml</code>; see the README section “Bluetooth (BLE) connection”.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b">
            <TechnicalToggle
              checked={status.switchedOn}
              onChange={(on) =>
                run('settings', () => api.bleUpdateSettings({ enabled: on }), on ? 'Bluetooth turned on' : 'Bluetooth turned off')
              }
              disabled={busy !== null || !status.reachable}
              label="Use Bluetooth"
              description={
                status.switchedOn
                  ? 'The panel keeps a direct connection to the station'
                  : 'Off: cloud only, and the EcoFlow app can use Bluetooth'
              }
              size="md"
            />
            <div className={cn('min-w-[16rem]', !status.switchedOn && 'opacity-50')}>
              <span className="block text-sm font-medium mb-1">Primary channel</span>
              <div className="flex gap-2">
                {([
                  ['prefer', 'Bluetooth first'],
                  ['fallback', 'Cloud first'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={busy !== null || !status.reachable || !status.switchedOn}
                    onClick={() => run('settings', () => api.bleUpdateSettings({ mode: value }), `${label}; the other channel is the backup`)}
                    className={cn(
                      'flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed',
                      status.mode === value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-accent',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={cn('grid gap-3 sm:grid-cols-2 text-sm', !status.switchedOn && 'opacity-60')}>
            <div>
              <span className="text-muted-foreground">Bridge</span>
              <p className={cn('font-medium', status.reachable ? 'text-energy-green' : 'text-energy-red')}>
                {status.reachable ? (status.scannerError ? 'Running · adapter error' : 'Running') : 'Unreachable'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Account</span>
              <p className="font-medium">
                {status.userIdConfigured ? (
                  <>
                    User ID {status.userIdHint}{' '}
                    <span className="text-muted-foreground font-normal">
                      ({SOURCE_LABELS[status.userIdSource ?? ''] ?? 'set'})
                    </span>
                  </>
                ) : (
                  <span className="text-energy-yellow">Not set — sign in below</span>
                )}
              </p>
            </div>
            {status.devices.length > 0 && (
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Devices in range</span>
                <ul className="mt-1 space-y-0.5">
                  {status.devices.map((d) => (
                    <li key={d.sn} className="font-mono text-xs flex flex-wrap gap-x-2">
                      <span>{d.sn}</span>
                      <span className={d.live ? 'text-energy-green' : 'text-muted-foreground'}>
                        {d.live ? 'connected' : d.state.replace(/_/g, ' ')}
                      </span>
                      {!d.live && d.error && <span className="text-energy-red break-all">{d.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(status.scannerError || status.loginError) && (
              <p className="sm:col-span-2 text-xs text-energy-red break-words">
                {status.scannerError ?? status.loginError}
              </p>
            )}
          </div>

          <form onSubmit={handleLogin} className="space-y-3 pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              Sign in with the account the station is bound to in the EcoFlow app. The password is sent
              once to EcoFlow to look up your user ID and is not stored.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="email"
                autoComplete="username"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                required
              />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                required
              />
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass} aria-label="Region">
                {REGIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={busy !== null || !status.reachable}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy === 'login' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Sign in
            </button>
          </form>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Enter the user ID instead</summary>
            <form onSubmit={handleUserId} className="mt-3 flex flex-wrap gap-2">
              <input
                inputMode="numeric"
                pattern="[0-9]+"
                placeholder="User ID (digits)"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className={cn(inputClass, 'max-w-xs')}
                required
              />
              <button
                type="submit"
                disabled={busy !== null || !status.reachable}
                className="px-4 py-2 text-sm rounded-lg border hover:bg-accent disabled:opacity-50"
              >
                {busy === 'id' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
            </form>
          </details>

          {status.userIdSource === 'panel' && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('forget', () => api.bleForgetUserId(), 'Saved user ID removed')}
              className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
            >
              Forget the saved user ID
            </button>
          )}

          {message && (
            <div className={cn('flex items-center gap-2 text-sm', message.ok ? 'text-energy-green' : 'text-energy-red')}>
              {message.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {message.text}
            </div>
          )}
        </>
      )}
    </div>
  )
}
