import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { prepareChartData } from '@panel/lib/chartData';
import { useDeviceStore } from '@panel/stores/deviceStore';
import type { DeviceWithState } from '@panel/types/device';
import type { PowerDay } from '@panel/types/resilience';

import { BarChart } from '@/components/BarChart';
import { Screen } from '@/components/Screen';
import { Card, CardTitle, Muted, Notice } from '@/components/ui';
import { localeTag, useLanguage, useT, type Translate } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { energyBuckets, stepLimitMs, type EnergyBucket } from '@/lib/energyStats';
import { dayMonth, duration, energy } from '@/lib/format';
import { useAccess } from '@/lib/session';
import { space, tabular, tint, useTheme, type Theme } from '@/theme';

type Scale = 'day' | 'month';
const DAY_MS = 86_400_000;

export default function Stats() {
  const theme = useTheme();
  const t = useT();
  const devices = useDeviceStore((s) => s.devices);
  const { powerReserve } = useAccess();
  const [chosen, setChosen] = useState<string | null>(null);
  const device = devices.find((item) => item.serialNumber === chosen) ?? devices[0];

  return (
    <Screen title={t('stats.title')}>
      {devices.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {devices.map((item) => {
            const selected = item.serialNumber === device?.serialNumber;
            return (
              <Pressable
                key={item.serialNumber}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setChosen(item.serialNumber)}
                style={[styles.pick, { backgroundColor: selected ? tint(theme.primary, 0.16) : theme.card, borderColor: selected ? theme.primary : theme.border }]}>
                <Text style={{ color: selected ? theme.primary : theme.textMuted, fontSize: 14, fontWeight: '600' }}>{item.name || item.serialNumber}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {powerReserve ? <Outages theme={theme} t={t} /> : null}
      {device ? <Energy key={device.serialNumber} serialNumber={device.serialNumber} theme={theme} t={t} /> : null}
      {device ? <Health device={device} theme={theme} t={t} /> : <Notice title={t('stats.empty')} />}
    </Screen>
  );
}

// ----- Time without grid power -----

function Outages({ theme, t }: { theme: Theme; t: Translate }) {
  const [days, setDays] = useState<PowerDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.resilienceTimeline(31)
      .then((list) => {
        if (!cancelled) setDays(list.filter((day) => !day.future).sort((a, b) => a.start.localeCompare(b.start)));
      })
      .catch((failure) => {
        if (!cancelled) setError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!days) return error ? <Card><CardTitle>{t('stats.onBattery')}</CardTitle><Muted>{error}</Muted></Card> : null;
  const total = (pick: (day: PowerDay) => number) => days.reduce((sum, day) => sum + pick(day), 0);
  // Whole hours once the total is long: "118 h" reads better than "118 h 30 min"
  const long = (minutes: number) => (minutes >= 600 ? t('time.h', { n: Math.round(minutes / 60) }) : duration(minutes));
  return (
    <Card>
      <CardTitle>{`${t('stats.onBattery')} · ${t('time.dShort', { n: days.length })}`}</CardTitle>
      <View style={styles.figures}>
        <Figure label={t('stats.outages')} value={long(total((day) => day.stats.offMinutes))} color={theme.red} theme={theme} />
        <Figure label={t('stats.onBatteryTime')} value={long(total((day) => day.stats.ecoflowMinutes))} color={theme.text} theme={theme} />
        <Figure label={t('stats.fromBattery')} value={energy(total((day) => day.stats.ecoflowWh))} color={theme.blue} theme={theme} />
      </View>
      <BarChart
        series={[{ label: t('stats.perDay'), color: theme.red }]}
        format={(value) => (value >= 10 ? `${Math.round(value)}` : value.toFixed(1))}
        groups={days.map((day) => ({ label: dayMonth(new Date(day.start)), title: dayMonth(new Date(day.start)), values: [day.stats.offMinutes / 60] }))}
      />
    </Card>
  );
}

// ----- Energy per day and per month -----

function Energy({ serialNumber, theme, t }: { serialNumber: string; theme: Theme; t: Translate }) {
  const language = useLanguage((s) => s.language);
  const [scale, setScale] = useState<Scale>('day');
  const [loaded, setLoaded] = useState<{ scale: Scale; buckets: EnergyBucket[]; at: number } | null>(null);
  const [failure, setFailure] = useState<{ scale: Scale; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    // 30 whole days, or 12 whole months, up to now
    const from = scale === 'day'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
      : new Date(now.getFullYear(), now.getMonth() - 11, 1);
    api.historyRange(serialNumber, from.toISOString(), now.toISOString())
      .then((answer) => {
        if (cancelled) return;
        const points = prepareChartData(answer.dataPoints, answer.aggregation);
        setLoaded({ scale, buckets: energyBuckets(points, stepLimitMs(answer.aggregation), scale), at: now.getTime() });
        setFailure(null);
      })
      .catch((error) => {
        if (!cancelled) setFailure({ scale, message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [serialNumber, scale]);

  const error = failure?.scale === scale ? failure.message : null;
  const buckets = loaded?.buckets ?? [];
  const stale = loaded !== null && loaded.scale !== scale;
  const charged = buckets.reduce((sum, bucket) => sum + bucket.chargedWh, 0);
  const used = buckets.reduce((sum, bucket) => sum + bucket.usedWh, 0);
  const spanDays = buckets.length > 0 ? Math.max(1, Math.round(((loaded?.at ?? 0) - buckets[0].start) / DAY_MS)) : 1;
  const label = (start: number) => (loaded?.scale === 'month'
    ? new Date(start).toLocaleDateString(localeTag(language), { month: 'short' })
    : dayMonth(new Date(start)));
  const title = (start: number) => (loaded?.scale === 'month'
    ? new Date(start).toLocaleDateString(localeTag(language), { month: 'long', year: 'numeric' })
    : new Date(start).toLocaleDateString(localeTag(language), { weekday: 'short', day: 'numeric', month: 'short' }));

  return (
    <Card>
      <CardTitle>{t('stats.energy')}</CardTitle>
      <View accessibilityRole="tablist" style={[styles.segments, { backgroundColor: theme.raised }]}>
        {(['day', 'month'] as const).map((option) => {
          const selected = option === scale;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setScale(option)}
              style={[styles.segment, selected && { backgroundColor: theme.card }]}>
              <Text style={{ color: selected ? theme.text : theme.textMuted, fontSize: 14, fontWeight: selected ? '600' : '500' }}>
                {t(option === 'day' ? 'stats.energyDaily' : 'stats.energyMonthly')}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {buckets.length > 0 ? (
        <View style={{ opacity: stale ? 0.5 : 1, marginTop: space.lg }}>
          <View style={styles.figures}>
            <Figure label={t('stats.charged')} value={energy(charged)} color={theme.green} theme={theme} />
            <Figure label={t('stats.used')} value={energy(used)} color={theme.blue} theme={theme} />
            <Figure label={t('stats.avgDay')} value={energy(used / spanDays)} color={theme.text} theme={theme} />
          </View>
          <BarChart
            series={[{ label: t('stats.charged'), color: theme.green }, { label: t('stats.used'), color: theme.blue }]}
            format={energy}
            groups={buckets.map((bucket) => ({ label: label(bucket.start), title: title(bucket.start), values: [bucket.chargedWh, bucket.usedWh] }))}
          />
        </View>
      ) : (
        <Notice tone={error ? 'error' : 'muted'} title={t(error ? 'stats.failed' : loaded && !stale ? 'stats.empty' : 'common.loading')} detail={error} />
      )}
    </Card>
  );
}

// ----- Battery wear -----

function Health({ device, theme, t }: { device: DeviceWithState; theme: Theme; t: Translate }) {
  const state = device.state;
  const packs = [
    { label: t('device.main'), cycles: state?.mainBattery?.cycles, soh: state?.mainBattery?.soh },
    ...[state?.extraBattery1, state?.extraBattery2].map((pack, index) => (
      pack?.connected ? { label: t('device.extra', { n: index + 1 }), cycles: pack.cycles || undefined, soh: pack.soh || undefined } : null
    )).filter((pack) => pack !== null),
  ].filter((pack) => pack.cycles !== undefined || pack.soh !== undefined);

  return (
    <Card>
      <CardTitle>{t('stats.health')}</CardTitle>
      {packs.length === 0 ? <Muted>{t('stats.noHealth')}</Muted> : (
        <View style={{ gap: space.lg }}>
          {packs.map((pack) => {
            const soh = pack.soh ?? null;
            const color = soh === null ? theme.textMuted : soh >= 90 ? theme.green : soh >= 80 ? theme.yellow : theme.red;
            return (
              <View key={pack.label} style={{ gap: space.sm }}>
                <View style={styles.packTop}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{pack.label}</Text>
                  {pack.cycles !== undefined ? <Text style={[tabular, { color: theme.textMuted, fontSize: 13 }]}>{t('device.cycles', { n: pack.cycles })}</Text> : null}
                  <Text style={[tabular, { color, fontSize: 17, fontWeight: '700', minWidth: 52, textAlign: 'right' }]}>{soh === null ? '—' : `${soh}%`}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: theme.raised }]}>
                  <View style={{ width: `${Math.max(0, Math.min(100, soh ?? 0))}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
                </View>
              </View>
            );
          })}
          <Muted>{t('stats.healthNote')}</Muted>
        </View>
      )}
    </Card>
  );
}

function Figure({ label, value, color, theme }: { label: string; value: string; color: string; theme: Theme }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.textMuted, fontSize: 12 }} numberOfLines={2}>{label}</Text>
      <Text style={[tabular, { color, fontSize: 18, fontWeight: '700', marginTop: 2 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pick: { paddingHorizontal: space.lg, minHeight: 40, borderRadius: 20, borderWidth: 1, justifyContent: 'center' },
  figures: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
  segments: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  packTop: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
});
