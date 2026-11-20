import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useLanguage } from '@/i18n';
import { useGridSync } from '@/lib/grid';
import { usePush } from '@/lib/push';
import { useSession } from '@/lib/session';
import { useDeviceSync } from '@/lib/useDeviceSync';
import { useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();
  const phase = useSession((s) => s.phase);

  useEffect(() => {
    // The language first, so a message from restoring the session is in it
    void useLanguage.getState().restore().then(() => useSession.getState().restore());
  }, []);

  useEffect(() => {
    if (phase !== 'restoring') void SplashScreen.hideAsync();
  }, [phase]);

  useDeviceSync();
  useGridSync();

  // A phone with notifications on registers under each new session, in the app's language
  const language = useLanguage((s) => s.language);
  useEffect(() => {
    if (phase === 'signedIn') void usePush.getState().sync();
  }, [phase, language]);

  // Tapping a notification opens what it is about (the server sends `url`)
  const tapped = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (Platform.OS === 'web' || phase !== 'signedIn' || !tapped) return;
    const url = tapped.notification.request.content.data?.url;
    if (typeof url === 'string' && /^\/(power|device\/[\w%.-]+)?$/.test(url)) router.navigate(url as Href);
  }, [tapped, phase]);

  // The splash screen stays up while the saved session is read
  if (phase === 'restoring') return null;

  const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigation = {
    ...base,
    colors: { ...base.colors, background: theme.background, card: theme.background, text: theme.text, border: theme.border, primary: theme.primary },
  };

  return (
    <ThemeProvider value={navigation}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', headerTintColor: theme.text, contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Protected guard={phase === 'signedIn'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="device/[sn]" options={{ title: '' }} />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'signedOut'}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
