import { addPushToStartTokenListener, after } from 'expo-widgets';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { powerStatus } from '@panel/lib/deviceStatus';
import { useDeviceStore } from '@panel/stores/deviceStore';
import type { DeviceWithState } from '@panel/types/device';
import type { ResilienceSettings, ResilienceStatus } from '@panel/types/resilience';

import { tNow } from '@/i18n';
import OutageActivity from '@/widgets/outage';
import StationWidget from '@/widgets/station';
import type { OutageActivityProps, StationWidgetProps } from '@/widgets/types';

import { api } from './api';
import { remaining, STATUS_KEY } from './deviceView';
import { clock, duration, watts } from './format';
import { useGrid } from './grid';
import { usePush } from './push';
import { useSession } from './session';
import { readItem, writeItem } from './storage';

const KEY_LIVE = 'ecoflow.liveActivity';
/** The widget is redrawn at most this often while the app is open */
const SYNC_MS = 20_000;
/** A Live Activity nobody refreshed for this long is shown as out of date */
const STALE_MS = 30 * 60_000;

/** The station the widget is about: the one the outage automation watches, else the first online one */
export function widgetDevice(devices: DeviceWithState[], settings: ResilienceSettings | null): DeviceWithState | null {
  return devices.find((d) => settings?.deviceId !== undefined && d.id === settings.deviceId)
    ?? devices.find((d) => d.online)
    ?? devices[0]
    ?? null;
}

export function emptyWidgetProps(): StationWidgetProps {
  return { name: '', soc: null, status: '', detail: '', grid: 'none', gridLabel: '', updated: '', empty: tNow('widget.empty'), url: 'ecoflowpanel:///' };
}

export function stationWidgetProps(device: DeviceWithState | null, status: ResilienceStatus | null, settings: ResilienceSettings | null, now: number): StationWidgetProps {
  if (!device) return emptyWidgetProps();
  const state = device.state;
  const power = state ? powerStatus(state) : 'standby';
  // The grid reading belongs to the automation's station only
  const grid = status?.grid && settings?.deviceId === device.id ? status.grid.state : null;
  const hours = status?.forecast?.hoursRemaining;
  let detail = '';
  if (device.online && state) {
    if (grid === 'off' && typeof hours === 'number' && hours > 0) detail = tNow('widget.reserve', { time: duration(Math.round(hours * 60)) });
    else detail = remaining(state, power) ?? (power === 'standby' ? '' : watts(power === 'charging' ? state.acInputWatts + state.solarInputWatts : state.acOutputWatts + state.dcOutputWatts));
  }
  return {
    name: device.name,
    soc: state && Number.isFinite(state.batterySoc) ? state.batterySoc : null,
    status: tNow(!device.online ? 'status.offline' : state ? STATUS_KEY[power] : 'status.noData'),
    detail,
    grid: grid ?? 'none',
    gridLabel: grid === 'on' ? tNow('grid.on') : grid === 'off' ? tNow('grid.off') : '',
    updated: clock(new Date(now)),
    empty: '',
    url: `ecoflowpanel:///device/${encodeURIComponent(device.serialNumber)}`,
  };
}

let lastWidget = '';

/** Redraws the home-screen widget from what the app holds now */
export function syncStationWidget(): void {
  if (!StationWidget) return;
  const signedIn = useSession.getState().phase === 'signedIn';
  const { status, settings } = useGrid.getState();
  const props = signedIn
    ? stationWidgetProps(widgetDevice(useDeviceStore.getState().devices, settings), status, settings, Date.now())
    : emptyWidgetProps();
  // Before the first answer there is nothing better than what the widget already shows
  if (signedIn && !props.name) return;
  const key = JSON.stringify(props);
  if (key === lastWidget) return;
  lastWidget = key;
  try {
    StationWidget.updateSnapshot(props);
  } catch {
    // An app build without the widget extension: nothing to draw on
  }
}

export async function liveActivityEnabled(): Promise<boolean> {
  return (await readItem(KEY_LIVE)) !== 'off';
}

export async function setLiveActivityEnabled(enabled: boolean): Promise<void> {
  await writeItem(KEY_LIVE, enabled ? null : 'off');
  if (enabled) void syncOutageActivity();
  else await endOutageActivities(null);
}

