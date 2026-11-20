import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';

import type { AuthSession, PanelRole } from '@panel/types/device';

import { Screen } from '@/components/Screen';
import { Button, Card, CardTitle, Muted, Row } from '@/components/ui';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { useLiveStatus } from '@/lib/live';
import { useAccess, useSession } from '@/lib/session';
import { space, useTheme } from '@/theme';

const ROLE: Record<PanelRole, { label: string; note: string }> = {
  owner: { label: 'Owner', note: 'You manage the panel. Users, automation and panel settings are in the panel in a browser.' },
  operator: { label: 'Operator', note: 'You see the stations you were given and control them.' },
  viewer: { label: 'Viewer', note: 'You see the stations you were given. Controls are view only.' },
};

export default function Settings() {
  const theme = useTheme();
  const { username, role } = useAccess();
  const serverUrl = useSession((s) => s.serverUrl);
  const { connected, mqtt } = useLiveStatus();
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void useSession.getState().refreshStatus();
    api.sessions().then(setSessions).catch(() => undefined);
  }, []);

  const signOut = async () => {
    setLeaving(true);
    await useSession.getState().signOut();
  };

  const confirmSignOut = () => {
    if (Platform.OS === 'web') {
      void signOut();
      return;
    }
    Alert.alert('Sign out?', 'You will need your password and a code from your authenticator app to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const current = sessions?.find((session) => session.current);

  return (
    <Screen title="Settings">
      <Card>
        <CardTitle>Account</CardTitle>
        <Row first label="Signed in as" value={username ?? '—'} />
        <Row label="Role" value={role ? ROLE[role].label : '—'} />
        {role ? <Muted style={{ marginTop: space.sm }}>{ROLE[role].note}</Muted> : null}
      </Card>

      <Card>
        <CardTitle>Panel</CardTitle>
        <Row first label="Address" value={serverUrl?.replace(/^https?:\/\//, '') ?? '—'} />
        <Row label="Connection" value={connected ? 'Connected' : 'Reconnecting…'} valueColor={connected ? theme.green : theme.yellow} />
        <Row label="EcoFlow live feed" value={!connected ? '—' : mqtt ? 'Live' : 'Down, polling every 10 s'} valueColor={connected && mqtt ? theme.green : theme.textMuted} />
        {current ? <Row label="This session expires" value={expiry(current.expiresAt)} /> : null}
        {sessions && sessions.length > 1 ? <Row label="Other sessions" value={sessions.length - 1} /> : null}
        <Muted style={{ marginTop: space.sm }}>
          History is recorded by the panel around the clock; the app shows it and does not need to stay open.
        </Muted>
      </Card>

      <Button label="Sign out" kind="danger" onPress={confirmSignOut} busy={leaving} />
      <Muted style={{ textAlign: 'center' }}>
        EcoFlow Panel {Constants.expoConfig?.version ?? ''}{current ? `  ·  signed in ${ago(current.createdAt)}` : ''}
      </Muted>
    </Screen>
  );
}

function expiry(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days >= 2 ? `in ${days} days` : days === 1 ? 'tomorrow' : 'today';
}
