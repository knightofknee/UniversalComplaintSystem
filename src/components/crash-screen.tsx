import * as Application from 'expo-application';
import { Image } from 'expo-image';
import { router, usePathname, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { reportCrash } from '@/lib/api';

/**
 * Shown instead of a blank screen when something in the app throws while
 * drawing (the root layout's ErrorBoundary). Rudy is sorry, it is on us, and
 * Try again draws it once more; a page that breaks every time has Back to
 * the start, which leaves it for the complaint box. What was typed in the complaint box lives
 * outside the screens (`kept.draft`), so it survives. The crash is logged
 * (`reportCrash`) for the daily check; that can never crash this screen.
 */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();
  const where = usePathname();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A crash before the splash hides would leave the splash up forever.
    void SplashScreen.hideAsync().catch(() => {});
    reportCrash({
      message: String(error?.message ?? error),
      ...(typeof error?.stack === 'string' ? { stack: error.stack } : {}),
      where,
      platform: Platform.OS,
      appVersion: Application.nativeApplicationVersion ?? undefined,
    }).catch(() => {});
  }, [error, where]);

  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <Image
        source={require('@/assets/images/rudy-5.png')}
        style={styles.rudy}
        contentFit="contain"
        accessibilityIgnoresInvertColors
      />
      <Text style={[styles.title, { color: theme.text }]}>Something broke</Text>
      <Text style={[styles.body, { color: theme.textSecondary }]}>
        That&apos;s on us, not you, and we&apos;ve been told. Anything you were typing in the complaint box is kept.
      </Text>
      <Button
        label="Try again"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await retry();
          } finally {
            setBusy(false);
          }
        }}
        style={styles.button}
      />
      <Button
        label="Back to the start"
        kind="quiet"
        onPress={async () => {
          try {
            router.replace('/');
          } catch {
            // Navigation itself may be what broke; Try again is still there.
          }
          await retry();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  rudy: { width: 96, height: 96 },
  title: { fontFamily: Fonts.display, fontSize: 26, textAlign: 'center' },
  body: { fontSize: 16, lineHeight: 22, textAlign: 'center', maxWidth: 360 },
  button: { alignSelf: 'stretch', maxWidth: 360, width: '100%', marginTop: 6 },
});
