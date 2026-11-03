import {
  EmailAuthProvider,
  linkWithCredential,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { useState } from 'react';

import { showAlert } from '@/components/point-card';
import { Button, Card, Field, Notice, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { errorText } from '@/lib/api';
import { auth } from '@/lib/firebase';

/**
 * Adding an email turns this device's anonymous account into a real one,
 * keeping everything it already posted and supported. A verified email is
 * also how people respond for their organization.
 */
export default function AccountScreen() {
  const { user, refresh } = useAuth();
  const [mode, setMode] = useState<'add' | 'signin'>('add');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showAlert('That didn’t work', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (user && !user.isAnonymous) {
    return (
      <Screen>
        <T variant="heading">{user.email}</T>
        {user.emailVerified ? (
          <Notice>
            <T>Email verified.</T>
          </Notice>
        ) : (
          <Card>
            <T>Check your inbox for a verification link, then come back.</T>
            <Button label="I've verified it" onPress={() => run(refresh)} busy={busy} />
            <Button
              label="Send the link again"
              kind="quiet"
              onPress={() => run(async () => user && sendEmailVerification(user))}
            />
          </Card>
        )}
        <Button label="Sign out" kind="secondary" onPress={() => run(() => signOut(auth))} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Tabs
        options={[
          { key: 'add', label: 'Add an email' },
          { key: 'signin', label: 'I have an account' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <T variant="small">
        {mode === 'add'
          ? 'Keeps your complaints and support on every device, and lets you respond for your organization with a work email. Your email is never shown publicly.'
          : 'Signs in to an existing account. What this device did without an account stays with this device.'}
      </T>
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
        textContentType={mode === 'add' ? 'newPassword' : 'password'}
      />
      <Button
        label={mode === 'add' ? 'Add email' : 'Sign in'}
        busy={busy}
        disabled={!email.includes('@') || password.length < 8}
        onPress={() =>
          run(async () => {
            if (mode === 'signin') {
              await signInWithEmailAndPassword(auth, email.trim(), password);
            } else {
              const cred = EmailAuthProvider.credential(email.trim(), password);
              const linked = await linkWithCredential(auth.currentUser!, cred);
              await sendEmailVerification(linked.user);
            }
            await refresh();
          })
        }
      />
      <T variant="small">Passwords need at least 8 characters.</T>
    </Screen>
  );
}
