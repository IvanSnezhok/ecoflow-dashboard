import { useRef, useState, type ComponentRef, type Ref } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { radius, space, tint, useTheme } from '@/theme';

type InputRef = ComponentRef<typeof TextInput>;

export default function SignIn() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const savedServer = useSession((s) => s.serverUrl);
  const savedUsername = useSession((s) => s.username);
  const notice = useSession((s) => s.notice);

  const [server, setServer] = useState(savedServer ?? '');
  const [username, setUsername] = useState(savedUsername ?? '');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameInput = useRef<InputRef>(null);
  const passwordInput = useRef<InputRef>(null);
  const otpInput = useRef<InputRef>(null);

  const ready = server.trim() !== '' && username.trim() !== '' && password !== '' && otp.replace(/\s+/g, '').length >= 6;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await useSession.getState().signIn(server, username, password, otp);
    } catch (failure) {
      setError(errorMessage(failure));
      // A code works once: the next attempt needs a fresh one
      setOtp('');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
        <View style={styles.column}>
          <View style={[styles.mark, { backgroundColor: tint(theme.primary, 0.14) }]}>
            <Icon name="zap" size={28} color={theme.primary} />
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>EcoFlow Panel</Text>
          <Text style={[styles.lead, { color: theme.textMuted }]}>
            {t('signin.lead')}
          </Text>

          {notice && !error ? <Banner text={notice} color={theme.yellow} /> : null}
          {error ? <Banner text={error} color={theme.red} /> : null}

          <Field
            label={t('signin.address')}
            value={server}
            onChangeText={setServer}
            placeholder="panel.example.com"
            keyboardType="url"
            textContentType="URL"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => usernameInput.current?.focus()}
          />
          <Field
            ref={usernameInput}
            label={t('signin.username')}
            value={username}
            onChangeText={setUsername}
            textContentType="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => passwordInput.current?.focus()}
          />
          <Field
            ref={passwordInput}
            label={t('signin.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="next"
            onSubmitEditing={() => otpInput.current?.focus()}
          />
          <Field
            ref={otpInput}
            label={t('signin.code')}
            value={otp}
            onChangeText={(text) => setOtp(text.replace(/[^\d\s]/g, '').slice(0, 7))}
            placeholder="000000"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            returnKeyType="go"
            onSubmitEditing={submit}
            style={{ letterSpacing: 4, fontVariant: ['tabular-nums'] }}
          />

          <Button label={t('signin.submit')} onPress={submit} busy={busy} disabled={!ready} style={{ marginTop: space.sm }} />
          <Text style={[styles.hint, { color: theme.textFaint }]}>
            {t('signin.hint')}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Banner({ text, color }: { text: string; color: string }) {
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: tint(color, 0.12), borderColor: tint(color, 0.4) }]}>
      <Text style={{ color, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

function Field({ label, style, ref, ...input }: TextInputProps & { label: string; ref?: Ref<InputRef> }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={theme.textFaint}
        selectionColor={theme.primary}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          { backgroundColor: theme.card, color: theme.text, borderColor: focused ? theme.primary : theme.border },
          style,
        ]}
        {...input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: space.xl, alignItems: 'center' },
  column: { width: '100%', maxWidth: 420, gap: space.lg },
  mark: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  lead: { fontSize: 15, lineHeight: 22, marginTop: -space.sm },
  banner: { borderRadius: radius.md, borderWidth: 1, padding: space.md },
  label: { fontSize: 13, fontWeight: '500' },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.lg, fontSize: 17 },
  hint: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
