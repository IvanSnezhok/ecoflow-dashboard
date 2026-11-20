import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useDeviceStore } from '@panel/stores/deviceStore';

import { DeviceCard } from '@/components/DeviceCard';
import { Screen } from '@/components/Screen';
import { Button, Notice } from '@/components/ui';
import { watts } from '@/lib/format';
import { useLiveStatus } from '@/lib/live';
import { refreshDevices } from '@/lib/useDeviceSync';
import { space, tabular, useTheme } from '@/theme';

export default function Stations() {
  const theme = useTheme();
  const devices = useDeviceStore((s) => s.devices);
  const loading = useDeviceStore((s) => s.isLoading);
  const error = useDeviceStore((s) => s.error);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    useDeviceStore.getState().setError(null);
    await refreshDevices();
    setRefreshing(false);
  };

  const online = devices.filter((device) => device.online && device.state);
  const input = online.reduce((sum, device) => sum + device.state!.acInputWatts + device.state!.solarInputWatts, 0);
  const output = online.reduce((sum, device) => sum + device.state!.acOutputWatts + device.state!.dcOutputWatts, 0);

  return (
    <Screen title="Stations" accessory={<LiveDot />} onRefresh={refresh} refreshing={refreshing}>
      {devices.length > 1 ? (
        <View style={styles.summary}>
          <Total label="Total in" value={input} color={input > 0 ? theme.green : theme.textMuted} />
          <Total label="Total out" value={output} color={output > 0 ? theme.blue : theme.textMuted} />
          <Total label="Online" value={`${devices.filter((device) => device.online).length}/${devices.length}`} color={theme.text} />
        </View>
      ) : null}

      {devices.map((device) => <DeviceCard key={device.serialNumber} device={device} />)}

      {devices.length === 0 && loading ? <ActivityIndicator style={{ marginTop: space.xxl }} color={theme.textMuted} /> : null}
      {devices.length === 0 && error ? (
        <Notice
          tone="error"
          title="Could not load your stations"
          detail={error}
          action={<Button label="Try again" kind="secondary" onPress={refresh} style={{ marginTop: space.md, alignSelf: 'stretch' }} />}
        />
      ) : null}
      {devices.length === 0 && !loading && !error ? (
        <Notice title="No stations yet" detail="Stations linked to the panel's EcoFlow account appear here. Pull down to check again." />
      ) : null}
    </Screen>
  );
}

/** Whether live updates are flowing from the panel */
function LiveDot() {
  const theme = useTheme();
  const { connected, mqtt } = useLiveStatus();
  const color = connected ? (mqtt ? theme.green : theme.yellow) : theme.textFaint;
  const label = connected ? (mqtt ? 'Live' : 'Every 10 s') : 'Reconnecting';
  return (
    <View accessibilityLabel={`Connection: ${label}`} style={styles.live}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.liveText, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function Total({ label, value, color }: { label: string; value: number | string; color: string }) {
  const theme = useTheme();
  return (
    <View style={styles.total}>
      <Text style={[styles.totalLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.totalValue, tabular, { color }]}>{typeof value === 'number' ? watts(value) : value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', paddingHorizontal: space.xs, paddingBottom: space.xs },
  total: { flex: 1 },
  totalLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  totalValue: { fontSize: 20, fontWeight: '700', marginTop: 2 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 13, fontWeight: '500' },
});
