import { Ionicons } from '@expo/vector-icons';
import {
  EmailAuthProvider,
  linkWithCredential,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { Stack, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { showAlert } from '@/components/point-card';
import { Button, Card, Field, Notice, Screen, T, Tabs } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText } from '@/lib/api';
import { auth } from '@/lib/firebase';
import {
  appleAvailable,
  Cancelled,
  continueWithApple,
  continueWithGoogle,
  googleAvailable,
  switchAccount,
} from '@/lib/sso';

/**
 * Sign in. Everyone already has an anonymous account, so signing in with
 * Apple, Google or an email attaches that to the same account and keeps
 * everything it posted and supported. A verified email is also how people
 * respond for their organization.
 */
export default function AccountScreen() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      // Closing the Apple or Google sheet is a choice, not a failure.
      if (!(e instanceof Cancelled)) showAlert('That didn’t work', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (user && !user.isAnonymous) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Account' }} />
        <T variant="heading">{user.email ?? 'Signed in'}</T>
        {user.emailVerified ? (
          <Notice>
            <T>Email verified.</T>
          </Notice>
        ) : (
          <Card>
            <T>Check your inbox for a verification link, then come back.</T>
            <Button label="I've verified it" onPress={() => run('verify', refresh)} busy={busy === 'verify'} />
            <Button
              label="Send the link again"
              kind="quiet"
              onPress={() => run('resend', async () => user && sendEmailVerification(user))}
            />
          </Card>
        )}
        <Button label="Sign out" kind="secondary" onPress={() => run('out', () => signOut(auth))} />
        <Button label="Delete account" kind="quiet" onPress={() => router.push('/delete-account')} />
      </Screen>
    );
  }

  const signup = mode === 'signup';
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Sign in' }} />
      <View style={styles.providers}>
        {googleAvailable && (
          <ProviderButton
            name="Google"
            logo={<Image source={require('@/assets/images/google-g.svg')} style={styles.logo} contentFit="contain" />}
            busy={busy === 'google'}
            disabled={!!busy}
            onPress={() => run('google', async () => (await continueWithGoogle(), refresh()))}
          />
        )}
        {appleAvailable && (
          <ProviderButton
            name="Apple"
            solid
            logo={(color) => <Ionicons name="logo-apple" size={22} color={color} />}
            busy={busy === 'apple'}
            disabled={!!busy}
            onPress={() => run('apple', async () => (await continueWithApple(), refresh()))}
          />
        )}
      </View>
      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: theme.border }]} />
        <T variant="small">or</T>
        <View style={[styles.line, { backgroundColor: theme.border }]} />
      </View>
      <Tabs
        options={[
          { key: 'signup', label: 'Sign up' },
          { key: 'signin', label: 'I have an account' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType={signup ? 'newPassword' : 'password'}
      />
      <Button
        label={signup ? 'Sign up' : 'Sign in'}
        busy={busy === 'email'}
        disabled={!!busy || !email.includes('@') || password.length < 8}
        onPress={() =>
          run('email', async () => {
            if (signup) {
              const cred = EmailAuthProvider.credential(email.trim(), password);
              const linked = await linkWithCredential(auth.currentUser!, cred);
              await sendEmailVerification(linked.user);
            } else {
              await switchAccount(() => signInWithEmailAndPassword(auth, email.trim(), password));
            }
            await refresh();
          })
        }
      />
      <T variant="small">
        {signup
          ? 'Passwords need at least 8 characters. Your email is never shown.'
          : 'What you did here before signing in, like a complaint you just posted, moves into your account.'}
      </T>
    </Screen>
  );
}

/**
 * Apple's and Google's buttons, side by side: the mark and one word. Nobody
 * needs "Continue with" spelled out on a button with the logo on it. Google's
 * mark keeps its own four colors; Apple's button is solid, as its guidelines ask.
 */
function ProviderButton({
  name,
  logo,
  solid,
  busy,
  disabled,
  onPress,
}: {
  name: string;
  logo: ReactNode | ((color: string) => ReactNode);
  solid?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fg = solid ? theme.background : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Sign in with ${name}`}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [
        styles.provider,
        {
          backgroundColor: solid ? theme.text : theme.background,
          borderColor: solid ? theme.text : theme.border,
          opacity: pressed ? 0.85 : disabled && !busy ? 0.7 : 1,
        },
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {typeof logo === 'function' ? logo(fg) : logo}
          <Text style={[styles.providerText, { color: fg }]}>{name}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  providers: { flexDirection: 'row', gap: 10 },
  provider: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
  },
  providerText: { fontFamily: Fonts.bold, fontSize: 16 },
  logo: { width: 22, height: 22 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
