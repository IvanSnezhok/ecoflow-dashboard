import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { clock, dayMonth } from '@/lib/format';
import { tabular, tint, useTheme } from '@/theme';

export interface ChartSeries {
  label: string;
  color: string;
  /** One value per time in `times`; null breaks the line */
  values: (number | null)[];
}

interface LineChartProps {
  /** Epoch ms of each sample, ascending */
  times: number[];
  series: ChartSeries[];
  /** The time window shown, even where it has no samples */
  from: number;
  to: number;
  /** Fixed value range (battery level); otherwise 0 to a round number above the peak */
  range?: [number, number];
  format: (value: number) => string;
  height?: number;
  /** Fill under the first series */
  area?: boolean;
}

const GUTTER = 44;
const TOP = 8;
const BOTTOM = 22;

/** A round number at or above the peak: 1, 2, 2.5 or 5 times a power of ten */
function niceMax(peak: number): number {
  if (peak <= 0) return 100;
  const power = Math.pow(10, Math.floor(Math.log10(peak)));
  const scaled = peak / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
}

function nearestIndex(times: number[], time: number): number {
  let low = 0;
  let high = times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] < time) low = middle;
    else high = middle;
  }
  return Math.abs(times[low] - time) <= Math.abs(times[high] - time) ? low : high;
}

/**
 * Time-series lines with a readout: the latest values, or the values under the finger
 * while it drags across the chart. A horizontal drag scrubs; a vertical one scrolls
 * the page as usual.
 */
