import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Switch, Text, View } from 'react-native';

import type { AuthSession } from '@panel/types/device';

import { Screen } from '@/components/Screen';
import { Slider } from '@/components/Slider';
import { Button, Card, CardTitle, Muted, Row } from '@/components/ui';
import { useLanguage, useT, type Key, type LanguageChoice } from '@/i18n';
import { api, errorMessage, type PushPrefs } from '@/lib/api';
import { ago } from '@/lib/format';
import { useLiveStatus } from '@/lib/live';
import { usePush } from '@/lib/push';
import { liveActivityEnabled, setLiveActivityEnabled } from '@/lib/widgets';
import { useAccess, useSession } from '@/lib/session';
import { space, useTheme } from '@/theme';

const LANGUAGES: { key: LanguageChoice; label: string | null }[] = [
  { key: 'auto', label: null },
  { key: 'uk', label: 'Українська' },
  { key: 'en', label: 'English' },
];

export default function Settings() {
  const theme = useTheme();
  const t = useT();
  const choice = useLanguage((s) => s.choice);
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
    Alert.alert(t('settings.signOutTitle'), t('settings.signOutDetail'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const current = sessions?.find((session) => session.current);

  return (
    <Screen title={t('tab.settings')}>
      <Card>
        <CardTitle>{t('settings.account')}</CardTitle>
        <Row first label={t('settings.signedInAs')} value={username ?? '—'} />
        <Row label={t('settings.role')} value={role ? t(`settings.role.${role}` as Key) : '—'} />
        {role ? <Muted style={{ marginTop: space.sm }}>{t(`settings.note.${role}` as Key)}</Muted> : null}
      </Card>

      <Card>
        <CardTitle>{t('settings.panel')}</CardTitle>
        <Row first label={t('settings.address')} value={serverUrl?.replace(/^https?:\/\//, '') ?? '—'} />
        <Row label={t('settings.connection')} value={t(connected ? 'settings.connected' : 'settings.reconnecting')} valueColor={connected ? theme.green : theme.yellow} />
        <Row label={t('settings.feed')} value={!connected ? '—' : t(mqtt ? 'home.live' : 'settings.feedDown')} valueColor={connected && mqtt ? theme.green : theme.textMuted} />
        {current ? <Row label={t('settings.expires')} value={expiry(current.expiresAt, t)} /> : null}
        {sessions && sessions.length > 1 ? <Row label={t('settings.otherSessions')} value={sessions.length - 1} /> : null}
        <Muted style={{ marginTop: space.sm }}>
          {t('settings.historyNote')}
        </Muted>
      </Card>

      <NotificationsCard />
      {Platform.OS === 'ios' ? <LiveActivityCard /> : null}

      <Card>
        <CardTitle>{t('settings.language')}</CardTitle>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: theme.raised, borderRadius: 10, padding: 3 }}>
          {LANGUAGES.map((language) => {
            const selected = language.key === choice;
            return (
              <Pressable
                key={language.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => useLanguage.getState().setChoice(language.key)}
                style={[{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }, selected && { backgroundColor: theme.card }]}>
                <Text style={{ color: selected ? theme.text : theme.textMuted, fontSize: 14, fontWeight: selected ? '600' : '500' }}>
                  {language.label ?? t('settings.lang.auto')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Button label={t('settings.signOut')} kind="danger" onPress={confirmSignOut} busy={leaving} />
      <Muted style={{ textAlign: 'center' }}>
        EcoFlow Panel {Constants.expoConfig?.version ?? ''}{current ? `  ·  ${ago(current.createdAt)}` : ''}
      </Muted>
    </Screen>
  );
}

function LiveActivityCard() {
  const theme = useTheme();
  const t = useT();
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    void liveActivityEnabled().then(setEnabled);
  }, []);
  return (
    <Card>
      <CardTitle
        right={(
          <Switch
            accessibilityLabel={t('settings.liveActivity')}
            value={enabled}
            onValueChange={(value) => {
              setEnabled(value);
              void setLiveActivityEnabled(value);
            }}
            trackColor={{ true: theme.primary, false: theme.raised }}
            thumbColor="#FFFFFF"
          />
        )}>
        {t('settings.liveActivity')}
      </CardTitle>
      <Muted>{t('settings.liveActivityNote')}</Muted>
    </Card>
  );
}

function NotificationsCard() {
  const theme = useTheme();
  const t = useT();
  const { state, prefs, error, token } = usePush();
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  const turnOn = async () => {
    setBusy(true);
    await usePush.getState().enable();
    setBusy(false);
  };
  const change = (next: Partial<PushPrefs>) => void usePush.getState().setPrefs({ ...prefs, ...next });
  const test = async () => {
    if (!token) return;
    setTested(null);
    try {
      await api.pushTest(token);
      setTested(t('settings.notify.testSent'));
    } catch (failure) {
      setTested(errorMessage(failure));
    }
  };
  const toggle = (key: 'grid' | 'lowBattery' | 'offline', first?: boolean) => (
    <Row
      first={first}
      label={t(`settings.notify.${key}` as Key)}
      value={(
        <Switch
          accessibilityLabel={t(`settings.notify.${key}` as Key)}
          value={prefs[key]}
          onValueChange={(value) => change({ [key]: value })}
          trackColor={{ true: theme.primary, false: theme.raised }}
          thumbColor="#FFFFFF"
        />
      )}
    />
  );

  return (
    <Card>
      <CardTitle
        right={state === 'on' ? (
          <Switch
            accessibilityLabel={t('settings.notifications')}
            value
            onValueChange={() => void usePush.getState().disable()}
            trackColor={{ true: theme.primary, false: theme.raised }}
            thumbColor="#FFFFFF"
          />
        ) : undefined}>
        {t('settings.notifications')}
      </CardTitle>
      {state === 'unavailable' ? <Muted>{t('settings.notifyUnavailable')}</Muted> : null}
      {state === 'denied' ? <Muted>{t('settings.notifyDenied')}</Muted> : null}
      {state === 'off' ? <Button label={t('settings.notifyEnable')} kind="secondary" busy={busy} onPress={turnOn} /> : null}
      {state === 'on' ? (
        <>
          {toggle('grid', true)}
          {toggle('offline')}
          {toggle('lowBattery')}
          {prefs.lowBattery ? (
            <View style={{ marginTop: space.md }}>
              <Slider
                label={t('settings.notify.threshold')}
                value={prefs.threshold}
                min={5}
                max={50}
                step={5}
                format={(value) => `${value}%`}
                onCommit={(threshold) => change({ threshold })}
              />
            </View>
          ) : null}
          <Button label={t('settings.notify.test')} kind="secondary" onPress={test} style={{ marginTop: space.md }} />
          {tested ? <Muted style={{ marginTop: space.sm }}>{tested}</Muted> : null}
        </>
      ) : null}
      {error ? <Muted style={{ marginTop: space.sm, color: theme.yellow }}>{error}</Muted> : null}
    </Card>
  );
}

function expiry(iso: string, t: ReturnType<typeof useT>): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days >= 2 ? t('settings.inDays', { n: days }) : t(days === 1 ? 'settings.tomorrow' : 'settings.today');
}
