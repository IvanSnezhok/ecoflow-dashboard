import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import type { AcAction, GridState, LoadSource, OutageEvent, PowerDay, ResilienceStatus } from '@panel/types/resilience';

import { Screen } from '@/components/Screen';
import { Card, CardTitle, Chip, Muted, Notice, Row } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { ago, clock, duration } from '@/lib/format';
import { space, tabular, useTheme, type Theme } from '@/theme';

const REFRESH_MS = 30_000;
const DAYS = 7;

const RISK: Record<ResilienceStatus['risk'], { label: string; note: string; color: (theme: Theme) => string }> = {
  none: { label: 'Stable', note: 'No outage expected in the coming hours', color: (t) => t.green },
  watch: { label: 'Watch', note: 'An outage window is possible', color: (t) => t.blue },
  imminent: { label: 'Preparing', note: 'An outage is coming up', color: (t) => t.yellow },
  active: { label: 'Outage', note: 'A scheduled outage window is active', color: (t) => t.red },
  emergency: { label: 'Emergency', note: 'YASNO reports emergency outages', color: (t) => t.red },
  stale: { label: 'Data out of date', note: 'Automation is paused until the schedule updates', color: (t) => t.textMuted },
};

const GRID: Record<GridState, { title: string; note: string; color: (theme: Theme) => string }> = {
  on: { title: 'Grid power is on', note: 'The station sees voltage on its AC input', color: (t) => t.green },
  off: { title: 'Power is out', note: 'The station sees no grid on its AC input', color: (t) => t.red },
  unknown: { title: 'Grid state unknown', note: 'The station has not reported its input voltage yet', color: (t) => t.textMuted },
};

const AC_ACTION: Record<AcAction, string> = {
  none: 'No change',
  on: 'Switched AC on',
  off: 'Switched AC off',
  'waiting-load': 'Waiting for the load to drop',
  'blocked-low-soc': 'Blocked: battery too low',
  failed: 'Command failed',
};

const LOAD_SOURCE: Record<LoadSource, string> = {
  history: 'from your usage history',
  mixed: 'from usage history and the backup profile',
  profile: 'from the backup profile (little history yet)',
  current: 'from the current load',
};

const EVENT_TYPE: Record<OutageEvent['type'], string> = { definite: 'Scheduled', possible: 'Possible', emergency: 'Emergency' };

interface GridData {
  status: ResilienceStatus;
  days: PowerDay[];
  /** When it was read: durations on screen count from here */
  at: number;
}

async function readGrid(): Promise<GridData> {
  const [status, days] = await Promise.all([api.resilienceStatus(), api.resilienceTimeline(DAYS)]);
  return { status, days, at: Date.now() };
}

