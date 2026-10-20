import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react'
import { api } from '@/services/api'
import { ChangeCredentials } from '@/components/auth/AuthGate'
import { wsClient } from '@/services/wsClient'
import { useDeviceStore } from '@/stores/deviceStore'
import type { AuthStatus } from '@/types/device'

const formatMoment = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** "Chrome on Windows"-style label from a user agent string */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser'
  const system = /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android'
    : /Windows/.test(userAgent) ? 'Windows' : /Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : ''
  return system ? `${browser} on ${system}` : browser
}

export function PanelLoginSettings() {
  const queryClient = useQueryClient()
  const status = queryClient.getQueryData<AuthStatus>(['authStatus'])
  const { data: sessions } = useQuery({
    queryKey: ['authSessions'],
    queryFn: async () => (await api.getAuthSessions()).data,
    refetchInterval: 60_000,
  })
  const [busy, setBusy] = useState<'logout' | 'others' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [changed, setChanged] = useState(false)

  const signOut = async () => {
    setBusy('logout')
    try {
      const res = await api.authLogout()
      wsClient.disconnect()
      useDeviceStore.getState().setDevices([])
      queryClient.clear()
      queryClient.setQueryData(['authStatus'], res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed')
      setBusy(null)
    }
  }

  const signOutOthers = async () => {
    setBusy('others')
    setError(null)
    try {
      queryClient.setQueryData(['authSessions'], (await api.revokeOtherSessions()).data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(null)
    }
  }

  const others = sessions?.filter((session) => !session.current).length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5" />
        <h3 className="font-semibold">Panel login</h3>
      </div>
      <p className="text-sm">
        Signed in as <span className="font-medium">{status?.username ?? '…'}</span>, with a password and an
        authenticator app.
      </p>

      {sessions && sessions.length > 0 && (
        <div>
          <span className="text-sm text-muted-foreground">Signed-in devices</span>
          <ul className="mt-1 divide-y divide-border/50 text-xs">
            {sessions.map((session) => (
              <li key={session.id} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">
                  {deviceLabel(session.userAgent)}
                  {session.current && <span className="ml-1 text-energy-green">· this device</span>}
                </span>
                <span className="text-muted-foreground">
                  last used {formatMoment(session.lastSeenAt)} ·{' '}
                  {session.remember ? `remembered until ${formatMoment(session.expiresAt)}` : 'until the browser closes'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void signOut()}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border hover:bg-accent disabled:opacity-50"
        >
          {busy === 'logout' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          Sign out
        </button>
        {others > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void signOutOthers()}
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            Sign out the other {others === 1 ? 'device' : `${others} devices`}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-energy-red">{error}</p>}

      <div className="pt-4 border-t space-y-3">
        {changing ? (
          <div className="max-w-sm space-y-3">
            <p className="text-xs text-muted-foreground">
              New username and password, and the panel added to your authenticator app again. Other devices are
              signed out; this one stays signed in.
            </p>
            <ChangeCredentials
              forced={false}
              onDone={(next) => {
                queryClient.setQueryData(['authStatus'], next)
                void queryClient.invalidateQueries({ queryKey: ['authSessions'] })
                setChanging(false)
                setChanged(true)
              }}
            />
            <button type="button" onClick={() => setChanging(false)} className="text-xs text-muted-foreground underline hover:text-foreground">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setChanging(true)
              setChanged(false)
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border hover:bg-accent"
          >
            <KeyRound className="w-4 h-4" />
            Change username, password and authenticator
          </button>
        )}
        {changed && (
          <p className="flex items-center gap-2 text-sm text-energy-green">
            <CheckCircle className="w-4 h-4" /> Saved; sign in with the new login from now on
          </p>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Lost the authenticator app? Delete <code className="font-mono">server/data/auth.json</code> on the server and
        restart the panel: it signs everyone out and offers the setup again, with a new setup code in the server log.
      </p>
    </div>
  )
}
