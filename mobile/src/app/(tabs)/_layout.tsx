import { NativeTabs } from 'expo-router/native-tabs';

import { useT } from '@/i18n';
import { useAccess } from '@/lib/session';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const theme = useTheme();
  const { powerReserve } = useAccess();
  const t = useT();
  return (
    <NativeTabs backgroundColor={theme.card} tintColor={theme.primary} indicatorColor={theme.raised}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('tab.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      {/* The panel opens Power reserve only to users who may see its device */}
      <NativeTabs.Trigger name="power" hidden={!powerReserve}>
        <NativeTabs.Trigger.Label>{t('tab.grid')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bolt', selected: 'bolt.fill' }} md="bolt" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="stats">
        <NativeTabs.Trigger.Label>{t('tab.stats')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} md="bar_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>{t('tab.settings')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
