import { StyleSheet, View } from 'react-native';

import { socColor, useTheme } from '@/theme';

/**
 * Battery level as a bar. The charge limits show as notches: the station stops
 * discharging at `min` and charging at `max`.
 */
export function SocBar({ soc, min, max, height = 8, muted }: { soc: number; min?: number; max?: number; height?: number; muted?: boolean }) {
  const theme = useTheme();
  const level = Math.max(0, Math.min(100, soc));
  const notch = (at: number | undefined) =>
    at !== undefined && at > 0 && at < 100
      ? <View style={[styles.notch, { left: `${at}%`, backgroundColor: theme.card, height }]} />
      : null;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(level) }}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: theme.raised }]}>
      <View style={{ width: `${level}%`, height, borderRadius: height / 2, backgroundColor: muted ? theme.textFaint : socColor(theme, level) }} />
      {notch(min)}
      {notch(max)}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', width: '100%' },
  notch: { position: 'absolute', top: 0, width: 2, marginLeft: -1 },
});
