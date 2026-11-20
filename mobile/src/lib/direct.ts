import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { useDeviceStore } from '@panel/stores/deviceStore';
import type { DeviceState, DeviceWithState } from '@panel/types/device';

import { EcoflowCloud, isDeltaPro, quotaToState, type DirectAction, type DirectCredentials } from './direct/cloud';
import { readItem, writeItem } from './storage';

/**
 * Independent mode. The panel usually sits at home behind the same power and internet
 * that an outage takes down, while the stations keep reporting to the EcoFlow cloud over
 * their own link. With the owner's consent the phone keeps the EcoFlow API keys (in the
 * phone's secure storage) and, when the panel stops answering, reads and controls the
 * stations straight from the cloud. What it reads meanwhile is kept and handed to the
 * panel afterwards, so the history has fewer holes.
 */

const KEY_CREDENTIALS = 'ecoflow.direct';
const KEY_DEVICES = 'ecoflow.direct.devices';
const KEY_SAMPLES = 'ecoflow.direct.samples';

/** Panel requests that must fail in a row before the phone goes direct */
const FAILURES_TO_SWITCH = 2;
const POLL_MS = 15_000;
/** One stored reading a minute per station, about two days of them */
const SAMPLE_MS = 60_000;
const MAX_SAMPLES = 3000;
const DEVICE_CACHE_MS = 5 * 60_000;

export interface DirectSample {
  t: number;
  batterySoc: number | null;
  batteryWatts: number | null;
  acInputWatts: number | null;
  solarInputWatts: number | null;
  acOutputWatts: number | null;
  dcOutputWatts: number | null;
  temperature: number | null;
}

interface DirectStore {
  /** The keys are on this phone */
  configured: boolean;
  /** The panel is unreachable and the data comes from the EcoFlow cloud */
  active: boolean;
  /** Why the cloud could not be read either */
  error: string | null;
  /** Readings waiting to be handed to the panel */
  waiting: number;
}

export const useDirect = create<DirectStore>(() => ({ configured: false, active: false, error: null, waiting: 0 }));

let credentials: DirectCredentials | null = null;
let failures = 0;
let lastPoll = 0;
let polling = false;
let cachedAt = 0;
let samples: Record<string, DirectSample[]> | null = null;
const lastSample = new Map<string, number>();
/** Hands the stored readings to the panel; set by lib/api.ts to avoid an import cycle */
let upload: ((serialNumber: string, batch: DirectSample[]) => Promise<unknown>) | null = null;

export function setBackfillUpload(send: typeof upload): void {
  upload = send;
}

async function loadSamples(): Promise<Record<string, DirectSample[]>> {
  if (samples) return samples;
  try {
    samples = JSON.parse((await AsyncStorage.getItem(KEY_SAMPLES)) ?? '{}') as Record<string, DirectSample[]>;
  } catch {
    samples = {};
  }
  return samples;
}

const countSamples = (all: Record<string, DirectSample[]>) => Object.values(all).reduce((sum, list) => sum + list.length, 0);

