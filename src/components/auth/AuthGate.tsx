import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { KeyRound, Loader2, LogIn, ShieldCheck, UserPlus, Zap } from 'lucide-react'
import { api } from '@/services/api'
import { authStatusQuery } from '@/hooks/usePanelAccess'
import { ROLE_COPY } from '@/lib/panelRoles'
import type { AuthSetupStart, AuthStatus, InviteDetails } from '@/types/device'

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
function CodeInput({ value, onChange, placeholder = '6-digit code from the app' }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      className={`${inputClass} font-mono tracking-widest`}
      required
    />
  )
}

/** New username and password, twice-typed */
function NewCredentialsFields({ username, setUsername, password, setPassword, confirm, setConfirm }: {
  username: string
  setUsername: (value: string) => void
  password: string
  setPassword: (value: string) => void
  confirm: string
  setConfirm: (value: string) => void
}) {
  return (
    <>
      <input
        autoComplete="username"
        placeholder="New username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className={inputClass}
        required
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder="New password (10+ characters)"
        minLength={10}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={inputClass}
        required
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder="Repeat the new password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className={inputClass}
        required
      />
    </>
  )
}

/** Second step of a setup or change: scan the QR code, confirm with the first code. */
function AuthenticatorStep({ started, busy, error, children, onSubmit }: {
  started: AuthSetupStart
  busy: boolean
  error: string | null
  children?: ReactNode
  onSubmit: (otp: string) => void
}) {
  const [otp, setOtp] = useState('')
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Scan the code with Google Authenticator, Aegis, 1Password or a similar app, then enter the 6-digit code
        it shows. Keep the app: every sign-in asks for a fresh code.
      </p>
      <img src={started.qrCode} alt="QR code for the authenticator app" className="mx-auto w-48 h-48 rounded bg-white p-2" />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Can't scan? Enter the key by hand</summary>
        <p className="mt-2 font-mono break-all select-all">{started.secret}</p>
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(otp)
          setOtp('')
        }}
        className="space-y-3"
      >
        <CodeInput value={otp} onChange={setOtp} />
        {children}
        {error && <p className="text-sm text-energy-red">{error}</p>}
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Confirm and save
        </button>
      </form>
    </>
  )
}

/**
 * Replace the username, password and authenticator. `forced`: right after signing in with
 * the initial account, so no current password or code is asked for.
 */
export function ChangeCredentials({ forced, onDone }: { forced: boolean; onDone: (status: AuthStatus) => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [currentOtp, setCurrentOtp] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [started, setStarted] = useState<AuthSetupStart | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('The new passwords do not match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setStarted((await api.authChangeStart({ password: currentPassword, otp: currentOtp }, username.trim(), password)).data)
      setCurrentPassword('')
      setCurrentOtp('')
      setPassword('')
      setConfirm('')
    } catch (err) {
      setError(errorText(err))
      setCurrentOtp('')
    } finally {
      setBusy(false)
    }
  }

  const finish = async (otp: string) => {
    if (!started) return
    setBusy(true)
    setError(null)
    try {
      onDone((await api.authChangeFinish(started.setupId, otp)).data)
    } catch (err) {
      setError(errorText(err))
      if (/expired/i.test(errorText(err))) setStarted(null)
    } finally {
      setBusy(false)
    }
  }

  if (started) return <AuthenticatorStep started={started} busy={busy} error={error} onSubmit={(otp) => void finish(otp)} />

  return (
    <form onSubmit={start} className="space-y-3">
      {!forced && (
        <>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
            required
          />
          <CodeInput value={currentOtp} onChange={setCurrentOtp} placeholder="Current code from the app" />
        </>
      )}
      <NewCredentialsFields
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        confirm={confirm}
        setConfirm={setConfirm}
      />
      {error && <p className="text-sm text-energy-red">{error}</p>}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        Next: authenticator app
      </button>
    </form>
  )
}

