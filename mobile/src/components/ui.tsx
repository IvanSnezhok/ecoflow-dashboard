import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { radius, space, tabular, tint, useTheme } from '@/theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}>
      {children}
    </View>
  );
}

/** Small caps heading above a card's content, with an optional value on the right */
export function CardTitle({ children, right }: { children: string; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.cardTitle}>
      <Text style={[styles.overline, { color: theme.textMuted }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Chip({ label, color, filled }: { label: string; color: string; filled?: boolean }) {
  return (
    <View style={[styles.chip, { backgroundColor: filled ? color : tint(color, 0.14) }]}>
      <Text style={[styles.chipText, { color: filled ? '#FFFFFF' : color }]}>{label}</Text>
    </View>
  );
}

/** A label with its value on the right; rows in a card are separated by hairlines */
export function Row({ label, value, valueColor, first }: { label: string; value: ReactNode; valueColor?: string; first?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
      <Text style={[styles.rowLabel, { color: theme.textMuted }]}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number'
        ? <Text style={[styles.rowValue, tabular, { color: valueColor ?? theme.text }]} numberOfLines={1}>{value}</Text>
        : value}
    </View>
  );
}

export function Button({
  label, onPress, busy, disabled, kind = 'primary', style,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const off = disabled || busy;
  const background = kind === 'primary' ? theme.primary : kind === 'danger' ? tint(theme.red, 0.14) : theme.raised;
  const color = kind === 'primary' ? theme.onPrimary : kind === 'danger' ? theme.red : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: background, opacity: off ? 0.5 : pressed ? 0.8 : 1 }, style]}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

/** A message in place of content: nothing to show, or why it could not load */
export function Notice({ title, detail, tone = 'muted', action }: { title: string; detail?: string | null; tone?: 'muted' | 'error'; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.notice}>
      <Text style={[styles.noticeTitle, { color: tone === 'error' ? theme.red : theme.text }]}>{title}</Text>
      {detail ? <Text style={[styles.noticeDetail, { color: theme.textMuted }]}>{detail}</Text> : null}
      {action}
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return <Text style={[{ color: theme.textMuted, fontSize: 13, lineHeight: 18 }, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  cardTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md, minHeight: 20 },
  overline: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: space.md },
  rowLabel: { fontSize: 15 },
  rowValue: { fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  button: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  buttonText: { fontSize: 16, fontWeight: '600' },
  notice: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.xl, gap: space.sm },
  noticeTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  noticeDetail: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
