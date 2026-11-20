import { dataSourceChip, powerStatus, remainingTime, type PowerStatus } from '@panel/lib/deviceStatus';
import type { DeviceWithState } from '@panel/types/device';

import type { Theme } from '@/theme';

export const STATUS_LABEL: Record<PowerStatus, string> = {
  charging: 'Charging',
  discharging: 'Discharging',
  bypass: 'Bypass',
  standby: 'Standby',
};

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
    label: !device.online ? 'Offline' : state ? STATUS_LABEL[status] : 'No data',
    color: !device.online || !state ? theme.textMuted : statusColor(theme, status),
    remaining: state && device.online ? remainingTime(state, status) : null,
    input,
    output,
    source: dataSourceChip(device),
  };
}