export default function Power() {
  const theme = useTheme();
  const [data, setData] = useState<GridData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (AppState.currentState === 'background') return;
      readGrid()
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError(null);
        })
        .catch((failure) => {
          if (!cancelled) setError(errorMessage(failure));
        });
    };
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setData(await readGrid());
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setRefreshing(false);
  };

  const status = data?.status;
  const days = data?.days ?? [];

  if (!data || !status) {
    return (
      <Screen title="Grid" onRefresh={refresh} refreshing={refreshing}>
        <Notice tone={error ? 'error' : 'muted'} title={error ? 'Could not load the grid status' : 'Loading…'} detail={error} />
      </Screen>
    );
  }

  const gridOnly = status.mode === 'grid';
  const grid = status.grid;
  const state = grid?.state ?? 'unknown';
  const risk = RISK[status.risk];
  const forecast = status.forecast;
  const event = status.currentEvent ?? status.nextEvent;
  const sinceMinutes = grid?.since ? (data.at - new Date(grid.since).getTime()) / 60_000 : null;

  return (
    <Screen title="Grid" onRefresh={refresh} refreshing={refreshing}>
      {error ? <Muted style={{ color: theme.yellow }}>Showing the last loaded data: {error}</Muted> : null}

      <Card style={{ borderColor: GRID[state].color(theme), borderWidth: 1 }}>
        <View style={styles.gridTop}>
          <View style={[styles.gridDot, { backgroundColor: GRID[state].color(theme) }]} />
          <Text style={[styles.gridTitle, { color: theme.text }]}>{GRID[state].title}</Text>
        </View>
        <Muted style={{ marginTop: space.xs }}>
          {grid?.since && sinceMinutes !== null
            ? `Since ${clock(new Date(grid.since))}, for ${duration(sinceMinutes)}`
            : GRID[state].note}
        </Muted>
        {state === 'off' ? (
          <View style={styles.chips}>
            {grid?.unplanned && !gridOnly ? <Chip label="Not in the schedule" color={theme.red} /> : null}
            {grid?.outageWh ? <Chip label={`${Math.round(grid.outageWh)} Wh from the battery`} color={theme.blue} /> : null}
          </View>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Battery reserve</CardTitle>
        {forecast ? (
          <>
            <Text style={[styles.big, tabular, { color: theme.text }]}>
              {forecast.hoursRemaining === null ? 'Over 14 days' : duration(forecast.hoursRemaining * 60)}
            </Text>
            <Muted>
              to the reserve level, {LOAD_SOURCE[forecast.loadSource]}
              {forecast.depletionAt ? `. Runs out around ${clock(new Date(forecast.depletionAt))}` : ''}
            </Muted>
            <View style={{ marginTop: space.md }}>
              <Row first label="Usable energy" value={`${Math.round(forecast.usableWh)} Wh`} />
              <Row label="Average load" value={`${Math.round(forecast.averageLoadWatts)} W`} />
              <Row label="Battery packs" value={forecast.batteryCount} />
            </View>
          </>
        ) : <Muted>No forecast yet: the panel needs a reading from the station.</Muted>}
      </Card>

      {!gridOnly ? (
        <Card>
          <CardTitle right={<Chip label={risk.label} color={risk.color(theme)} />}>Outage schedule</CardTitle>
          <Muted>{risk.note}</Muted>
          {event ? (
            <View style={{ marginTop: space.md }}>
              <Row first label={status.currentEvent ? 'Now' : 'Next'} value={`${clock(new Date(event.start))} – ${clock(new Date(event.end))}`} />
              <Row label="Kind" value={EVENT_TYPE[event.type]} />
            </View>
          ) : null}
          {status.scheduleUpdatedAt ? <Muted style={{ marginTop: space.sm }}>Schedule updated {ago(status.scheduleUpdatedAt)}</Muted> : null}
          {status.error ? <Muted style={{ marginTop: space.xs, color: theme.yellow }}>{status.error}</Muted> : null}
        </Card>
      ) : null}

      {status.acAction && status.acAction !== 'none' ? (
        <Card>
          <CardTitle>Automation</CardTitle>
          <Row first label="Last decision" value={AC_ACTION[status.acAction]} valueColor={status.acAction === 'failed' || status.acAction === 'blocked-low-soc' ? theme.red : theme.text} />
        </Card>
      ) : null}

      {days.length > 0 ? (
        <Card>
          <CardTitle>{`Last ${days.filter((day) => !day.future).length} days`}</CardTitle>
          <View style={{ gap: space.md }}>
            {[...days].filter((day) => !day.future).reverse().map((day) => <DayRow key={day.day} day={day} theme={theme} />)}
          </View>
          <View style={styles.legend}>
            <Key color={theme.green} label="Grid" theme={theme} />
            <Key color={theme.red} label="Outage" theme={theme} />
            <Key color={theme.raised} label="No data" theme={theme} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function DayRow({ day, theme }: { day: PowerDay; theme: Theme }) {
  const start = new Date(day.start).getTime();
  const end = new Date(day.end).getTime();
  const span = Math.max(1, end - start);
  const color = (state: GridState) => (state === 'on' ? theme.green : state === 'off' ? theme.red : theme.raised);
  const date = new Date(day.start);
  const label = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  const off = day.stats.offMinutes;
  return (
    <View accessible accessibilityLabel={`${label}: ${off > 0 ? `${duration(off)} without power` : 'no outages'}`}>
      <View style={styles.dayTop}>
        <Text style={[tabular, { color: theme.text, fontSize: 14, fontWeight: '500' }]}>{label}</Text>
        <Text style={[tabular, { color: off > 0 ? theme.red : theme.textMuted, fontSize: 13 }]}>
          {off > 0 ? `${duration(off)} without power` : day.stats.onMinutes > 0 ? 'No outages' : 'No data'}
        </Text>
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

function Key({ color, label, theme }: { color: string; label: string; theme: Theme }) {
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
  dayTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  bar: { height: 12, borderRadius: 6, overflow: 'hidden' },
  segment: { position: 'absolute', top: 0, bottom: 0 },
  legend: { flexDirection: 'row', gap: space.lg, marginTop: space.lg },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keySwatch: { width: 10, height: 10, borderRadius: 3 },
});
