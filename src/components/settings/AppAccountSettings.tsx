import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Loader2, LogIn, Smartphone, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import type { AppChannelStatus, AppRegion } from '@/types/device'

// Login hosts for an e-mail account; usually the same region as the Open API keys
const REGIONS: Array<[value: AppRegion, label: string]> = [
  ['api-e', 'api-e.ecoflow.com (Europe)'],
  ['api', 'api.ecoflow.com'],
  ['api-a', 'api-a.ecoflow.com'],
  ['api-j', 'api-j.ecoflow.com'],
  ['api-r', 'api-r.ecoflow.com'],
]

const errorText = (err: unknown) => {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data
  return data?.error ?? (err instanceof Error ? err.message : 'Request failed')
}

const inputClass = 'w-full h-10 rounded-md border bg-background px-3 text-sm'

export function AppAccountSettings() {
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['appAccount'],
    queryFn: async () => (await api.getAppAccountStatus()).data,
    refetchInterval: 10_000,
  })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [region, setRegion] = useState<AppRegion | null>(null)
  const [busy, setBusy] = useState<'login' | 'logout' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (kind: 'login' | 'logout', call: () => Promise<{ data: AppChannelStatus }>, success: string) => {
    setBusy(kind)
    setMessage(null)
    try {
      const res = await call()
      queryClient.setQueryData(['appAccount'], res.data)
      setMessage({ ok: true, text: success })
      return true
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) })
      return false
    } finally {
      setBusy(null)
    }
  }

  const chosenRegion = region ?? status?.defaultRegion ?? 'api-e'

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await run('login', () => api.appLogin(email.trim(), password, chosenRegion), 'Signed in; shared devices load within a minute')
    // The password is only needed for this one exchange
    setPassword('')
    if (ok) setEmail('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Smartphone className="w-5 h-5" />
        <h3 className="font-semibold">EcoFlow app channel</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        For devices the Open API serves only in part, such as a station shared with you from another account:
        EcoFlow refuses their REST data and their MQTT push has no AC power or extra batteries. Signed in here,
        the panel reads them the way the EcoFlow app does. This is EcoFlow's private API, so it is unofficial and
        may stop working after an EcoFlow update. It only reads; no commands go out over it.
      </p>

      {isLoading || !status ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <span className="text-muted-foreground">Account</span>
              <p className="font-medium break-words">
                {status.signedIn ? (
                  <>
                    {status.emailHint || `User ${status.userIdHint}`}{' '}
                    <span className="text-muted-foreground font-normal">
                      ({status.region}{status.source === 'env' ? ', from .env' : ''})
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Not signed in</span>
                )}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Connection</span>
              <p className={cn('font-medium', status.connected ? 'text-energy-green' : status.signedIn ? 'text-energy-yellow' : 'text-muted-foreground')}>
                {status.connected ? 'Connected' : status.signedIn ? 'Connecting…' : 'Off'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Devices read here</span>
              <p className="font-mono text-xs mt-0.5 break-all">
                {status.devices.length > 0 ? status.devices.join(', ') : <span className="font-sans text-muted-foreground">none need it now</span>}
              </p>
            </div>
            {status.lastError && (
              <p className="sm:col-span-3 text-xs text-energy-red break-words">{status.lastError}</p>
            )}
          </div>

          <form onSubmit={handleLogin} className="space-y-3 pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              Sign in with the EcoFlow account you use in the app. The password is sent once to EcoFlow and is not
              stored; the panel keeps only the sign-in token.
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
              <select
                value={chosenRegion}
                onChange={(e) => setRegion(e.target.value as AppRegion)}
                className={inputClass}
                aria-label="Region"
              >
                {REGIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy !== null}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === 'login' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                {status.signedIn ? 'Sign in again' : 'Sign in'}
              </button>
              {status.signedIn && status.source === 'panel' && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run('logout', () => api.appLogout(), 'Signed out; the saved token is deleted')}
                  className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
                >
                  Sign out
                </button>
              )}
            </div>
          </form>

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
