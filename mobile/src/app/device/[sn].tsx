import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { summarizePower } from '@panel/components/charts/chartStats';
import { packFlowView } from '@panel/lib/deviceStatus';
import { useDeviceStore } from '@panel/stores/deviceStore';
import type { ChartPeriod, DeviceState, DeviceWithState, ExtraBatteryState, PackFlow } from '@panel/types/device';
import { collectDeviceIssues } from '@panel/utils/errorCodes';

import { Icon, type IconName } from '@/components/Icon';
import { LineChart } from '@/components/LineChart';
import { Screen } from '@/components/Screen';
import { Slider } from '@/components/Slider';
import { SocBar } from '@/components/SocBar';
import { Card, CardTitle, Chip, Muted, Notice, Row } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useT, type Key, type Translate } from '@/i18n';
import { STATUS_KEY, deviceView, statusColor } from '@/lib/deviceView';
import { ago, duration, energy, volts, watts } from '@/lib/format';
import { useAccess } from '@/lib/session';
import { refreshDevices } from '@/lib/useDeviceSync';
import { useHistory } from '@/lib/useHistory';
import { radius, socColor, space, tabular, tint, useTheme, type Theme } from '@/theme';

type CommandField = 'acOutEnabled' | 'maxChgSoc' | 'minDsgSoc' | 'acChargingPower';

export default function DeviceScreen() {
  const { sn } = useLocalSearchParams<{ sn: string }>();
  // Only this device: updates of the others do not re-render the page
  const device = useDeviceStore((s) => s.devices.find((d) => d.serialNumber === sn));
  const [refreshing, setRefreshing] = useState(false);
  const t = useT();

  const refresh = async () => {
    setRefreshing(true);
    await refreshDevices();
    setRefreshing(false);
  };

  return (
    <Screen underHeader onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: device?.name || sn || '' }} />
      {device ? <DeviceBody device={device} /> : <Notice title={t('device.notFound')} detail={sn} />}
    </Screen>
  );
}

