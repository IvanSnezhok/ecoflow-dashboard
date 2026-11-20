import { NativeTabs } from 'expo-router/native-tabs';

import { useAccess } from '@/lib/session';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const theme = useTheme();
  const { powerReserve } = useAccess();
  return (
    <NativeTabs backgroundColor={theme.card} tintColor={theme.primary} indicatorColor={theme.raised}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Stations</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'battery.75percent', selected: 'battery.100percent' }} md="battery_full" />
      </NativeTabs.Trigger>
      {/* The panel opens Power reserve only to users who may see its device */}
      <NativeTabs.Trigger name="power" hidden={!powerReserve}>
        <NativeTabs.Trigger.Label>Grid</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bolt', selected: 'bolt.fill' }} md="bolt" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
