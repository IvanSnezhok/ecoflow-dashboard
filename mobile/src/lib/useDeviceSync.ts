import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useDeviceStore } from '@panel/stores/deviceStore';

import { api, ApiError, errorMessage } from './api';
import { direct } from './direct';
import { live } from './live';
import { useSession } from './session';

// The panel's collector stores a sample every 10 s; the list is read at the same pace
const POLL_MS = 10_000;

let inFlight: Promise<void> | null = null;
let loaded = false;

/** Reads the device list; the first answer replaces the store, later ones merge in */
export function refreshDevices(): Promise<void> {
  if (inFlight) return inFlight;
  const store = useDeviceStore.getState();
  const first = !loaded;
  if (first && !store.error) store.setLoading(true);
  inFlight = api.devices()
    .then((devices) => {
      useDeviceStore.getState().mergeDevicesFromServer(devices);
      loaded = true;
      void direct.panelAnswered(devices);
    })
    .catch((error) => {
      // A failed poll keeps the last data on screen; only a failed first load is shown
      if (first) useDeviceStore.getState().setError(errorMessage(error));
      // No path to the panel, or its gateway says it is down: the independent mode's cue
      if (error instanceof ApiError && [0, 502, 503, 504].includes(error.status)) direct.panelFailed();
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** While signed in and on screen: polls the device list and keeps the live socket open */
export function useDeviceSync(): void {
  const signedIn = useSession((s) => s.phase === 'signedIn');
  const serverUrl = useSession((s) => s.serverUrl);
  const token = useSession((s) => s.token);
  const [active, setActive] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state !== 'background'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!signedIn || !serverUrl || !token) {
      loaded = false;
      return;
    }
    if (!active) return;
    live.onSignedOut = () => void useSession.getState().refreshStatus();
    live.start(serverUrl, token);
    void refreshDevices();
    const interval = setInterval(() => void refreshDevices(), POLL_MS);
    return () => {
      clearInterval(interval);
      live.stop();
    };
  }, [signedIn, serverUrl, token, active]);
}
