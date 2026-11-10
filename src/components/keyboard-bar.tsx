import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useId } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The bar that rides on top of the keyboard, with a button at the right that
 * puts the keyboard away. Every text field in the app gets one, so there is
 * always an obvious way to see the page again:
 *
 *   const bar = useKeyboardBar();
 *   <TextInput inputAccessoryViewID={bar.id} />
 *   {bar.element}
 *
 * (`Field` already does this.) One bar per field, rendered right after it:
 * React Native attaches a bar to the one field it finds when the bar mounts,
 * so a single shared bar would serve only the first field on screen.
 *
 * iOS only: its keyboard has no hide key of its own. Android's system bar
 * already has one.
 */
export function useKeyboardBar() {
  const id = useId();
  if (Platform.OS !== 'ios') return { id: undefined, element: null };
  return { id, element: <KeyboardBar id={id} /> };
}

function KeyboardBar({ id }: { id: string }) {
  const theme = useTheme();
  return (
    <InputAccessoryView nativeID={id} backgroundColor={theme.backgroundElement}>
      <View style={[styles.bar, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={Keyboard.dismiss}
          accessibilityRole="button"
          accessibilityLabel="Hide keyboard"
          hitSlop={10}
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.6 }]}>
          <MaterialCommunityIcons name="keyboard-close-outline" size={24} color={theme.text} />
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: { paddingHorizontal: 8, paddingVertical: 6 },
});
