import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, LogIn, ShieldCheck, Zap } from 'lucide-react'
import { api } from '@/services/api'
import type { AuthSetupStart, AuthStatus } from '@/types/device'

const inputClass = 'w-full h-10 rounded-md border bg-background px-3 text-sm'
const buttonClass =
  'w-full flex items-center justify-center gap-2 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Request failed')

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-sm bg-primary">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-base font-bold tracking-tight">Energy Control</h1>
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Center</span>
        </div>
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="font-semibold">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  )
}

function RememberMe({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      Remember me on this device for 30 days
    </label>
  )
}

/** 6-digit code from the authenticator app */
function CodeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      placeholder="6-digit code from the app"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      className={`${inputClass} font-mono tracking-widest`}
      required
    />
  )
}

function LoginScreen({ onDone }: { onDone: (status: AuthStatus) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone((await api.authLogin(username.trim(), password, otp, remember)).data)
    } catch (err) {
      setError(errorText(err))
      setOtp('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Sign in">
      <form onSubmit={submit} className="space-y-3">
        <input
          autoComplete="username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
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
        <CodeInput value={otp} onChange={setOtp} />
        <RememberMe checked={remember} onChange={setRemember} />
        {error && <p className="text-sm text-energy-red">{error}</p>}
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          Sign in
        </button>
      </form>
    </Screen>
  )
}

function SetupScreen({ onDone }: { onDone: (status: AuthStatus) => void }) {
  const [setupSecret, setSetupSecret] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [started, setStarted] = useState<AuthSetupStart | null>(null)
  const [otp, setOtp] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('The passwords do not match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setStarted((await api.authSetupStart(setupSecret, username.trim(), password)).data)
      setPassword('')
      setConfirm('')
      setSetupSecret('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const finish = async (e: FormEvent) => {
    e.preventDefault()
    if (!started) return
    setBusy(true)
    setError(null)
    try {
      onDone((await api.authSetupFinish(started.setupId, otp, remember)).data)
    } catch (err) {
      setError(errorText(err))
      setOtp('')
      // An expired setup cannot be finished; start over
      if (/expired/i.test(errorText(err))) setStarted(null)
    } finally {
      setBusy(false)
    }
  }

  if (!started) {
    return (
      <Screen title="Set up the panel login">
        <p className="text-xs text-muted-foreground">
          This panel is reachable from the internet. Set a login with a password and an authenticator app
          before using it. To prove the server is yours, enter the setup code from the server log
          (<code className="font-mono">docker logs ecoflow-dashboard | grep "Setup code"</code>, also in{' '}
          <code className="font-mono">server/data/auth-setup-code.txt</code>) or the EcoFlow{' '}
          <code className="font-mono">ECOFLOW_SECRET_KEY</code> from <code className="font-mono">.env</code>.
        </p>
        <form onSubmit={start} className="space-y-3">
          <input
            type="password"
            autoComplete="off"
            placeholder="Setup code or EcoFlow secret key"
            value={setupSecret}
            onChange={(e) => setSetupSecret(e.target.value)}
            className={inputClass}
            required
          />
          <input
            autoComplete="username"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
            required
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Password (10+ characters)"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            required
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Repeat the password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
            required
          />
          {error && <p className="text-sm text-energy-red">{error}</p>}
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Next: authenticator app
          </button>
        </form>
      </Screen>
    )
  }

  return (
    <Screen title="Add the panel to your authenticator app">
      <p className="text-xs text-muted-foreground">
        Scan the code with Google Authenticator, Aegis, 1Password or a similar app, then enter the 6-digit code
        it shows. Keep the app: every sign-in asks for a fresh code.
      </p>
      <img src={started.qrCode} alt="QR code for the authenticator app" className="mx-auto w-48 h-48 rounded bg-white p-2" />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Can't scan? Enter the key by hand</summary>
        <p className="mt-2 font-mono break-all select-all">{started.secret}</p>
      </details>
      <form onSubmit={finish} className="space-y-3">
        <CodeInput value={otp} onChange={setOtp} />
        <RememberMe checked={remember} onChange={setRemember} />
        {error && <p className="text-sm text-energy-red">{error}</p>}
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Finish and sign in
        </button>
      </form>
    </Screen>
  )
}

/**
 * Shows the panel only with a session: the first-run setup while no login exists, else
 * the sign-in screen. A 401 from any API call (api.ts) brings the sign-in back.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data: status, isLoading, error, refetch } = useQuery({
    queryKey: ['authStatus'],
    queryFn: async () => (await api.getAuthStatus()).data,
    staleTime: Infinity,
  })

  useEffect(() => {
    const onRequired = () => void refetch()
    window.addEventListener('auth:required', onRequired)
    return () => window.removeEventListener('auth:required', onRequired)
  }, [refetch])

  const signedIn = (next: AuthStatus) => queryClient.setQueryData(['authStatus'], next)

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-mono text-muted-foreground">Loading…</div>
  }
  if (error || !status) {
    return (
      <Screen title="The panel server does not answer">
        <p className="text-sm text-muted-foreground">{error ? errorText(error) : 'No answer'}</p>
        <button type="button" onClick={() => void refetch()} className={buttonClass}>Try again</button>
      </Screen>
    )
  }
  if (!status.configured) return <SetupScreen onDone={signedIn} />
  if (!status.authenticated) return <LoginScreen onDone={signedIn} />
  return <>{children}</>
}
