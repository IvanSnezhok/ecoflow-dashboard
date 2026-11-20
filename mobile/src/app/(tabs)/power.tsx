import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, Text, View } from 'react-native';

import { useDeviceStore } from '@panel/stores/deviceStore';
import type { AutomationRule, RuleAction } from '@panel/types/automation';
import type { GridState, OutageEvent, PowerDay, ResilienceStatus } from '@panel/types/resilience';

import { GRID_COPY } from '@/components/GridNow';
import { Screen } from '@/components/Screen';
import { Button, Card, CardTitle, Chip, Muted, Notice, Row } from '@/components/ui';
import { localeTag, useLanguage, useT, type Key, type Translate } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { ago, clock, duration, energy } from '@/lib/format';
import { useGrid } from '@/lib/grid';
import { useAccess } from '@/lib/session';
import { space, tabular, tint, useTheme, type Theme } from '@/theme';

const RISK_COLOR: Record<ResilienceStatus['risk'], (theme: Theme) => string> = {
  none: (t) => t.green,
  watch: (t) => t.blue,
  imminent: (t) => t.yellow,
  active: (t) => t.red,
  emergency: (t) => t.red,
  stale: (t) => t.textMuted,
};

export default function Power() {
  const theme = useTheme();
  const t = useT();
  const { status, settings, days, at, error } = useGrid();
  const { role } = useAccess();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await useGrid.getState().refresh();
    setRefreshing(false);
  };

  if (!status) {
    return (
      <Screen title={t('tab.grid')} onRefresh={refresh} refreshing={refreshing}>
        <Notice tone={error ? 'error' : 'muted'} title={t(error ? 'grid.loadFailed' : 'common.loading')} detail={error} />
      </Screen>
    );
  }

  const gridOnly = status.mode === 'grid';
  const grid = status.grid;
  const state: GridState = grid?.state ?? 'unknown';
  const color = GRID_COPY[state].color(theme);
  const forecast = status.forecast;
  const past = days.filter((day) => !day.future);

  return (
    <Screen title={t('tab.grid')} onRefresh={refresh} refreshing={refreshing}>
      {error ? <Muted style={{ color: theme.yellow }}>{t('common.staleData', { error })}</Muted> : null}

      <Card style={{ borderColor: state === 'unknown' ? theme.border : tint(color, 0.6), borderWidth: 1, backgroundColor: state === 'off' ? tint(theme.red, 0.1) : theme.card }}>
        <View style={styles.gridTop}>
          <View style={[styles.gridDot, { backgroundColor: color }]} />
          <Text style={[styles.gridTitle, { color: theme.text }]}>{t(GRID_COPY[state].title)}</Text>
        </View>
        <Muted style={{ marginTop: space.xs }}>
          {grid?.since
            ? t('grid.since', { time: clock(new Date(grid.since)), duration: duration((at - new Date(grid.since).getTime()) / 60_000) })
            : t(GRID_COPY[state].note)}
        </Muted>
        {state === 'off' && grid?.outageWh ? <Muted style={{ marginTop: 2 }}>{t('grid.fromBattery', { wh: energy(grid.outageWh) })}</Muted> : null}
        {state === 'off' && grid?.unplanned && !gridOnly ? <View style={styles.chips}><Chip label={t('grid.unplanned')} color={theme.red} /></View> : null}
      </Card>

      <Card>
        <CardTitle>{t('grid.reserve')}</CardTitle>
        {forecast ? (
          <>
            <Text style={[styles.big, tabular, { color: theme.text }]}>
              {forecast.hoursRemaining === null ? t('home.reserveLong') : duration(forecast.hoursRemaining * 60)}
            </Text>
            <Muted>
              {t('grid.reserveNote', { source: t(`grid.source.${forecast.loadSource}` as Key) })}
              {forecast.depletionAt ? `. ${t('grid.runsOut', { time: clock(new Date(forecast.depletionAt)) })}` : ''}
            </Muted>
            <View style={{ marginTop: space.md }}>
              <Row first label={t('grid.usable')} value={energy(forecast.usableWh)} />
              <Row label={t('grid.avgLoad')} value={`${Math.round(forecast.averageLoadWatts)} W`} />
              <Row label={t('grid.packs')} value={forecast.batteryCount} />
            </View>
          </>
        ) : <Muted>{t('grid.noForecast')}</Muted>}
      </Card>

      <Card>
        <CardTitle right={gridOnly ? undefined : <Chip label={t(`grid.risk.${status.risk}` as Key)} color={RISK_COLOR[status.risk](theme)} />}>
          {settings?.outageGroup && !gridOnly ? `${t('grid.schedule')} · ${t('grid.queue', { group: settings.outageGroup })}` : t('grid.schedule')}
        </CardTitle>
        {gridOnly
          ? <Muted>{t('grid.gridOnly')}</Muted>
          : <Schedule events={status.events ?? []} now={at} theme={theme} t={t} />}
        {!gridOnly && status.scheduleUpdatedAt ? <Muted style={{ marginTop: space.md }}>{t('grid.scheduleUpdated', { ago: ago(status.scheduleUpdatedAt) ?? '' })}</Muted> : null}
        {status.error ? <Muted style={{ marginTop: space.xs, color: theme.yellow }}>{status.error}</Muted> : null}
      </Card>

      <Scenarios status={status} owner={role === 'owner'} />

      {past.length > 0 ? (
        <Card>
          <CardTitle>{t('grid.lastDays', { n: past.length })}</CardTitle>
          <View style={{ gap: space.md }}>
            {[...past].sort((a, b) => b.start.localeCompare(a.start)).map((day) => <DayRow key={day.day} day={day} theme={theme} t={t} />)}
          </View>
          <View style={styles.legend}>
            <Legend color={theme.green} label={t('grid.legendOn')} theme={theme} />
            <Legend color={theme.red} label={t('grid.legendOff')} theme={theme} />
            <Legend color={theme.raised} label={t('grid.legendNone')} theme={theme} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

// ----- Outage schedule of the user's group -----

function Schedule({ events, now, theme, t }: { events: OutageEvent[]; now: number; theme: Theme; t: Translate }) {
  const language = useLanguage((s) => s.language);
  const upcoming = events
    .filter((event) => new Date(event.end).getTime() > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  if (upcoming.length === 0) return <Muted>{t('grid.noEvents')}</Muted>;

  const dayKey = (time: number) => new Date(time).toDateString();
  const today = dayKey(now);
  const tomorrow = dayKey(now + 86_400_000);
  const groups = new Map<string, OutageEvent[]>();
  for (const event of upcoming) {
    const key = dayKey(new Date(event.start).getTime());
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const typeColor = (type: OutageEvent['type']) => (type === 'definite' ? theme.red : type === 'emergency' ? theme.red : theme.yellow);

  return (
    <View style={{ gap: space.md }}>
      {[...groups.entries()].map(([key, list]) => (
        <View key={key}>
          <Text style={[styles.day, { color: theme.textMuted }]}>
            {key === today ? t('grid.today') : key === tomorrow ? t('grid.tomorrow')
              : new Date(list[0].start).toLocaleDateString(localeTag(language), { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
          {list.map((event) => {
            const start = new Date(event.start).getTime();
            const end = new Date(event.end).getTime();
            const active = start <= now;
            return (
              <View key={event.start} style={[styles.event, { borderLeftColor: typeColor(event.type), backgroundColor: active ? tint(theme.red, 0.1) : theme.raised }]}>
                <Text style={[styles.eventTime, tabular, { color: theme.text }]}>{clock(new Date(start))} – {clock(new Date(end))}</Text>
                <Text style={[tabular, { color: theme.textMuted, fontSize: 13, flex: 1 }]}>{duration((end - start) / 60_000)}</Text>
                <Chip label={t(`grid.type.${event.type}` as Key)} color={typeColor(event.type)} />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ----- Scenarios: the outage automation and the owner's rules -----

function actionText(action: RuleAction, t: Translate): string {
  switch (action.type) {
    case 'setAcOutput': return t(action.params.enabled ? 'auto.act.acOn' : 'auto.act.acOff');
    case 'setDcOutput': return t(action.params.enabled ? 'auto.act.dcOn' : 'auto.act.dcOff');
    case 'setChargingPower': return t('auto.act.power', { w: action.params.watts });
    case 'setMaxChargeSoc': return t('auto.act.max', { n: action.params.maxSoc });
    case 'setMinDischargeSoc': return t('auto.act.min', { n: action.params.minSoc });
    default: return t('auto.act.slack');
  }
}

function Scenarios({ status, owner }: { status: ResilienceStatus; owner: boolean }) {
  const theme = useTheme();
  const t = useT();
  const settings = useGrid((s) => s.settings);
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    api.rules().then((list) => {
      if (!cancelled) setRules(list);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner]);

  const toggle = async (rule: AutomationRule, enabled: boolean) => {
    setRules((list) => list?.map((item) => (item.id === rule.id ? { ...item, enabled } : item)) ?? null);
    try {
      await api.toggleRule(rule.id, enabled);
    } catch (failure) {
      setRules((list) => list?.map((item) => (item.id === rule.id ? { ...item, enabled: !enabled } : item)) ?? null);
      Alert.alert(rule.name, errorMessage(failure));
    }
  };

  const run = async (rule: AutomationRule) => {
    setBusy(rule.id);
    setDone(null);
    try {
      // A rule for every station runs on the first one that is online
      const devices = useDeviceStore.getState().devices;
      const target = rule.deviceId ? undefined : (devices.find((device) => device.online) ?? devices[0])?.serialNumber;
      await api.runRule(rule.id, target);
      setDone(rule.id);
    } catch (failure) {
      Alert.alert(t('auto.runFailed'), errorMessage(failure));
    }
    setBusy(null);
  };

  const confirmRun = (rule: AutomationRule) => {
    if (Platform.OS === 'web') {
      void run(rule);
      return;
    }
    Alert.alert(
      t('auto.runTitle', { name: rule.name }),
      t('auto.runDetail', { actions: rule.actions.map((action) => actionText(action, t)).join(', ') }),
      [{ text: t('common.cancel'), style: 'cancel' }, { text: t('auto.run'), onPress: () => void run(rule) }],
    );
  };

  const outageOn = settings?.enabled && settings.autoAc;
  const failed = status.acAction === 'failed' || status.acAction === 'blocked-low-soc';
  if (!settings && !owner) return null;

  return (
    <Card>
      <CardTitle>{t('auto.title')}</CardTitle>
      {settings ? (
        <>
          <Row first label={t('auto.outage')} value={outageOn ? '●' : t('auto.outageOff')} valueColor={outageOn ? theme.green : theme.textMuted} />
          {outageOn ? <Muted>{t('auto.outageOn')}</Muted> : null}
          {status.acAction && status.acAction !== 'none'
            ? <Row label={t('auto.last')} value={t(`auto.action.${status.acAction}` as Key)} valueColor={failed ? theme.red : theme.text} />
            : null}
        </>
      ) : null}
      {owner ? (
        <View style={{ marginTop: settings ? space.lg : 0, gap: space.md }}>
          <Text style={[styles.day, { color: theme.textMuted, marginBottom: 0 }]}>{t('auto.rules')}</Text>
          {rules === null ? <Muted>{t('common.loading')}</Muted> : null}
          {rules?.length === 0 ? <Muted>{t('auto.noRules')}</Muted> : null}
          {rules?.map((rule) => (
            <View key={rule.id} style={[styles.rule, { backgroundColor: theme.raised }]}>
              <View style={styles.ruleTop}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{rule.name}</Text>
                  <Muted>{rule.actions.map((action) => actionText(action, t)).join(', ')}</Muted>
                </View>
                <Switch
                  accessibilityLabel={rule.name}
                  value={rule.enabled}
                  onValueChange={(enabled) => void toggle(rule, enabled)}
                  trackColor={{ true: theme.primary, false: theme.border }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.ruleBottom}>
                <Muted style={{ flex: 1 }}>
                  {done === rule.id
                    ? t('auto.ran')
                    : rule.lastTriggeredAt
                      ? t('auto.triggered', { n: rule.executionCount ?? 1, ago: ago(rule.lastTriggeredAt) ?? '' })
                      : t('auto.never')}
                </Muted>
                <Button label={t('auto.run')} kind="secondary" busy={busy === rule.id} onPress={() => confirmRun(rule)} style={[styles.runButton, { backgroundColor: theme.card }]} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

// ----- The last days -----

function DayRow({ day, theme, t }: { day: PowerDay; theme: Theme; t: Translate }) {
  const language = useLanguage((s) => s.language);
  const start = new Date(day.start).getTime();
  const end = new Date(day.end).getTime();
  const span = Math.max(1, end - start);
  const color = (state: GridState) => (state === 'on' ? theme.green : state === 'off' ? theme.red : theme.raised);
  const label = new Date(day.start).toLocaleDateString(localeTag(language), { weekday: 'short', day: 'numeric', month: 'short' });
  const off = day.stats.offMinutes;
  const summary = off > 0 ? t('grid.without', { duration: duration(off) }) : t(day.stats.onMinutes > 0 ? 'grid.noOutagesDay' : 'grid.legendNone');
  return (
    <View accessible accessibilityLabel={`${label}: ${summary}`}>
      <View style={styles.dayTop}>
        <Text style={[tabular, { color: theme.text, fontSize: 14, fontWeight: '500' }]}>{label}</Text>
        <Text style={[tabular, { color: off > 0 ? theme.red : theme.textMuted, fontSize: 13 }]}>{summary}</Text>
      </View>
      <View style={[styles.bar, { backgroundColor: theme.raised }]}>
        {day.segments.map((segment) => {
          const from = Math.max(start, new Date(segment.start).getTime());
          const to = Math.min(end, new Date(segment.end).getTime());
          if (to <= from) return null;
          return (
            <View
              key={segment.start}
              style={[styles.segment, { left: `${((from - start) / span) * 100}%`, width: `${((to - from) / span) * 100}%`, backgroundColor: color(segment.state) }]}
            />
          );
        })}
      </View>
    </View>
  );
}

function Legend({ color, label, theme }: { color: string; label: string; theme: Theme }) {
  return (
    <View style={styles.key}>
      <View style={[styles.keySwatch, { backgroundColor: color }]} />
      <Text style={{ color: theme.textMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gridTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  gridDot: { width: 12, height: 12, borderRadius: 6 },
  gridTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  big: { fontSize: 34, fontWeight: '700', letterSpacing: -0.8, marginBottom: 2 },
  day: { fontSize: 13, fontWeight: '600', marginBottom: space.sm },
  event: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderLeftWidth: 3, borderRadius: 8, paddingHorizontal: space.md, minHeight: 44, marginBottom: 6 },
  eventTime: { fontSize: 16, fontWeight: '600' },
  rule: { borderRadius: 12, padding: space.md, gap: space.sm },
  ruleTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  ruleBottom: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  runButton: { minHeight: 44, paddingHorizontal: space.lg },
  dayTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  bar: { height: 12, borderRadius: 6, overflow: 'hidden' },
  segment: { position: 'absolute', top: 0, bottom: 0 },
  legend: { flexDirection: 'row', gap: space.lg, marginTop: space.lg },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keySwatch: { width: 10, height: 10, borderRadius: 3 },
});
