import type { ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space, useTheme } from '@/theme';

interface ScreenProps {
  /** Large title at the top of a tab; screens under a navigation header have none */
  title?: string;
  /** Shown to the right of the title */
  accessory?: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** The screen sits under the stack's own header, which already clears the status bar */
  underHeader?: boolean;
}

/** A scrolling page: safe areas, pull to refresh, and a column that stays readable on tablets */
export function Screen({ title, accessory, children, onRefresh, refreshing = false, underHeader }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // iOS insets the scroll view itself (status bar, header, tab bar); elsewhere it is padding
  // The web build (used to check the app in a browser) floats its tab bar over the top
  const top = Platform.OS === 'ios' || underHeader ? space.sm : insets.top + space.md + (Platform.OS === 'web' ? 56 : 0);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: space.xxl + (Platform.OS === 'ios' ? 0 : insets.bottom) }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textMuted} /> : undefined}>
      <View style={styles.column}>
        {title ? (
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
            {accessory}
          </View>
        ) : null}
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, alignItems: 'center' },
  column: { width: '100%', maxWidth: 640, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs, minHeight: 44 },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
});
