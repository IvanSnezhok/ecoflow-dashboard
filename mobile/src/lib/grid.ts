import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import type { PowerDay, ResilienceSettings, ResilienceStatus } from '@panel/types/resilience';

import { api, errorMessage } from './api';
import { useAccess, useSession } from './session';

const REFRESH_MS = 30_000;
export const TIMELINE_DAYS = 7;

interface GridStore {
  status: ResilienceStatus | null;
  settings: ResilienceSettings | null;
  days: PowerDay[];
  /** When it was read: durations on screen count from here */
  at: number;
  error: string | null;
  refresh: () => Promise<void>;
  clear: () => void;
}

/** Grid state, reserve forecast, outage schedule and the last week, shared by the tabs */
export const useGrid = create<GridStore>((set) => ({
  status: null,
  settings: null,
  days: [],
  at: 0,
  error: null,
  refresh: async () => {
    try {
      const [status, days, settings] = await Promise.all([
        api.resilienceStatus(),
        api.resilienceTimeline(TIMELINE_DAYS),
        api.resilienceSettings().catch(() => null),
      ]);
      set({ status, days, settings, at: Date.now(), error: null });
    } catch (failure) {
      set({ error: errorMessage(failure) });
    }
  },
  clear: () => set({ status: null, settings: null, days: [], at: 0, error: null }),
}));

/** Keeps the grid data fresh while signed in, on screen and allowed to see it */
export function useGridSync(): void {
  const signedIn = useSession((s) => s.phase === 'signedIn');
  const { powerReserve } = useAccess();
  useEffect(() => {
    if (!signedIn || !powerReserve) {
      useGrid.getState().clear();
      return;
    }
    const load = () => {
      if (AppState.currentState !== 'background') void useGrid.getState().refresh();
    };
    load();
    const interval = setInterval(load, REFRESH_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [signedIn, powerReserve]);
}
