import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { tabular, tint, useTheme } from '@/theme';

export interface BarGroup {
  /** Under the bars (shown for some groups when there are many) */
  label: string;
  /** In the readout when the group is selected */
  title: string;
  values: number[];
}

interface BarChartProps {
  groups: BarGroup[];
  /** One per value in a group */
  series: { label: string; color: string }[];
  format: (value: number) => string;
  height?: number;
}

const GUTTER = 58;
const TOP = 6;
const BOTTOM = 20;

function niceMax(peak: number): number {
  if (peak <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(peak)));
  const scaled = peak / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
}

/** Bars per day or month. Touch a group to read its values; the latest is shown otherwise. */
export function BarChart({ groups, series, format, height = 160 }: BarChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  const selected = picked !== null && picked < groups.length ? picked : groups.length - 1;
  const max = niceMax(Math.max(0, ...groups.flatMap((group) => group.values)));
  const plotWidth = Math.max(1, width - GUTTER);
  const plotHeight = height - TOP - BOTTOM;
  const slot = plotWidth / Math.max(1, groups.length);
  const barWidth = Math.max(1.5, Math.min(18, (slot * 0.72) / series.length));
  const y = (value: number) => TOP + (1 - Math.min(1, value / max)) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(groups.length / 6));
  const pick = (locationX: number) => {
    if (groups.length > 0) setPicked(Math.max(0, Math.min(groups.length - 1, Math.floor((locationX - GUTTER) / slot))));
  };

  return (
    <View>
      <View style={styles.readout}>
        {series.map((item, index) => (
          <View key={item.label} style={styles.legend}>
            <View style={[styles.swatch, { backgroundColor: item.color }]} />
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>{item.label}</Text>
            <Text style={[tabular, { color: theme.text, fontSize: 13, fontWeight: '600' }]}>
              {groups[selected] ? format(groups[selected].values[index] ?? 0) : '—'}
            </Text>
          </View>
        ))}
        <Text style={[tabular, { color: theme.textFaint, fontSize: 12, marginLeft: 'auto' }]}>{groups[selected]?.title ?? ''}</Text>
      </View>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(event) => pick(event.nativeEvent.locationX)}
        onResponderMove={(event) => pick(event.nativeEvent.locationX)}
        style={{ height }}>
        {width > 0 ? (
          <View pointerEvents="none">
            <Svg width={width} height={height}>
              {[0, max / 2, max].map((value) => (
                <Line key={value} x1={GUTTER} x2={width} y1={y(value)} y2={y(value)} stroke={theme.border} strokeWidth={1} />
              ))}
              {groups.map((group, index) => {
                const left = GUTTER + index * slot + (slot - barWidth * series.length) / 2;
                return group.values.map((value, part) => (
                  <Rect
                    key={`${group.title}-${series[part]?.label}`}
                    x={left + part * barWidth}
                    y={y(value)}
                    width={Math.max(1, barWidth - 1)}
                    height={Math.max(0, TOP + plotHeight - y(value))}
                    rx={Math.min(2, barWidth / 3)}
                    fill={index === selected ? series[part]?.color : tint(series[part]?.color ?? '#888888', 0.55)}
                  />
                ));
              })}
            </Svg>
            {[0, max / 2, max].map((value) => (
              <Text key={value} style={[styles.axis, tabular, { color: theme.textFaint, top: y(value) - 7, width: GUTTER - 8 }]} numberOfLines={1}>
                {format(value)}
              </Text>
            ))}
            {groups.map((group, index) => (
              (groups.length - 1 - index) % labelEvery === 0 ? (
                <Text key={group.title} style={[styles.tick, tabular, { color: theme.textFaint, top: height - 16, left: GUTTER + index * slot + slot / 2 - 25 }]} numberOfLines={1}>
                  {group.label}
                </Text>
              ) : null
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
  swatch: { width: 10, height: 10, borderRadius: 3 },
  axis: { position: 'absolute', left: 0, fontSize: 10, textAlign: 'right' },
  tick: { position: 'absolute', fontSize: 10, width: 50, textAlign: 'center' },
});