export function LineChart({ times, series, from, to, range, format, height = 170, area }: LineChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);

  const plotWidth = Math.max(1, width - GUTTER);
  const plotHeight = height - TOP - BOTTOM;
  const span = Math.max(1, to - from);

  const [low, high] = useMemo<[number, number]>(() => {
    if (range) return range;
    let peak = 0;
    for (const line of series) for (const value of line.values) if (value !== null && value > peak) peak = value;
    return [0, niceMax(peak)];
  }, [range, series]);

  const x = (time: number) => GUTTER + ((time - from) / span) * plotWidth;
  const y = (value: number) => TOP + (1 - (Math.max(low, Math.min(high, value)) - low) / Math.max(1e-9, high - low)) * plotHeight;

  const paths = useMemo(() => {
    if (width === 0) return [];
    const scaleX = (time: number) => GUTTER + ((time - from) / span) * plotWidth;
    const scaleY = (value: number) => TOP + (1 - (Math.max(low, Math.min(high, value)) - low) / Math.max(1e-9, high - low)) * plotHeight;
    const base = TOP + plotHeight;
    return series.map((line) => {
      let stroke = '';
      let fill = '';
      let runStart: number | null = null;
      let lastX = 0;
      for (let i = 0; i < times.length; i++) {
        const value = line.values[i];
        if (value === null || value === undefined || times[i] < from || times[i] > to) {
          if (runStart !== null) fill += `L${lastX.toFixed(1)} ${base}L${runStart.toFixed(1)} ${base}Z`;
          runStart = null;
          continue;
        }
        const px = scaleX(times[i]);
        const point = `${px.toFixed(1)} ${scaleY(value).toFixed(1)}`;
        stroke += `${runStart === null ? 'M' : 'L'}${point}`;
        fill += `${runStart === null ? 'M' : 'L'}${point}`;
        if (runStart === null) runStart = px;
        lastX = px;
      }
      if (runStart !== null) fill += `L${lastX.toFixed(1)} ${base}L${runStart.toFixed(1)} ${base}Z`;
      return { stroke, fill };
    });
  }, [series, times, from, to, span, low, high, width, plotWidth, plotHeight]);

  // A horizontal drag scrubs; a vertical one is left to the page's scroll
  const touchStart = useRef({ x: 0, y: 0 });
  const track = (locationX: number) => {
    if (times.length === 0) return;
    const time = from + (Math.max(0, Math.min(plotWidth, locationX - GUTTER)) / plotWidth) * span;
    setScrub(nearestIndex(times, time));
  };

  const lastIndex = (line: ChartSeries) => {
    for (let i = line.values.length - 1; i >= 0; i--) if (line.values[i] !== null && line.values[i] !== undefined) return i;
    return -1;
  };
  const longSpan = span > 36 * 3600_000;
  const stamp = (time: number) => (longSpan ? `${dayMonth(new Date(time))} ${clock(new Date(time))}` : clock(new Date(time)));
  const ticks = [0, 1 / 3, 2 / 3, 1].map((part) => from + part * span);
  const grid = [low, (low + high) / 2, high];

  return (
    <View>
      <View style={styles.readout}>
        {series.map((line) => {
          const index = scrub ?? lastIndex(line);
          const value = index >= 0 ? line.values[index] : null;
          return (
            <View key={line.label} style={styles.legend}>
              <View style={[styles.swatch, { backgroundColor: line.color }]} />
              <Text style={[styles.legendLabel, { color: theme.textMuted }]}>{line.label}</Text>
              <Text style={[styles.legendValue, tabular, { color: theme.text }]}>{value === null || value === undefined ? '—' : format(value)}</Text>
            </View>
          );
        })}
        <Text style={[styles.stamp, tabular, { color: theme.textFaint }]}>{scrub !== null ? stamp(times[scrub]) : 'now'}</Text>
      </View>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{ height }}
        onTouchStart={(event) => {
          touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        }}
        onMoveShouldSetResponder={(event: GestureResponderEvent) => {
          const dx = Math.abs(event.nativeEvent.pageX - touchStart.current.x);
          const dy = Math.abs(event.nativeEvent.pageY - touchStart.current.y);
          return dx > 6 && dx > dy;
        }}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => track(event.nativeEvent.locationX)}
        onResponderMove={(event) => track(event.nativeEvent.locationX)}
        onResponderRelease={() => setScrub(null)}
        onResponderTerminate={() => setScrub(null)}>
        {width > 0 ? (
          <View pointerEvents="none">
            <Svg width={width} height={height}>
              {grid.map((value) => (
                <Line key={value} x1={GUTTER} x2={width} y1={y(value)} y2={y(value)} stroke={theme.border} strokeWidth={1} />
              ))}
              {paths.map((path, index) => (
                area && index === 0 && path.fill
                  ? <Path key={`fill-${series[index].label}`} d={path.fill} fill={tint(series[index].color, 0.14)} />
                  : null
              ))}
              {paths.map((path, index) => (
                path.stroke
                  ? <Path key={series[index].label} d={path.stroke} stroke={series[index].color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                  : null
              ))}
              {scrub !== null ? (
                <>
                  <Line x1={x(times[scrub])} x2={x(times[scrub])} y1={TOP} y2={TOP + plotHeight} stroke={theme.textMuted} strokeWidth={1} />
                  {series.map((line) => {
                    const value = line.values[scrub];
                    return value === null || value === undefined
                      ? null
                      : <Circle key={line.label} cx={x(times[scrub])} cy={y(value)} r={4} fill={line.color} stroke={theme.card} strokeWidth={2} />;
                  })}
                </>
              ) : null}
            </Svg>
            {grid.map((value) => (
              <Text key={value} style={[styles.axis, tabular, { color: theme.textFaint, top: y(value) - 7, width: GUTTER - 8 }]} numberOfLines={1}>
                {format(value)}
              </Text>
            ))}
            {ticks.map((time, index) => (
              <Text
                key={time}
                style={[
                  styles.tick, tabular,
                  { color: theme.textFaint, top: height - 16 },
                  index === ticks.length - 1 ? { right: 0, textAlign: 'right' } : { left: x(time) - (index === 0 ? 0 : 30), textAlign: index === 0 ? 'left' : 'center' },
                ]}>
                {longSpan ? dayMonth(new Date(time)) : clock(new Date(time))}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4, marginBottom: 8, minHeight: 20 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 3, borderRadius: 2 },
  legendLabel: { fontSize: 12 },
  legendValue: { fontSize: 13, fontWeight: '600' },
  stamp: { fontSize: 12, marginLeft: 'auto' },
  axis: { position: 'absolute', left: 0, fontSize: 10, textAlign: 'right' },
  tick: { position: 'absolute', fontSize: 10, width: 60 },
});
