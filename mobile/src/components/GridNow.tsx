import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GridState, OutageEvent } from '@panel/types/resilience';

import { useT, type Key } from '@/i18n';
import { clock, duration } from '@/lib/format';
import { useGrid } from '@/lib/grid';
import { radius, space, tabular, tint, useTheme, type Theme } from '@/theme';

import { Icon } from './Icon';

export const GRID_COPY: Record<GridState, { title: Key; note: Key; color: (theme: Theme) => string }> = {
  on: { title: 'grid.on', note: 'grid.onNote', color: (t) => t.green },
  off: { title: 'grid.off', note: 'grid.offNote', color: (t) => t.red },
  unknown: { title: 'grid.unknown', note: 'grid.unknownNote', color: (t) => t.textMuted },
};

/** The outage that is on now, else the next one that has not ended */
export function upcomingEvent(events: OutageEvent[], now: number): { event: OutageEvent; active: boolean } | null {
  const next = events
    .filter((event) => new Date(event.end).getTime() > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
  return next ? { event: next, active: new Date(next.start).getTime() <= now } : null;
}

/**
 * The answer to "what is going on right now": is there power, how long the battery
 * lasts, when the next outage is. Opens the Power tab.
 */
export function GridNow() {
  const theme = useTheme();
  const t = useT();
  const status = useGrid((s) => s.status);
  const at = useGrid((s) => s.at);
  if (!status) return null;

  const state = status.grid?.state ?? 'unknown';
  const copy = GRID_COPY[state];
  const color = copy.color(theme);
  const since = status.grid?.since;
  const forecast = status.forecast;
  const upcoming = status.mode === 'grid' ? null : upcomingEvent(status.events ?? [], at);
  const hours = forecast?.hoursRemaining;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.navigate('/power')}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: state === 'off' ? tint(theme.red, 0.1) : theme.card, borderColor: state === 'unknown' ? theme.border : tint(color, 0.6), opacity: pressed ? 0.85 : 1 },
      ]}>
      <View style={styles.top}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.title, { color: theme.text }]}>{t(copy.title)}</Text>
        <Icon name="chevron" size={18} color={theme.textFaint} />
      </View>
      <Text style={[styles.note, tabular, { color: theme.textMuted }]}>
        {since
          ? t('grid.since', { time: clock(new Date(since)), duration: duration((at - new Date(since).getTime()) / 60_000) })
          : t(copy.note)}
      </Text>
      {forecast || upcoming || status.mode !== 'grid' ? (
        <View style={[styles.facts, { borderTopColor: theme.border }]}>
          {forecast ? (
            <Fact label={t('home.reserve')} value={hours === null || hours === undefined ? t('home.reserveLong') : duration(hours * 60)} theme={theme} />
          ) : null}
          {status.mode !== 'grid' ? (
            <Fact
              label={t(upcoming?.active ? 'home.outageNow' : 'home.nextOutage')}
              value={upcoming
                ? upcoming.active ? clock(new Date(upcoming.event.end)) : `${clock(new Date(upcoming.event.start))} – ${clock(new Date(upcoming.event.end))}`
                : t('home.noOutages')}
              color={upcoming?.active ? theme.red : undefined}
              theme={theme}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function Fact({ label, value, color, theme }: { label: string; value: string; color?: string; theme: Theme }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.factLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.factValue, tabular, { color: color ?? theme.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, flex: 1 },
  note: { fontSize: 14, marginTop: 4 },
  facts: { flexDirection: 'row', gap: space.lg, marginTop: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  factLabel: { fontSize: 12 },
  factValue: { fontSize: 19, fontWeight: '700', marginTop: 2 },
});