export const direct = {
  /** At launch: are the keys on this phone? */
  async restore(): Promise<void> {
    try {
      const text = await readItem(KEY_CREDENTIALS);
      credentials = text ? (JSON.parse(text) as DirectCredentials) : null;
    } catch {
      credentials = null;
    }
    const all = await loadSamples();
    useDirect.setState({ configured: credentials !== null, waiting: countSamples(all) });
  },

  async enable(keys: DirectCredentials): Promise<void> {
    credentials = keys;
    await writeItem(KEY_CREDENTIALS, JSON.stringify(keys));
    useDirect.setState({ configured: true, error: null });
    // The station list the direct mode starts from
    cachedAt = 0;
    void direct.panelAnswered(useDeviceStore.getState().devices);
  },

  /** Turned off, or signed out: the keys and everything kept for them leave the phone */
  async disable(): Promise<void> {
    credentials = null;
    samples = {};
    failures = 0;
    await writeItem(KEY_CREDENTIALS, null);
    await AsyncStorage.multiRemove([KEY_DEVICES, KEY_SAMPLES]).catch(() => undefined);
    useDirect.setState({ configured: false, active: false, error: null, waiting: 0 });
  },

  /** The panel answered with the station list: back to it, and the kept readings go up */
  async panelAnswered(devices: DeviceWithState[]): Promise<void> {
    failures = 0;
    if (useDirect.getState().active) useDirect.setState({ active: false, error: null });
    if (!credentials) return;
    if (devices.length > 0 && Date.now() - cachedAt > DEVICE_CACHE_MS) {
      cachedAt = Date.now();
      await AsyncStorage.setItem(KEY_DEVICES, JSON.stringify(devices)).catch(() => undefined);
    }
    await direct.flush();
  },

  /** A request to the panel got no answer (no network path, or the gateway says it is down) */
  panelFailed(): void {
    failures += 1;
    if (credentials && failures >= FAILURES_TO_SWITCH && !useDirect.getState().active) useDirect.setState({ active: true });
    if (useDirect.getState().active) void direct.poll();
  },

  /** One reading of every supported station from the EcoFlow cloud */
  async poll(force = false): Promise<void> {
    if (!credentials || polling || (!force && Date.now() - lastPoll < POLL_MS)) return;
    polling = true;
    lastPoll = Date.now();
    try {
      let known = useDeviceStore.getState().devices;
      if (known.length === 0) {
        try {
          known = JSON.parse((await AsyncStorage.getItem(KEY_DEVICES)) ?? '[]') as DeviceWithState[];
        } catch {
          known = [];
        }
      }
      if (known.length === 0) throw new Error('No stations are known on this phone yet');
      const cloud = new EcoflowCloud(credentials);
      const online = await cloud.online();
      const now = Date.now();
      const next = await Promise.all(known.map(async (device): Promise<DeviceWithState> => {
        const isOnline = online.get(device.serialNumber) ?? false;
        let state: DeviceState | null = null;
        if (isOnline && isDeltaPro(device.deviceType)) {
          state = quotaToState(device.serialNumber, await cloud.quota(device.serialNumber).catch(() => ({})), now);
        }
        if (state) await direct.record(device.serialNumber, state, now);
        // A station the phone cannot read keeps its last picture, marked by its own online flag
        return { ...device, online: isOnline, state: state ? { ...device.state, ...state } : isOnline ? device.state : null, lastSeen: isOnline ? new Date(now).toISOString() : device.lastSeen };
      }));
      // Still direct? The panel may have come back while the cloud was answering
      if (useDirect.getState().active) {
        const store = useDeviceStore.getState();
        if (store.devices.length === 0) store.setDevices(next);
        else store.mergeDevicesFromServer(next);
        useDirect.setState({ error: null });
      }
    } catch (failure) {
      useDirect.setState({ error: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      polling = false;
    }
  },

  async record(serialNumber: string, state: DeviceState, now: number): Promise<void> {
    if (now - (lastSample.get(serialNumber) ?? 0) < SAMPLE_MS) return;
    lastSample.set(serialNumber, now);
    const all = await loadSamples();
    const list = (all[serialNumber] ??= []);
    list.push({
      t: now,
      batterySoc: state.batterySoc, batteryWatts: Math.round(state.batteryWatts), acInputWatts: Math.round(state.acInputWatts),
      solarInputWatts: Math.round(state.solarInputWatts), acOutputWatts: Math.round(state.acOutputWatts), dcOutputWatts: Math.round(state.dcOutputWatts),
      temperature: state.temperature,
    });
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
    useDirect.setState({ waiting: countSamples(all) });
    await AsyncStorage.setItem(KEY_SAMPLES, JSON.stringify(all)).catch(() => undefined);
  },

  /** Hands the kept readings to the panel; what it refuses stays for the next try */
  async flush(): Promise<void> {
    const all = await loadSamples();
    if (!upload || countSamples(all) === 0) return;
    for (const serialNumber of Object.keys(all)) {
      const list = all[serialNumber];
      try {
        for (let from = 0; from < list.length; from += 1000) await upload(serialNumber, list.slice(from, from + 1000));
        delete all[serialNumber];
      } catch {
        // The panel went away again, or this account may not write: keep them
      }
    }
    useDirect.setState({ waiting: countSamples(all) });
    await AsyncStorage.setItem(KEY_SAMPLES, JSON.stringify(all)).catch(() => undefined);
  },

  /** A command while direct; null when the panel should get it as usual */
  command(serialNumber: string, action: DirectAction): Promise<void> | null {
    if (!credentials || !useDirect.getState().active) return null;
    const device = useDeviceStore.getState().devices.find((d) => d.serialNumber === serialNumber);
    if (!device || !isDeltaPro(device.deviceType)) return Promise.reject(new Error('This station can be controlled only through the panel'));
    return new EcoflowCloud(credentials).command(serialNumber, action).then(() => {
      // The next reading shows what the station made of it
      lastPoll = 0;
    });
  },
};