function LoginScreen({ otpRequired, onDone }: { otpRequired: boolean; onDone: (status: AuthStatus) => void }) {
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
        {otpRequired && <CodeInput value={otp} onChange={setOtp} />}
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

/** After a reset (auth.json deleted): a new login, with proof of owning the server. */
function SetupScreen({ onDone }: { onDone: (status: AuthStatus) => void }) {
  const [setupSecret, setSetupSecret] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [started, setStarted] = useState<AuthSetupStart | null>(null)
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

  const finish = async (otp: string) => {
    if (!started) return
    setBusy(true)
    setError(null)
    try {
      onDone((await api.authSetupFinish(started.setupId, otp, remember)).data)
    } catch (err) {
      setError(errorText(err))
      if (/expired/i.test(errorText(err))) setStarted(null)
    } finally {
      setBusy(false)
    }
  }

  if (started) {
    return (
      <Screen title="Add the panel to your authenticator app">
        <AuthenticatorStep started={started} busy={busy} error={error} onSubmit={(otp) => void finish(otp)}>
          <RememberMe checked={remember} onChange={setRemember} />
        </AuthenticatorStep>
      </Screen>
    )
  }

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
        <NewCredentialsFields
          username={username}
          setUsername={setUsername}
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
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

/**
 * An invitation link (/invite#<token>, made in Settings → Users): the invited person
 * picks a username and password and adds an authenticator, then is signed in.
 */
function InviteScreen({ token, signedInAs, onLeave }: { token: string; signedInAs: string | null; onLeave: () => void }) {
  const [details, setDetails] = useState<InviteDetails | null>(null)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [started, setStarted] = useState<AuthSetupStart | null>(null)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.checkInvite(token).then((res) => setDetails(res.data)).catch((err) => setInvalid(errorText(err)))
  }, [token])

  const start = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('The passwords do not match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setStarted((await api.inviteStart(token, username.trim(), password)).data)
      setPassword('')
      setConfirm('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const finish = async (otp: string) => {
    if (!started) return
    setBusy(true)
    setError(null)
    try {
      await api.inviteFinish(started.setupId, otp, remember)
      // A full load, so nothing from an earlier session in this browser stays on screen
      window.location.replace('/')
    } catch (err) {
      setError(errorText(err))
      if (/expired|no longer valid/i.test(errorText(err))) setStarted(null)
      setBusy(false)
    }
  }

  if (invalid) {
    return (
      <Screen title="Invitation">
        <p className="text-sm text-muted-foreground">{invalid}</p>
        <button type="button" onClick={onLeave} className={buttonClass}>Go to the panel</button>
      </Screen>
    )
  }
  if (!details) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-mono text-muted-foreground">Loading…</div>
  }
  if (started) {
    return (
      <Screen title="Add the panel to your authenticator app">
        <AuthenticatorStep started={started} busy={busy} error={error} onSubmit={(otp) => void finish(otp)}>
          <RememberMe checked={remember} onChange={setRemember} />
        </AuthenticatorStep>
      </Screen>
    )
  }

  const role = ROLE_COPY[details.role]
  return (
    <Screen title="You are invited to the EcoFlow panel">
      <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm">
        <p>
          Role: <span className="font-medium">{role.label}</span>
        </p>
        <p className="text-xs text-muted-foreground">{role.description}.</p>
        <p className="text-xs">
          Devices:{' '}
          {details.devices === null ? 'all devices' : details.devices.map((device) => device.name).join(', ')}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose your username and password; next you add the panel to an authenticator app. The link works once,
        until {new Date(details.expiresAt).toLocaleDateString()}.
      </p>
      {signedInAs && (
        <p className="text-xs text-energy-yellow">
          This browser is signed in as {signedInAs}. Accepting signs it in as the new user instead.
        </p>
      )}
      <form onSubmit={start} className="space-y-3">
        <NewCredentialsFields
          username={username}
          setUsername={setUsername}
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
        />
        {error && <p className="text-sm text-energy-red">{error}</p>}
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          Next: authenticator app
        </button>
      </form>
    </Screen>
  )
}

/**
 * Shows the panel only with a session: the sign-in screen, the replacement of the initial
 * account right after signing in with it, the setup after a reset, or an invitation link.
 * A 401 from any API call (api.ts) brings the gate back.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: status, isLoading, error, refetch } = useQuery(authStatusQuery)

  useEffect(() => {
    const onRequired = () => void refetch()
    window.addEventListener('auth:required', onRequired)
    return () => window.removeEventListener('auth:required', onRequired)
  }, [refetch])

  const update = (next: AuthStatus) => queryClient.setQueryData(['authStatus'], next)

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
  if (!status.configured) return <SetupScreen onDone={update} />
  if (location.pathname === '/invite') {
    return (
      <InviteScreen
        token={location.hash.slice(1)}
        signedInAs={status.authenticated ? status.username : null}
        onLeave={() => navigate('/', { replace: true })}
      />
    )
  }
  if (!status.authenticated) return <LoginScreen otpRequired={status.otpRequired} onDone={update} />
  if (status.mustChange) {
    return (
      <Screen title="Replace the initial login">
        <p className="text-xs text-muted-foreground">
          You signed in with the initial account. Choose your own username and password and add an authenticator
          app; the initial login stops working, and every sign-in will ask for a code from the app.
        </p>
        <ChangeCredentials forced onDone={update} />
      </Screen>
    )
  }
  return <>{children}</>
}
