import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { useDeviceStore } from '@panel/stores/deviceStore';

import { useLanguage } from '@/i18n';

import { direct, useDirect } from './direct';
import { useGrid } from './grid';
import { useSession } from './session';
import { refreshDevices } from './useDeviceSync';
import { syncOutageActivity, syncStationWidget } from './widgets';

const TASK = 'ecoflow-widget-refresh';

/**
 * Lets the phone wake the app now and then to redraw the widget while it is closed.
 * The system decides when (iOS: rarely more than a few times a day; Android: about
 * every 15 min), so the widget also shows the time of its reading.
 */
if (Platform.OS !== 'web') {
  TaskManager.defineTask(TASK, async () => {
    try {
      // Launched without the UI: the saved language and session are not loaded yet
      if (useSession.getState().phase === 'restoring') {
        await useLanguage.getState().restore();
        await useSession.getState().restore();
      }
      const session = useSession.getState();
      if (session.phase === 'signedIn') {
        await Promise.all([refreshDevices(), session.status?.powerReserve ? useGrid.getState().refresh() : null]);
        // Panel down: one failed request is enough here, the task will not get a second
        if (useDirect.getState().configured && useDeviceStore.getState().error) {
          direct.panelFailed();
          direct.panelFailed();
          await direct.poll(true);
        }
      }
      syncStationWidget();
      await syncOutageActivity();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerBackgroundRefresh(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  } catch {
    // Background refresh is off for the app: the widget updates when the app is opened
  }
}
