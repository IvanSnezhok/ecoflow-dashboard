import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { space, tabular, tint, useTheme } from '@/theme';

import { Icon } from './Icon';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  /** Called once, when the finger lifts or the +/- taps pause */
  onCommit: (value: number) => void;
  disabled?: boolean;
  busy?: boolean;
}

const TAP_COMMIT_MS = 700;

/** A setting on a range: drag the track, or tap − / + for single steps. */
export function Slider({ label, value, min, max, step, format, onCommit, disabled, busy }: SliderProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = draft ?? value;
  const fraction = max > min ? (Math.max(min, Math.min(max, shown)) - min) / (max - min) : 0;
  const clamp = (next: number) => Math.max(min, Math.min(max, Math.round(next / step) * step));

  const fromTouch = (event: GestureResponderEvent) =>
    clamp(min + (Math.max(0, Math.min(width, event.nativeEvent.locationX)) / Math.max(1, width)) * (max - min));

  const commit = (next: number) => {
    setDraft(null);
    if (next !== value) onCommit(next);
  };

  const nudge = (direction: 1 | -1) => {
    const next = clamp(shown + direction * step);
    setDraft(next);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => commit(next), TAP_COMMIT_MS);
  };

  const stepButton = (direction: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${direction > 0 ? 'Increase' : 'Decrease'} ${label}`}
      disabled={disabled || (direction > 0 ? shown >= max : shown <= min)}
      onPress={() => nudge(direction)}
      hitSlop={6}
      style={({ pressed }) => [styles.step, { backgroundColor: theme.raised, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Icon name={direction > 0 ? 'plus' : 'minus'} size={16} color={theme.text} />
    </Pressable>
  );

  return (
    <View style={{ opacity: disabled ? 0.55 : 1 }}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.value, tabular, { color: busy || draft !== null ? theme.textMuted : theme.text }]}>{format(shown)}</Text>
      </View>
      <View style={styles.controls}>
        {stepButton(-1)}
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min, max, now: shown, text: format(shown) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => nudge(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => !disabled}
          onMoveShouldSetResponder={() => !disabled}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(event) => {
            if (tapTimer.current) clearTimeout(tapTimer.current);
            setDraft(fromTouch(event));
          }}
          onResponderMove={(event) => setDraft(fromTouch(event))}
          onResponderRelease={(event) => commit(fromTouch(event))}
          onResponderTerminate={() => setDraft(null)}
          style={styles.touch}>
          {/* Children take no touches, so locationX is always relative to the track */}
          <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.raised }]}>
            <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: theme.primary }]} />
          </View>
          <View pointerEvents="none" style={[styles.thumbWrap, { left: `${fraction * 100}%` }]}>
            <View style={[styles.thumb, { backgroundColor: '#FFFFFF', borderColor: theme.primary, shadowColor: '#000' }]} />
            {draft !== null ? <View style={[styles.halo, { backgroundColor: tint(theme.primary, 0.2) }]} /> : null}
          </View>
        </View>
        {stepButton(1)}
      </View>
      <View style={styles.range}>
        <Text style={[styles.rangeText, tabular, { color: theme.textFaint }]}>{format(min)}</Text>
        <Text style={[styles.rangeText, tabular, { color: theme.textFaint }]}>{format(max)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space.sm },
  label: { fontSize: 15 },
  value: { fontSize: 17, fontWeight: '700' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  touch: { flex: 1, height: 44, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  thumbWrap: { position: 'absolute', width: 0, height: 44, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  halo: { position: 'absolute', width: 40, height: 40, borderRadius: 20, zIndex: -1 },
  range: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 36 + space.md, marginTop: -2 },
  rangeText: { fontSize: 11 },
});
