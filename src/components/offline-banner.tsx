import { Ionicons } from '@expo/vector-icons';
import { useNetworkState } from 'expo-network';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

/**
 * A small pill at the top while the phone has no connection, so a list that
 * won't load or a Next that fails has an obvious reason. It sits between the
 * corner buttons (never over them), lets every tap through, and goes away by
 * itself. Unknown counts as online: it never shows on a guess.
 */
export function OfflineBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const net = useNetworkState();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  if (!offline) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.wrap, { top: insets.top + 8 }]}
    >
      <View style={[styles.pill, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
        <Ionicons name="cloud-offline-outline" size={14} color={theme.warning} />
        <Text style={[styles.text, { color: theme.text }]} numberOfLines={1}>
          You&apos;re offline
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 64, right: 64, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  text: { fontSize: 13, fontWeight: '700' },
});
