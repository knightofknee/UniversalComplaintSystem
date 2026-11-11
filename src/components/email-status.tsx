import { Ionicons } from '@expo/vector-icons';
import { sendEmailVerification } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { showToast } from '@/components/toast';
import { Button, Notice, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText } from '@/lib/api';

/** How long the "Email verified" note stays if nobody taps OK. */
const SHOWN_FOR_MS = 4000;

/**
 * The moment the app notices an email was confirmed (use-auth.tsx checks on
 * its own): a short note that says so and what it unlocks, then gets out of
 * the way. OK closes it; so does doing nothing for a few seconds. Mounted
 * once, in the root layout.
 */
export function VerifiedNotice() {
  const theme = useTheme();
  const { justVerified, clearJustVerified } = useAuth();
  useEffect(() => {
    if (!justVerified) return;
    const t = setTimeout(clearJustVerified, SHOWN_FOR_MS);
    return () => clearTimeout(t);
  }, [justVerified, clearJustVerified]);
  return (
    <Modal visible={justVerified} transparent animationType="fade" onRequestClose={clearJustVerified}>
      <Pressable style={styles.backdrop} onPress={clearJustVerified}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          onPress={() => {}}>
          <View style={styles.title}>
            <Ionicons name="checkmark-circle" size={28} color={theme.good} />
            <T variant="heading">Email verified</T>
          </View>
          <T>You can send private complaints now, and respond for an organization you work for.</T>
          <Button label="OK" onPress={clearJustVerified} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Signed in with an email that isn't confirmed yet: one quiet line saying
 * where the link went, and a way to send it again. Nothing to tap once it
 * is clicked: the app notices by itself.
 */
export function ConfirmEmail({ reason }: { reason?: string }) {
  const theme = useTheme();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user || user.isAnonymous || !user.email || user.emailVerified) return null;
  const resend = async () => {
    setBusy(true);
    try {
      await sendEmailVerification(user);
      showToast('Sent again', `Check ${user.email}.`, 'info');
    } catch (e) {
      showToast("Couldn't send it", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Notice tone="warn">
      <T variant="small" color={theme.text}>
        Confirm your email with the link we sent to {user.email}
        {reason ? `, ${reason}` : ''}. This updates by itself once you click it.
      </T>
      <Button kind="quiet" label="Send the link again" onPress={resend} busy={busy} />
    </Notice>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 18, borderWidth: 1, padding: 22, gap: 14, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
