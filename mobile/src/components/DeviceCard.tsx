import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DeviceWithState } from '@panel/types/device';

import { useT } from '@/i18n';
import { deviceView } from '@/lib/deviceView';
import { watts } from '@/lib/format';
import { radius, socColor, space, tabular, useTheme } from '@/theme';

import { Icon } from './Icon';
import { SocBar } from './SocBar';
import { Chip } from './ui';

/** One station on the list: level, what it is doing, power in and out */
export function DeviceCard({ device }: { device: DeviceWithState }) {
  const theme = useTheme();
  const t = useT();
  const view = deviceView(device, theme);
  // The panel's lastSeen is the time of its own read, so an offline station shows no time
  const lastSeen = t('status.offlineNote');
  const state = device.state;
  const dimmed = !device.online || !state;

  return (
    <Pressable
        onPress={() => router.push({ pathname: '/device/[sn]', params: { sn: device.serialNumber } })}
        accessibilityRole="button"
        accessibilityLabel={`${device.name || device.serialNumber}, ${view.label}${state ? `, ${Math.round(state.batterySoc)} percent` : ''}`}
        style={({ pressed }) => [styles.card, { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}>
        <View style={styles.top}>
          <View style={styles.titles}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{device.name || device.serialNumber}</Text>
            <Text style={[styles.type, { color: theme.textMuted }]} numberOfLines={1}>{device.deviceType}</Text>
          </View>
          <Chip label={view.label} color={view.color} />
          <Icon name="chevron" size={18} color={theme.textFaint} />
        </View>

        {state ? (
          <>
            <View style={styles.middle}>
              <Text style={[styles.soc, tabular, { color: dimmed ? theme.textMuted : socColor(theme, state.batterySoc) }]}>
                {Math.round(state.batterySoc)}
                <Text style={styles.percent}>%</Text>
              </Text>
              <View style={styles.flows}>
                <Flow label={t('home.in')} value={view.input} color={theme.green} unknown={state.acInputReported === false && state.solarInputWatts === 0} />
                <Flow label={t('home.out')} value={view.output} color={theme.blue} />
              </View>
            </View>
            <SocBar soc={state.batterySoc} min={state.minDsgSoc} max={state.maxChgSoc} muted={dimmed} />
            <View style={styles.bottom}>
              <Text style={[styles.foot, tabular, { color: theme.textMuted }]}>
                {device.online ? view.remaining ?? t(view.status === 'bypass' ? 'status.gridFeeds' : 'status.idle') : lastSeen}
              </Text>
              {view.source ? <Text style={[styles.source, { color: theme.textFaint }]}>{view.source.label}</Text> : null}
            </View>
          </>
        ) : (
          <Text style={[styles.foot, { color: theme.textMuted, marginTop: space.md }]}>
            {device.quotaError
              ? t('home.refused', { error: device.quotaError })
              : device.online ? t('home.waiting') : lastSeen}
          </Text>
        )}
      </Pressable>
  );
}

function Flow({ label, value, color, unknown }: { label: string; value: number; color: string; unknown?: boolean }) {
  const theme = useTheme();
  const active = value > 0 && !unknown;
  return (
    <View style={styles.flow}>
      <Text style={[styles.flowLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.flowValue, tabular, { color: active ? color : theme.textMuted }]}>{unknown ? '—' : watts(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  titles: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: '600' },
  type: { fontSize: 12, marginTop: 2, letterSpacing: 0.4 },
  middle: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: space.md, marginBottom: space.md },
  soc: { fontSize: 52, fontWeight: '700', lineHeight: 56, letterSpacing: -1.5 },
  percent: { fontSize: 22, fontWeight: '600', letterSpacing: 0 },
  flows: { flexDirection: 'row', gap: space.xl, paddingBottom: 6 },
  flow: { alignItems: 'flex-end' },
  flowLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  flowValue: { fontSize: 18, fontWeight: '600', marginTop: 2 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.md },
  foot: { fontSize: 13, flexShrink: 1 },
  source: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
});