async function endOutageActivities(final: OutageActivityProps | null): Promise<void> {
  if (!OutageActivity) return;
  try {
    for (const activity of OutageActivity.getInstances()) {
      // "Power is back" stays on the lock screen for a few minutes, a switched-off one goes at once
      await activity.end(final ? after(new Date(Date.now() + 5 * 60_000)) : 'immediate', final ?? undefined);
    }
  } catch {
    // Live Activities are off in the phone settings, or the build has none
  }
}

// With notifications on and an Apple push key on the panel, the panel itself starts the
// activity when the power goes out and refreshes the level, with the app closed
const liveTokens: { start: string | null; activity: string | null; sent: string } = { start: null, activity: null, sent: '' };

function sendLiveTokens(): void {
  const { state, token } = usePush.getState();
  if (state !== 'on' || !token || (!liveTokens.start && !liveTokens.activity)) return;
  const key = `${token}|${liveTokens.start}|${liveTokens.activity}`;
  if (key === liveTokens.sent) return;
  liveTokens.sent = key;
  api.pushLiveActivity(token, { startToken: liveTokens.start ?? undefined, activityToken: liveTokens.activity ?? undefined }).catch(() => {
    liveTokens.sent = '';
  });
}

/** The token of the running activity, also of one the panel started */
async function readActivityToken(): Promise<void> {
  if (!OutageActivity) return;
  try {
    const [running] = OutageActivity.getInstances();
    const token = running ? await running.getPushToken() : null;
    if (token) liveTokens.activity = token;
    sendLiveTokens();
  } catch {
    // No push entitlement in this build
  }
}

let lastActivity = '';

/**
 * iPhone: while the power is out, the lock screen and the Dynamic Island show the battery
 * and a running outage timer. Started and refreshed while the app is open; the timer and
 * the "out of date" mark work without it.
 */
export async function syncOutageActivity(): Promise<void> {
  if (!OutageActivity || Platform.OS !== 'ios') return;
  const { status, settings } = useGrid.getState();
  const grid = status?.grid;
  if (useSession.getState().phase !== 'signedIn') {
    lastActivity = '';
    await endOutageActivities(null);
    return;
  }
  if (!grid || grid.state === 'unknown' || !(await liveActivityEnabled())) return;
  if (grid.state === 'off') void readActivityToken();

  const device = useDeviceStore.getState().devices.find((d) => d.id === settings?.deviceId) ?? null;
  const hours = status?.forecast?.hoursRemaining;
  const props: OutageActivityProps = {
    name: device?.name ?? '',
    soc: device?.state && Number.isFinite(device.state.batterySoc) ? device.state.batterySoc : null,
    title: tNow('grid.off'),
    since: grid.since ? new Date(grid.since).getTime() : Date.now(),
    reserve: typeof hours === 'number' && hours > 0 ? tNow('widget.reserve', { time: duration(Math.round(hours * 60)) }) : '',
    ended: grid.state === 'on' ? tNow('widget.powerBack') : '',
  };
  const key = JSON.stringify(props);
  if (key === lastActivity) return;
  lastActivity = key;

  if (grid.state === 'on') {
    await endOutageActivities(props);
    return;
  }
  try {
    const stale = new Date(Date.now() + STALE_MS);
    const running = OutageActivity.getInstances();
    if (running.length === 0) OutageActivity.start(props, 'ecoflowpanel:///power', stale);
    else for (const activity of running) await activity.update(props, stale);
  } catch {
    // Live Activities are off in the phone settings, or the build has none
  }
}

/** Keeps the widget and the outage Live Activity in step with the app's data */
export function useWidgetSync(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    const run = () => {
      timer = null;
      last = Date.now();
      syncStationWidget();
      void syncOutageActivity();
    };
    // Device updates arrive every second; the widget needs one redraw now and then
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(run, Math.max(500, SYNC_MS - (Date.now() - last)));
    };
    const stops = [useDeviceStore.subscribe(schedule), useGrid.subscribe(schedule), useSession.subscribe(schedule), usePush.subscribe(sendLiveTokens)];
    if (Platform.OS === 'ios' && OutageActivity) {
      try {
        const subscription = addPushToStartTokenListener((event) => {
          liveTokens.start = event.activityPushToStartToken;
          sendLiveTokens();
        });
        stops.push(() => subscription.remove());
      } catch {
        // A build without the widget extension
      }
    }
    schedule();
    return () => {
      stops.forEach((stop) => stop());
      if (timer) clearTimeout(timer);
    };
  }, []);
}
