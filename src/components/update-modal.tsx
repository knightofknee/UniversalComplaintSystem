import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, StyleSheet, View } from 'react-native';

import { Button, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { checkForAppUpdate, isSnoozed, snooze, type AppUpdateInfo } from '@/lib/app-update';

/** Coming back to the app checks again, at most this often. */
const CHECK_EVERY_MS = 30 * 60_000;

/**
 * Mounted at the root: when the store has a newer release than this build
 * (config/app, see src/lib/app-update.ts), Rudy asks for the update. Checked
 * at launch and whenever the app comes back to the front, since phones keep
 * an app open for days and store auto-update can be off.
 *
 * Above the floor it is a suggestion: "Maybe later" (or going to the store)
 * snoozes it for a day. Below the floor (`required`) there is no way past it:
 * no Maybe later, back does nothing, no snooze. The built-in words live in
 * the binary forever, so they name no feature; a release's own line comes
 * from config/app.updateMessage.
 */
export function UpdateModal() {
  const theme = useTheme();
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const last = useRef(0);

  useEffect(() => {
    let gone = false;
    const check = async () => {
      if (Date.now() - last.current < CHECK_EVERY_MS) return;
      last.current = Date.now();
      const r = await checkForAppUpdate();
      if (gone || !r) return;
      if (!r.required && (await isSnoozed(r.latestVersion))) return;
      if (!gone) setInfo(r);
    };
    void check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => {
      gone = true;
      sub.remove();
    };
  }, []);

  if (!info) return null;

  const later = () => {
    void snooze(info.latestVersion);
    setInfo(null);
  };
  const update = () => {
    if (!info.required) void snooze(info.latestVersion);
    Linking.openURL(info.storeUrl).catch(() => {});
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={info.required ? () => {} : later}>
      <View style={[styles.backdrop, { backgroundColor: theme.scrim }]}>
        <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <Image
            source={require('@/assets/images/rudy-1.png')}
            style={styles.rudy}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
          <T variant="heading" style={styles.center}>
            {info.required ? 'Time for an update' : 'A fresh update is here'}
          </T>
          <T style={styles.center}>
            {info.message ||
              (info.required
                ? "This version is too old to keep up anymore. Please grab the update from the store. Thank you!"
                : "We've been busy making UCS better. Would you mind grabbing the update? Thank you!")}
          </T>
          <Button label="Update" onPress={update} style={styles.wide} />
          {!info.required && <Button label="Maybe later" kind="quiet" onPress={later} />}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 16 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
    gap: 14,
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    alignItems: 'center',
  },
  rudy: { width: 72, height: 72 },
  center: { textAlign: 'center' },
  wide: { alignSelf: 'stretch' },
});
