import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useSession } from '@/lib/session';
import { useDeviceSync } from '@/lib/useDeviceSync';
import { useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();
  const phase = useSession((s) => s.phase);

  useEffect(() => {
    void useSession.getState().restore();
  }, []);

  useEffect(() => {
    if (phase !== 'restoring') void SplashScreen.hideAsync();
  }, [phase]);

  useDeviceSync();

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
