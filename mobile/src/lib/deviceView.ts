import { dataSourceChip, powerStatus, type PowerStatus } from '@panel/lib/deviceStatus';
import type { DeviceState, DeviceWithState } from '@panel/types/device';

import { tNow, type Key } from '@/i18n';

import { duration } from './format';

import type { Theme } from '@/theme';

export const STATUS_KEY: Record<PowerStatus, Key> = {
  charging: 'status.charging',
  discharging: 'status.discharging',
  bypass: 'status.bypass',
  standby: 'status.standby',
};

/** "1 h 20 min to full" while charging, "5 h left" while discharging, else null */
export function remaining(state: DeviceState, status: PowerStatus): string | null {
  if (status === 'charging' && state.chgRemainTime && state.chgRemainTime > 0) return tNow('time.toFull', { time: duration(state.chgRemainTime) });
  if (status === 'discharging' && state.dsgRemainTime && state.dsgRemainTime > 0) return tNow('time.left', { time: duration(state.dsgRemainTime) });
  return null;
}

export const statusColor = (theme: Theme, status: PowerStatus) =>
  status === 'charging' ? theme.green : status === 'discharging' ? theme.blue : status === 'bypass' ? theme.purple : theme.textMuted;

/** What a card and the device page say about a station at a glance */
export function deviceView(device: DeviceWithState, theme: Theme) {
  const state = device.state;
  const status = state ? powerStatus(state) : 'standby';
  const input = state ? state.acInputWatts + state.solarInputWatts : 0;
  const output = state ? state.acOutputWatts + state.dcOutputWatts : 0;
  return {
    status,
    label: tNow(!device.online ? 'status.offline' : state ? STATUS_KEY[status] : 'status.noData'),
    color: !device.online || !state ? theme.textMuted : statusColor(theme, status),
    remaining: state && device.online ? remaining(state, status) : null,
    input,
    output,
    source: dataSourceChip(device),
  };
}
