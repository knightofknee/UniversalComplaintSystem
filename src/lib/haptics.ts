import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptic accents on the moments that matter (supporting a point, posting, a
 * confirmed fix), never on plain navigation. No-ops on the web.
 */
export function tapHaptic(): void {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function successHaptic(): void {
  if (Platform.OS === 'web') return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
