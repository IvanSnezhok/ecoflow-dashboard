import { create } from 'zustand';

import { useDeviceStore } from '@panel/stores/deviceStore';
import type { AuthStatus } from '@panel/types/device';

import { tNow } from '@/i18n';

import { ApiError, api, setConnection } from './api';
import { normalizeServerUrl } from './serverUrl';
import { readItem, writeItem } from './storage';

const KEY_SERVER = 'ecoflow.serverUrl';
const KEY_TOKEN = 'ecoflow.sessionToken';
const KEY_USERNAME = 'ecoflow.username';

interface SessionStore {
  /** restoring: reading the keychain at launch */
  phase: 'restoring' | 'signedOut' | 'signedIn';
  serverUrl: string | null;
  token: string | null;
  /** Who is signed in and what they may do (role, devices, Power reserve) */
  status: AuthStatus | null;
  /** Last used name, to prefill the sign-in form */
  username: string | null;
  /** Why the app returned to the sign-in screen, when it was not the user's choice */
  notice: string | null;
  restore: () => Promise<void>;
  signIn: (server: string, username: string, password: string, otp: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** The panel refused the session (expired, revoked, user removed) */
  expire: () => void;
  refreshStatus: () => Promise<void>;
}

export const useSession = create<SessionStore>((set, get) => {
  const open = (serverUrl: string, token: string, status: AuthStatus) => {
    setConnection({ serverUrl, token }, () => get().expire());
    set({ phase: 'signedIn', serverUrl, token, status, notice: null });
  };

  const close = (notice: string | null) => {
    setConnection(null);
    void writeItem(KEY_TOKEN, null);
    useDeviceStore.getState().setDevices([]);
    set({ phase: 'signedOut', token: null, status: null, notice });
  };

  return {
    phase: 'restoring',
    serverUrl: null,
    token: null,
    status: null,
    username: null,
    notice: null,

    restore: async () => {
      const [serverUrl, token, username] = await Promise.all([readItem(KEY_SERVER), readItem(KEY_TOKEN), readItem(KEY_USERNAME)]);
      set({ serverUrl, username });
      if (!serverUrl || !token) {
        set({ phase: 'signedOut' });
        return;
      }
      try {
        const status = await api.authStatus(serverUrl, token);
        if (status.authenticated && !status.mustChange) open(serverUrl, token, status);
        else close(tNow('signin.ended'));
      } catch {
        // The panel is unreachable right now: keep the session and show the app with
        // what it can load later, instead of asking for a password during an outage
        open(serverUrl, token, {
          configured: true, authenticated: true, username, role: null, devices: null,
          mustChange: false, otpRequired: true, powerReserve: false,
        });
      }
    },

    signIn: async (server, username, password, otp) => {
      const serverUrl = normalizeServerUrl(server);
      if (!serverUrl) throw new Error(tNow('signin.badAddress'));
      const name = username.trim();

      let probe: AuthStatus;
      try {
        probe = await api.authStatus(serverUrl);
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) throw new Error(`${error.message} at ${serverUrl}`);
        throw error;
      }
      if (!probe.configured) throw new Error(tNow('signin.noLogin'));

      const answer = await api.signIn(serverUrl, name, password, otp.replace(/\s+/g, ''));
      const { token, ...status } = answer;
      if (!token) throw new Error(tNow('signin.oldPanel'));
      if (status.mustChange) {
        void api.authStatus(serverUrl, token).catch(() => undefined);
        throw new Error(tNow('signin.initial'));
      }
      await Promise.all([writeItem(KEY_SERVER, serverUrl), writeItem(KEY_TOKEN, token), writeItem(KEY_USERNAME, name)]);
      set({ username: name });
      open(serverUrl, token, status);
    },

    signOut: async () => {
      // Ends the session on the panel too; signing out works even when it is unreachable
      await api.signOut().catch(() => undefined);
      close(null);
    },

    expire: () => {
      if (get().phase === 'signedIn') close(tNow('signin.ended'));
    },

    refreshStatus: async () => {
      const { serverUrl, token, phase } = get();
      if (phase !== 'signedIn' || !serverUrl || !token) return;
      try {
        const status = await api.authStatus(serverUrl, token);
        if (get().token !== token) return;
        if (status.authenticated && !status.mustChange) set({ status });
        else get().expire();
      } catch {
        // Unreachable: keep what is known
      }
    },
  };
});

/** What the signed-in user may do; mirrors the panel's usePanelAccess */
export function useAccess() {
  const status = useSession((s) => s.status);
  return {
    username: status?.username ?? null,
    role: status?.role ?? null,
    canControl: status?.role === 'owner' || status?.role === 'operator',
    powerReserve: status?.powerReserve === true,
  };
}
