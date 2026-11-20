import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { useLanguage } from '@/i18n';

import { api, errorMessage, type PushPrefs } from './api';
import { readItem, writeItem } from './storage';

const KEY = 'ecoflow.push';
export const DEFAULT_PREFS: PushPrefs = { grid: true, lowBattery: true, offline: true, threshold: 20 };

interface PushStore {
  /** off: not turned on here; denied: blocked in the phone settings; unavailable: no push on this build */
  state: 'off' | 'on' | 'denied' | 'unavailable';
  token: string | null;
  prefs: PushPrefs;
  error: string | null;
  /** After sign-in and when the language changes: re-registers a phone that has them on */
  sync: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  setPrefs: (prefs: PushPrefs) => Promise<void>;
  /** Before signing out, while the session still works */
  forget: () => Promise<void>;
}

// A message that arrives while the app is open still shows as a banner
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function expoToken(): Promise<string> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Power and battery',
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('This build has no EAS project ID (see mobile/README.md)');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

async function saved(): Promise<PushPrefs | null> {
  const text = await readItem(KEY);
  if (!text) return null;
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(text) as Partial<PushPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const usePush = create<PushStore>((set, get) => {
  const register = async (prefs: PushPrefs) => {
    const token = await expoToken();
    await api.pushRegister(token, Platform.OS, useLanguage.getState().language, prefs);
    await writeItem(KEY, JSON.stringify(prefs));
    set({ state: 'on', token, prefs, error: null });
  };

  return {
    state: Platform.OS === 'web' ? 'unavailable' : 'off',
    token: null,
    prefs: DEFAULT_PREFS,
    error: null,

    sync: async () => {
      if (Platform.OS === 'web') return;
      const prefs = await saved();
      if (!prefs) return;
      try {
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted) {
          set({ state: permission.canAskAgain ? 'off' : 'denied', prefs });
          return;
        }
        await register(prefs);
      } catch (failure) {
        // Kept as turned on: the next launch tries again
        set({ prefs, error: errorMessage(failure) });
      }
    },

    enable: async () => {
      if (Platform.OS === 'web') return;
      try {
        let permission = await Notifications.getPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
        if (!permission.granted) {
          set({ state: 'denied', error: null });
          return;
        }
        await register(get().prefs);
      } catch (failure) {
        set({ error: errorMessage(failure) });
      }
    },

    disable: async () => {
      const { token } = get();
      await writeItem(KEY, null);
      set({ state: 'off', token: null, error: null });
      if (token) await api.pushUnregister(token).catch(() => undefined);
    },

    setPrefs: async (prefs) => {
      const previous = get().prefs;
      set({ prefs });
      if (get().state !== 'on') return;
      try {
        await register(prefs);
      } catch (failure) {
        set({ prefs: previous, error: errorMessage(failure) });
      }
    },

    forget: async () => {
      const { token } = get();
      set({ state: Platform.OS === 'web' ? 'unavailable' : 'off', token: null, error: null });
      if (token) await api.pushUnregister(token).catch(() => undefined);
    },
  };
});

/** The notification the user tapped, if any. The browser preview has no notifications at all */
export const useNotificationTap: () => Notifications.NotificationResponse | null | undefined =
  Platform.OS === 'web' ? () => null : Notifications.useLastNotificationResponse;
