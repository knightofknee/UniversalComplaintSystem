import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';
import { useKeyboardBar } from '@/components/keyboard-bar';
import { useTheme } from '@/hooks/use-theme';

/** Scrolling page, centered and capped in width on wide (web) screens. */
export function Screen({
  children,
  topInset,
  onRefresh,
  refreshing,
  scrollRef,
}: {
  children: ReactNode;
  /** Tab screens have no header, so they pad below the status bar. */
  topInset?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** To scroll the screen from outside (to something just added, say). */
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.background }}
      keyboardShouldPersistTaps="handled"
      // Dragging the page also puts the keyboard away.
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      contentContainerStyle={[
        styles.screen,
        { paddingTop: (topInset ? insets.top : 0) + 16, paddingBottom: insets.bottom + 40 },
      ]}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
      }>
      {children}
    </ScrollView>
  );
}

type Variant = 'display' | 'title' | 'heading' | 'body' | 'small' | 'label';

export function T({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
  onPress,
}: {
  children: ReactNode;
  variant?: Variant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** For an inline link inside a sentence. */
  onPress?: () => void;
}) {
  const theme = useTheme();
  const muted = variant === 'small' || variant === 'label';
  return (
    <Text
      numberOfLines={numberOfLines}
      onPress={onPress}
      accessibilityRole={onPress ? 'link' : undefined}
      suppressHighlighting
      style={[styles[variant], { color: color ?? (muted ? theme.textSecondary : theme.text) }, style]}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'quiet';
  icon?: ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const bg = kind === 'primary' ? theme.primaryFill : kind === 'secondary' ? theme.primarySoft : 'transparent';
  const fg = kind === 'primary' ? theme.onPrimary : theme.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'quiet' && { paddingHorizontal: 4 },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const box = [styles.card, { backgroundColor: theme.backgroundElement }, style];
  if (!onPress) return <View style={box}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [box, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const theme = useTheme();
  const { label, style, placeholder, ...rest } = props;
  const bar = useKeyboardBar();
  // On iOS a one-line field draws its own placeholder a few points lower
  // than typed text whenever it isn't focused, so the words jump when
  // someone starts typing. We draw the placeholder ourselves, centered the
  // same way the typed text is. (Needs a controlled field, to know it is empty.)
  const own = Platform.OS === 'ios' && !rest.multiline && typeof rest.value === 'string';
  return (
    <View style={{ gap: 6 }}>
      {label && <T variant="label">{label}</T>}
      <View>
        <TextInput
          placeholderTextColor={theme.textSecondary}
          placeholder={own ? undefined : placeholder}
          accessibilityLabel={rest.accessibilityLabel ?? label ?? placeholder}
          // Every field gets the bar with the hide-keyboard button.
          inputAccessoryViewID={bar.id}
          {...rest}
          style={[
            styles.field,
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
            // One line: a fixed height and no vertical padding, so the text sits centered.
            rest.multiline ? { minHeight: 120, textAlignVertical: 'top' } : styles.oneLine,
            style,
          ]}
        />
        {own && !rest.value && !!placeholder && (
          <View pointerEvents="none" style={styles.placeholder} accessible={false} importantForAccessibility="no">
            <Text numberOfLines={1} style={{ fontSize: 16, color: theme.textSecondary }}>
              {placeholder}
            </Text>
          </View>
        )}
      </View>
      {bar.element}
    </View>
  );
}

/** Segmented control. */
export function Tabs<K extends string>({
  options,
  value,
  onChange,
  fill,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  /** Equal segments across the full width, for a choice that sits in a column of full-width controls. */
  fill?: boolean;
}) {
  const theme = useTheme();
  const tabs = options.map((o) => {
    const on = o.key === value;
    return (
      <Pressable
        key={o.key}
        onPress={() => onChange(o.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        style={[
          styles.tab,
          fill && { flex: 1, alignItems: 'center' },
          { backgroundColor: on ? theme.text : theme.backgroundElement },
        ]}>
        <Text style={{ color: on ? theme.background : theme.text, fontWeight: '600' }}>{o.label}</Text>
      </Pressable>
    );
  });
  if (fill) return <View style={{ flexDirection: 'row', gap: 8 }}>{tabs}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {tabs}
    </ScrollView>
  );
}

export function Empty({ text, loading }: { text: string; loading?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: 32, alignItems: 'center' }}>
      {loading ? <ActivityIndicator color={theme.textSecondary} /> : <T variant="small">{text}</T>}
    </View>
  );
}

/** A friendly line under whatever failed: no pop-up, no codes. */
export function InlineError({ text, onDismiss }: { text: string | null; onDismiss?: () => void }) {
  const theme = useTheme();
  if (!text) return null;
  return (
    <View style={[styles.inlineError, { backgroundColor: theme.dangerSoft }]} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={18} color={theme.danger} />
      <Text style={{ flex: 1, color: theme.text, fontSize: 15, lineHeight: 20 }}>{text}</Text>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={18} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

/** Hairline between list rows. */
export function Divider() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} />;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'new' }) {
  const theme = useTheme();
  const bg = tone === 'warn' ? theme.warningSoft : tone === 'new' ? theme.newSoft : theme.primarySoft;
  return <View style={[styles.notice, { backgroundColor: bg }]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 16, gap: 14, width: '100%', maxWidth: 720, alignSelf: 'center' },
  display: { fontFamily: Fonts.display, fontSize: 40, lineHeight: 42, letterSpacing: -1 },
  title: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.6 },
  heading: { fontFamily: Fonts.bold, fontSize: 20, lineHeight: 24, letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  button: {
    minHeight: 50,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontFamily: Fonts.bold, fontSize: 17 },
  card: { borderRadius: 16, padding: 14, gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  chipText: { fontSize: 12, fontWeight: '700' },
  field: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  oneLine: { height: 44, paddingVertical: 0 },
  // Over the field's text area: same inset as `field` (padding 12 + border 1), centered like the text.
  placeholder: { position: 'absolute', left: 13, right: 13, top: 0, bottom: 0, justifyContent: 'center' },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  notice: { borderRadius: 14, padding: 12, gap: 6 },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
});
