import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Toast = { id: number; title: string; message?: string; tone: 'error' | 'info' };
let next = 1;
const listeners = new Set<(t: Toast) => void>();

/**
 * A short note that slides in at the top and leaves on its own. Used instead
 * of pop-up alerts everywhere: nothing blocks the screen to say a thing failed.
 */
export function showToast(title: string, message?: string, tone: Toast['tone'] = 'error') {
  const t = { id: next++, title, message, tone };
  listeners.forEach((l) => l(t));
}

/** Mounted once, in the root layout. */
export function Toaster() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const [y] = useState(() => new Animated.Value(-120));

  useEffect(() => {
    const l = (t: Toast) => setToast(t);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const native = Platform.OS !== 'web';
    Animated.spring(y, { toValue: 0, friction: 8, tension: 90, useNativeDriver: native }).start();
    const timer = setTimeout(() => {
      Animated.timing(y, { toValue: -120, duration: 200, useNativeDriver: native }).start(() =>
        setToast((cur) => (cur?.id === toast.id ? null : cur)),
      );
    }, 3800);
    return () => clearTimeout(timer);
  }, [toast, y]);

  if (!toast) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 8 }]}>
      <Animated.View style={{ transform: [{ translateY: y }], alignItems: 'center', paddingHorizontal: 16 }}>
        <Pressable
          onPress={() => setToast(null)}
          accessibilityRole="alert"
          style={[styles.toast, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
          <Ionicons
            name={toast.tone === 'error' ? 'alert-circle' : 'checkmark-circle'}
            size={20}
            color={toast.tone === 'error' ? theme.danger : theme.good}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontFamily: Fonts.bold, fontSize: 15 }}>{toast.title}</Text>
            {toast.message ? (
              <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 19 }}>{toast.message}</Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    width: '100%',
    maxWidth: 520,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