function DeviceBody({ device }: { device: DeviceWithState }) {
  const theme = useTheme();
  const t = useT();
  const state = device.state;
  const issues = collectDeviceIssues(state?.errorCodes ?? device.lastKnownErrors ?? { bmsMasterErrCode: 0, invErrCode: 0, mpptFaultCode: 0, overloadState: 0, emsIsNormal: true })
    .filter((issue) => issue.info.severity !== 'info');

  return (
    <>
      <Hero device={device} />
      {issues.length > 0 ? (
        <Card style={{ borderColor: tint(theme.yellow, 0.5) }}>
          <CardTitle>{t(state?.errorCodes ? 'device.attention' : 'device.lastIssues')}</CardTitle>
          {issues.map((issue) => (
            <View key={issue.key} style={styles.issue}>
              <Icon name="alert" size={18} color={issue.info.severity === 'error' ? theme.red : theme.yellow} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>{issue.source}: {issue.info.title}</Text>
                <Muted>{issue.info.description}</Muted>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      {state ? <Flows state={state} /> : null}
      <Controls device={device} />
      {state ? <Packs state={state} /> : null}
      <History serialNumber={device.serialNumber} />
      <Card>
        <CardTitle>{t('device.about')}</CardTitle>
        <Row first label={t('device.model')} value={device.deviceType} />
        <Row label={t('device.serial')} value={device.serialNumber} />
        <Row label={t('device.dataFrom')} value={device.online || device.dataSource ? t(SOURCE_KEY[device.dataSource ?? 'cloud']) : '—'} />
        <Row label={t('device.lastUpdate')} value={ago(state?.timestamp ?? device.lastSeen) ?? '—'} />
      </Card>
    </>
  );
}

const SOURCE_KEY: Record<NonNullable<DeviceWithState['dataSource']>, Key> = {
  ble: 'device.src.ble',
  'cloud+ble': 'device.src.cloudble',
  mqtt: 'device.src.mqtt',
  app: 'device.src.app',
  cloud: 'device.src.cloud',
};

// ----- Level and status -----

function Hero({ device }: { device: DeviceWithState }) {
  const theme = useTheme();
  const t = useT();
  const view = deviceView(device, theme);
  const state = device.state;
  if (!state) {
    return (
      <Card>
        <Chip label={view.label} color={view.color} />
        <Muted style={{ marginTop: space.md }}>
          {device.quotaError
            ? t('home.refused', { error: device.quotaError })
            : device.online ? t('device.firstReading') : t('status.offlineNote')}
        </Muted>
      </Card>
    );
  }
  const dimmed = !device.online;
  const battery = state.batteryWatts;
  return (
    <Card>
      <View style={styles.heroTop}>
        <Chip label={view.label} color={view.color} />
        {state.temperature > 0 ? (
          <View style={styles.temp}>
            <Icon name="thermometer" size={14} color={theme.textMuted} />
            <Text style={[tabular, { color: theme.textMuted, fontSize: 13 }]}>{Math.round(state.temperature)} °C</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.heroMain}>
        <Text style={[styles.heroSoc, tabular, { color: dimmed ? theme.textMuted : socColor(theme, state.batterySoc) }]}>
          {Math.round(state.batterySoc)}
          <Text style={styles.heroPercent}>%</Text>
        </Text>
        <View style={styles.heroSide}>
          {device.online && battery !== 0 ? (
            <Text style={[styles.heroWatts, tabular, { color: view.color }]}>
              {battery > 0 ? '+' : '−'}{watts(Math.abs(battery))}
            </Text>
          ) : null}
          <Text style={[tabular, { color: theme.textMuted, fontSize: 14, textAlign: 'right' }]}>
            {device.online
              ? view.remaining ?? t(view.status === 'bypass' ? 'status.gridFeeds' : 'status.batteryIdle')
              : t('status.offlineNote')}
          </Text>
        </View>
      </View>
      <SocBar soc={state.batterySoc} min={state.minDsgSoc} max={state.maxChgSoc} height={10} muted={dimmed} />
      {state.minDsgSoc !== undefined || state.maxChgSoc !== undefined ? (
        <Text style={[tabular, { color: theme.textFaint, fontSize: 12, marginTop: space.sm }]}>
          {t('device.worksBetween', { min: state.minDsgSoc ?? 0, max: state.maxChgSoc ?? 100 })}
        </Text>
      ) : null}
    </Card>
  );
}

// ----- Power in and out -----

function Flows({ state }: { state: DeviceState }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={styles.flows}>
      <View style={styles.flowRow}>
        <FlowTile icon="plug" label={t('device.acIn')} value={state.acInputWatts} color={theme.green} unknown={state.acInputReported === false} />
        <FlowTile icon="sun" label={t('device.solar')} value={state.solarInputWatts} color={theme.yellow} />
      </View>
      <View style={styles.flowRow}>
        <FlowTile icon="power" label={t('device.acOut')} value={state.acOutputWatts} color={theme.blue} off={!state.acOutEnabled} />
        <FlowTile icon="dc" label={t('device.dcOut')} value={state.dcOutputWatts} color={theme.blue} />
      </View>
    </View>
  );
}

function FlowTile({ icon, label, value, color, unknown, off }: { icon: IconName; label: string; value: number; color: string; unknown?: boolean; off?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const active = value > 0 && !unknown;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${unknown ? '—' : watts(value)}`}
      style={[styles.tile, { backgroundColor: active ? tint(color, 0.1) : theme.card, borderColor: active ? tint(color, 0.45) : theme.border }]}>
      <View style={styles.tileTop}>
        <Icon name={icon} size={16} color={active ? color : theme.textMuted} />
        <Text style={[styles.tileLabel, { color: theme.textMuted }]}>{label}</Text>
        {off ? <Text style={[styles.tileOff, { color: theme.textFaint }]}>{t('device.off')}</Text> : null}
      </View>
      <Text style={[styles.tileValue, tabular, { color: active ? theme.text : theme.textMuted }]}>{unknown ? '—' : watts(value)}</Text>
    </View>
  );
}

// ----- Controls -----

function Controls({ device }: { device: DeviceWithState }) {
  const theme = useTheme();
  const t = useT();
  const { canControl } = useAccess();
  const [busy, setBusy] = useState<Partial<Record<CommandField, boolean>>>({});
  const state = device.state;
  if (!state) return null;

  const capabilities = device.capabilities;
  const showAc = capabilities?.acOutput !== false;
  const showPower = state.acChargingPower !== undefined || capabilities?.chargingPower !== undefined || !capabilities;
  const showLimits = state.maxChgSoc !== undefined || capabilities?.chargeLimits !== false;
  if (!showAc && !showPower && !showLimits) return null;

  const offline = !device.online;
  const locked = !canControl || offline;

  /**
   * Shows the new value at once and holds it against older panel values until the
   * station confirms it; on failure the previous value comes back.
   */
  const run = async <F extends CommandField>(field: F, value: DeviceState[F], send: (sn: string) => Promise<unknown>, what: string) => {
    if (busy[field]) return;
    const serial = device.serialNumber;
    const previous = state[field];
    const store = useDeviceStore.getState();
    setBusy((current) => ({ ...current, [field]: true }));
    store.setPendingCommand(serial, field, value);
    store.updateDeviceState(serial, { [field]: value });
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
    try {
      await send(serial);
    } catch (error) {
      const after = useDeviceStore.getState();
      after.removePendingCommand(serial, field);
      after.updateDeviceState(serial, { [field]: previous });
      Alert.alert(t('device.cmdFailed'), `${what}: ${errorMessage(error)}`);
    } finally {
      setBusy((current) => ({ ...current, [field]: false }));
    }
  };

  const power = capabilities?.chargingPower ?? { min: 200, max: 2900, step: 100 };
  const percent = (value: number) => `${value}%`;

  return (
    <Card>
      <CardTitle right={locked ? <Text style={[styles.note, { color: theme.textFaint }]}>{t(offline ? 'status.offline' : 'device.viewOnly')}</Text> : undefined}>
        {t('device.controls')}
      </CardTitle>
      <View style={{ gap: space.lg }}>
        {showAc ? (
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '500' }}>{t('device.acOutput')}</Text>
              <Muted>{t(busy.acOutEnabled ? 'device.switching' : state.acOutEnabled ? 'device.socketsOn' : 'device.socketsOff')}</Muted>
            </View>
            <Switch
              accessibilityLabel={t('device.acOutput')}
              value={state.acOutEnabled}
              disabled={locked || !!busy.acOutEnabled}
              onValueChange={(enabled) => void run('acOutEnabled', enabled, (serial) => api.setAcOutput(serial, enabled), t('device.acOutput'))}
              trackColor={{ true: theme.primary, false: theme.raised }}
              thumbColor="#FFFFFF"
            />
          </View>
        ) : null}
        {showPower ? (
          <View>
            <Slider
              label={t('device.chargePower')}
              value={state.acChargingPower ?? 1800}
              min={power.min}
              max={power.max}
              step={power.step}
              format={(value) => `${value} W`}
              busy={busy.acChargingPower}
              disabled={locked || (capabilities !== undefined && capabilities.chargingPower === undefined) || !!state.fastChargingEnabled || !!busy.acChargingPower}
              onCommit={(value) => void run('acChargingPower', value, (serial) => api.setChargingPower(serial, value), t('device.chargePower'))}
            />
            {state.fastChargingEnabled ? <Muted style={{ color: theme.yellow, marginTop: space.xs }}>{t('device.fastCharge')}</Muted> : null}
          </View>
        ) : null}
        {showLimits ? (
          <>
            <Slider
              label={t('device.chargeTo')}
              value={state.maxChgSoc ?? 100}
              min={50}
              max={100}
              step={1}
              format={percent}
              busy={busy.maxChgSoc}
              disabled={locked || capabilities?.chargeLimits === false || !!busy.maxChgSoc}
              onCommit={(value) => void run('maxChgSoc', value, (serial) => api.setMaxChargeSoc(serial, value), t('device.chargeTo'))}
            />
            <Slider
              label={t('device.dischargeTo')}
              value={state.minDsgSoc ?? 0}
              min={0}
              max={30}
              step={1}
              format={percent}
              busy={busy.minDsgSoc}
              disabled={locked || capabilities?.chargeLimits === false || !!busy.minDsgSoc}
              onCommit={(value) => void run('minDsgSoc', value, (serial) => api.setMinDischargeSoc(serial, value), t('device.dischargeTo'))}
            />
          </>
        ) : null}
      </View>
    </Card>
  );
}

// ----- Battery packs -----

function Packs({ state }: { state: DeviceState }) {
  const t = useT();
  const extras = [state.extraBattery1, state.extraBattery2].filter((pack): pack is ExtraBatteryState => !!pack?.connected);
  const main = state.mainBattery;
  // A station without extra packs or pack health has nothing to add to the level above
  if (extras.length === 0 && !main && !state.mainBatteryFlow) return null;
  return (
    <Card>
      <CardTitle>{t('device.packs')}</CardTitle>
      <View style={{ gap: space.lg }}>
        <Pack
          label={t('device.main')}
          soc={state.batterySoc}
          flow={state.mainBatteryFlow}
          facts={[
            main?.vol ? volts(main.vol) : null,
            main?.cycles !== undefined ? t('device.cycles', { n: main.cycles }) : null,
            main?.soh ? t('device.health', { n: main.soh }) : null,
          ]}
        />
        {extras.map((pack) => (
          <Pack
            key={pack === state.extraBattery1 ? 'extra1' : 'extra2'}
            label={t('device.extra', { n: pack === state.extraBattery1 ? 1 : 2 })}
            soc={pack.soc}
            flow={pack.flow}
            held={pack.held ? pack.lastUpdated : undefined}
            facts={[
              pack.temp ? `${Math.round(pack.temp)} °C` : null,
              pack.vol ? volts(pack.vol) : null,
              pack.cycles ? t('device.cycles', { n: pack.cycles }) : null,
              pack.soh ? t('device.health', { n: pack.soh }) : null,
            ]}
          />
        ))}
      </View>
    </Card>
  );
}

function Pack({ label, soc, flow, facts, held }: { label: string; soc: number; flow?: PackFlow; facts: (string | null)[]; held?: string }) {
  const theme = useTheme();
  const t = useT();
  const view = flow ? packFlowView(flow) : null;
  const details = facts.filter(Boolean).join('  ·  ');
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.packTop}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        {view ? (
          <Text style={[tabular, { color: statusColor(theme, view.status), fontSize: 13, flex: 1 }]} numberOfLines={1}>
            {view.status === 'standby' ? t('status.idle') : `${t(STATUS_KEY[view.status])} ${watts(view.watts)}`}
            {flow?.remainMinutes ? `, ${t(view.status === 'charging' ? 'time.toFull' : 'time.left', { time: duration(flow.remainMinutes) })}` : ''}
          </Text>
        ) : <View style={{ flex: 1 }} />}
        <Text style={[tabular, { color: socColor(theme, soc), fontSize: 17, fontWeight: '700' }]}>{Math.round(soc)}%</Text>
      </View>
      <SocBar soc={soc} height={6} muted={!!held} />
      {details || held ? (
        <Text style={[tabular, { color: theme.textMuted, fontSize: 12 }]}>
          {held ? `${t('device.lastReported', { ago: ago(held) ?? '' })}${details ? '  ·  ' : ''}` : ''}{details}
        </Text>
      ) : null}
    </View>
  );
}

// ----- History -----

const PERIODS: { key: ChartPeriod; unit: Key; n: number }[] = [
  { key: '1h', unit: 'time.h', n: 1 },
  { key: '24h', unit: 'time.h', n: 24 },
  { key: '7d', unit: 'time.dShort', n: 7 },
  { key: '30d', unit: 'time.dShort', n: 30 },
];

function History({ serialNumber }: { serialNumber: string }) {
  const theme = useTheme();
  const t = useT();
  const [period, setPeriod] = useState<ChartPeriod>('24h');
  const { history, error, loading } = useHistory(serialNumber, period);

  const points = history?.points ?? [];
  const times = points.map((point) => new Date(point.timestamp).getTime());
  const sum = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  const consumed = summarizePower(points, ['acOutputWatts', 'dcOutputWatts']).energyWh;
  const charged = summarizePower(points, ['acInputWatts', 'solarInputWatts']).energyWh;
  const stale = history !== null && history.period !== period;

  return (
    <Card>
      <CardTitle>{t('device.history')}</CardTitle>
      <Segments theme={theme} t={t} value={period} onChange={setPeriod} />
      {history && points.length > 0 ? (
        <View style={{ gap: space.xl, marginTop: space.lg, opacity: stale ? 0.5 : 1 }}>
          <LineChart
            times={times}
            from={history.from}
            to={history.to}
            range={[0, 100]}
            area
            format={(value) => `${Math.round(value)}%`}
            series={[{ label: t('device.battery'), color: theme.green, values: points.map((point) => point.batterySoc) }]}
          />
          <View>
            <LineChart
              times={times}
              from={history.from}
              to={history.to}
              format={watts}
              series={[
                { label: t('home.in'), color: theme.green, values: points.map((point) => sum(point.acInputWatts, point.solarInputWatts)) },
                { label: t('home.out'), color: theme.blue, values: points.map((point) => sum(point.acOutputWatts, point.dcOutputWatts)) },
              ]}
            />
            <View style={styles.energy}>
              <Energy label={t('device.charged')} value={energy(charged)} color={theme.green} />
              <Energy label={t('device.used')} value={energy(consumed)} color={theme.blue} />
            </View>
          </View>
        </View>
      ) : (
        <Notice
          tone={error ? 'error' : 'muted'}
          title={t(error ? 'device.historyFailed' : loading ? 'common.loading' : 'device.historyEmpty')}
          detail={error ?? (loading ? null : t('device.historyNote'))}
        />
      )}
    </Card>
  );
}

function Energy({ label, value, color }: { label: string; value: string; color: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.note, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[tabular, { color, fontSize: 18, fontWeight: '700', marginTop: 2 }]}>{value}</Text>
    </View>
  );
}

function Segments({ theme, t, value, onChange }: { theme: Theme; t: Translate; value: ChartPeriod; onChange: (period: ChartPeriod) => void }) {
  return (
    <View accessibilityRole="tablist" style={[styles.segments, { backgroundColor: theme.raised }]}>
      {PERIODS.map((period) => {
        const selected = period.key === value;
        return (
          <Pressable
            key={period.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(period.key)}
            style={[styles.segment, selected && { backgroundColor: theme.card, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 }]}>
            <Text style={[tabular, { color: selected ? theme.text : theme.textMuted, fontSize: 14, fontWeight: selected ? '600' : '500' }]}>{t(period.unit, { n: period.n })}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  temp: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroMain: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: space.sm, marginBottom: space.md },
  heroSoc: { fontSize: 76, fontWeight: '700', lineHeight: 82, letterSpacing: -3 },
  heroPercent: { fontSize: 30, fontWeight: '600', letterSpacing: 0 },
  heroSide: { alignItems: 'flex-end', paddingBottom: 12, flexShrink: 1, gap: 2 },
  heroWatts: { fontSize: 24, fontWeight: '700' },
  flows: { gap: space.md },
  flowRow: { flexDirection: 'row', gap: space.md },
  tile: { flex: 1, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: space.sm },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', flex: 1 },
  tileOff: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  tileValue: { fontSize: 24, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  note: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  packTop: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  issue: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingVertical: space.xs },
  segments: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  energy: { flexDirection: 'row', marginTop: space.md },
});
