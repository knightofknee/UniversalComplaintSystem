import { signOut } from 'firebase/auth';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';

import { showAlert } from '@/components/point-card';
import { Button, Screen, T } from '@/components/ui';
import { deleteAccount, errorText } from '@/lib/api';
import { auth } from '@/lib/firebase';

function confirmDelete(): Promise<boolean> {
  const title = 'Delete your account?';
  const message = "This can't be undone.";
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/**
 * Deleting an account, on a screen of its own (Me > Delete account), signed
 * in or not: an account that never signed in still has complaints.
 * Everything the privacy policy promises happens server-side
 * (functions/src/account.ts); change the three together.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!(await confirmDelete())) return;
    setBusy(true);
    try {
      await deleteAccount({ confirm: true });
      // The sign-in is gone; signing out starts a fresh anonymous account.
      await signOut(auth).catch(() => {});
      router.replace('/');
    } catch (e) {
      showAlert("Couldn't delete your account", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <T variant="heading">What gets deleted</T>
      <T>Your private complaints and their conversations.</T>
      <T>The words, photos and name on your public complaints. The points they raised stay, without your name, because other people share them.</T>
      <T>Your support, your votes, and any fixes you proposed.</T>
      <T>Your sign-in, if you have one.</T>
      <Button label="Delete my account" kind="secondary" onPress={remove} busy={busy} />
    </Screen>
  );
}
