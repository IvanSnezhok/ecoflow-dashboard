import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, Loader2, Pencil, UserPlus, Users, X } from 'lucide-react'
import { api } from '@/services/api'
import { useDeviceStore } from '@/stores/deviceStore'
import { ROLE_COPY, devicesSummary } from '@/lib/panelRoles'
import { cn } from '@/lib/utils'
import type { MemberRole, PanelMember, PanelUsers } from '@/types/device'

const MEMBER_ROLES: MemberRole[] = ['viewer', 'operator']
const smallButton = 'text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50'
const primaryButton =
  'flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'

const formatMoment = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Request failed')

function useDeviceName() {
  const devices = useDeviceStore((s) => s.devices)
  return (sn: string) => devices.find((device) => device.serialNumber === sn)?.name ?? sn
}

function RolePicker({ value, onChange }: { value: MemberRole; onChange: (role: MemberRole) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {MEMBER_ROLES.map((role) => (
        <label
          key={role}
          className={cn(
            'flex items-start gap-2 rounded-md border p-3 cursor-pointer text-sm',
            value === role ? 'border-primary bg-primary/5' : 'hover:bg-accent',
          )}
        >
          <input type="radio" className="mt-1" checked={value === role} onChange={() => onChange(role)} />
          <span>
            <span className="font-medium">{ROLE_COPY[role].label}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_COPY[role].description}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

/** All devices (also ones added later), or a chosen set */
function DevicePicker({ value, onChange }: { value: string[] | null; onChange: (devices: string[] | null) => void }) {
  const devices = useDeviceStore((s) => s.devices)
  const name = useDeviceName()
  // Devices given earlier that the panel no longer lists stay visible, so they can be taken away
  const serials = [...new Set([...devices.map((device) => device.serialNumber), ...(value ?? [])])]
  const toggle = (sn: string) => {
    const current = value ?? []
    onChange(current.includes(sn) ? current.filter((item) => item !== sn) : [...current, sn])
  }
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : [])} />
        All devices, also ones added later
      </label>
      {value !== null && (
        <div className="ml-6 space-y-1">
          {serials.map((sn) => (
            <label key={sn} className="flex items-center gap-2">
              <input type="checkbox" checked={value.includes(sn)} onChange={() => toggle(sn)} />
              <span>{name(sn)}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{sn}</span>
            </label>
          ))}
          {value.length === 0 && <p className="text-xs text-energy-yellow">Choose at least one device</p>}
        </div>
      )}
    </div>
  )
}

function InviteForm({ onCreated, onCancel }: { onCreated: (link: string) => void; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<MemberRole>('viewer')
  const [devices, setDevices] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const { token } = (await api.createInvite(role, devices)).data
      void queryClient.invalidateQueries({ queryKey: ['panelUsers'] })
      onCreated(`${window.location.origin}/invite#${token}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border p-4 space-y-4">
      <RolePicker value={role} onChange={setRole} />
      <DevicePicker value={devices} onChange={setDevices} />
      {error && <p className="text-sm text-energy-red">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || (devices !== null && devices.length === 0)}
          onClick={() => void create()}
          className={primaryButton}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          Create invitation link
        </button>
        <button type="button" onClick={onCancel} className={smallButton}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** The new link: shown once, the server keeps only its hash */
function InviteLink({ link, onDone }: { link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-3">
      <p className="text-sm font-medium">Invitation link</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 h-9 rounded-md border bg-background px-2 text-xs font-mono"
        />
        <button type="button" onClick={() => void copy()} className="flex items-center gap-1 px-3 h-9 text-xs rounded-md border hover:bg-accent">
          {copied ? <Check className="w-3.5 h-3.5 text-energy-green" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Send it to the person yourself (a messenger, an email). It works once, for 7 days, and is shown only now:
        if it gets lost, revoke it below and make a new one.
      </p>
      <button type="button" onClick={onDone} className={smallButton}>
        Done
      </button>
    </div>
  )
}

function MemberRow({ member, onChanged }: { member: PanelMember; onChanged: (next: PanelUsers) => void }) {
  const name = useDeviceName()
  const [editing, setEditing] = useState(false)
  const [role, setRole] = useState<MemberRole>(member.role)
  const [devices, setDevices] = useState<string[] | null>(member.devices)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (request: () => Promise<{ data: PanelUsers }>) => {
    setBusy(true)
    setError(null)
    try {
      onChanged((await request()).data)
      setEditing(false)
      setConfirmRemove(false)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <span className="font-medium">{member.username}</span>
          <span className="ml-2 text-xs rounded border px-1.5 py-0.5">{ROLE_COPY[member.role].label}</span>
          <p className="text-xs text-muted-foreground">
            {member.devices === null ? 'All devices' : member.devices.map(name).join(', ')}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {member.lastSeenAt ? `last active ${formatMoment(member.lastSeenAt)}` : 'not signed in'}
        </span>
      </div>

      {editing ? (
        <div className="rounded-md border p-3 space-y-3">
          <RolePicker value={role} onChange={setRole} />
          <DevicePicker value={devices} onChange={setDevices} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || (devices !== null && devices.length === 0)}
              onClick={() => void run(() => api.updatePanelUser(member.id, { role, devices }))}
              className={primaryButton}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setRole(member.role)
                setDevices(member.devices)
              }}
              className={smallButton}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : confirmRemove ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Remove {member.username}? They are signed out at once.</span>
          <button type="button" disabled={busy} onClick={() => void run(() => api.removePanelUser(member.id))} className="text-energy-red underline text-xs">
            Remove
          </button>
          <button type="button" onClick={() => setConfirmRemove(false)} className={smallButton}>
            Keep
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => setEditing(true)} className={cn(smallButton, 'flex items-center gap-1 no-underline hover:underline')}>
            <Pencil className="w-3 h-3" /> Role and devices
          </button>
          {member.sessions > 0 && (
            <button type="button" disabled={busy} onClick={() => void run(() => api.signOutPanelUser(member.id))} className={smallButton}>
              Sign out everywhere
            </button>
          )}
          <button type="button" onClick={() => setConfirmRemove(true)} className={cn(smallButton, 'hover:text-energy-red')}>
            Remove
          </button>
        </div>
      )}
      {error && <p className="text-sm text-energy-red">{error}</p>}
    </li>
  )
}

/** Settings → Users (owner only): invitations, roles and devices of invited users. */
export function PanelUsersSettings() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ['panelUsers'],
    queryFn: async () => (await api.getPanelUsers()).data,
    refetchInterval: 60_000,
  })
  const [inviting, setInviting] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const set = (next: PanelUsers) => queryClient.setQueryData(['panelUsers'], next)

  const revoke = async (id: string) => {
    setRevokeError(null)
    try {
      set((await api.revokeInvite(id)).data)
    } catch (err) {
      setRevokeError(errorText(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5" />
        <h3 className="font-semibold">Users</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Invite people to watch the panel or to control devices. Each person signs in with their own username,
        password and authenticator app, and sees only the devices you choose. Automation, logs, users and these
        settings stay yours.
      </p>

      {link ? (
        <InviteLink link={link} onDone={() => setLink(null)} />
      ) : inviting ? (
        <InviteForm
          onCreated={(created) => {
            setInviting(false)
            setLink(created)
          }}
          onCancel={() => setInviting(false)}
        />
      ) : (
        <button type="button" onClick={() => setInviting(true)} className={primaryButton}>
          <UserPlus className="w-4 h-4" />
          Invite someone
        </button>
      )}

      {error && <p className="text-sm text-energy-red">{errorText(error)}</p>}

      {data && data.invites.length > 0 && (
        <div>
          <span className="text-sm text-muted-foreground">Open invitations</span>
          <ul className="mt-1 divide-y divide-border/50 text-xs">
            {data.invites.map((invite) => (
              <li key={invite.id} className="py-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span>
                  <span className="font-medium">{ROLE_COPY[invite.role].label}</span> · {devicesSummary(invite.devices)}
                  <span className="text-muted-foreground"> · made {formatMoment(invite.createdAt)}, works until {formatMoment(invite.expiresAt)}</span>
                </span>
                <button type="button" onClick={() => void revoke(invite.id)} className={cn(smallButton, 'flex items-center gap-1')}>
                  <X className="w-3 h-3" /> Revoke
                </button>
              </li>
            ))}
          </ul>
          {revokeError && <p className="text-sm text-energy-red">{revokeError}</p>}
        </div>
      )}

      {data && (
        <div>
          <span className="text-sm text-muted-foreground">Invited users</span>
          {data.members.length === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">Nobody yet.</p>
          ) : (
            <ul className="divide-y divide-border/50 text-sm">
              {data.members.map((member) => (
                <MemberRow key={member.id} member={member} onChanged={set} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
