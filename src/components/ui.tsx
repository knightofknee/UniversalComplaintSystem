import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
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

import { useTheme } from '@/hooks/use-theme';

/** Scrolling page, centered and capped in width on wide (web) screens. */
export function Screen({
  children,
  topInset,
  onRefresh,
  refreshing,
}: {
  children: ReactNode;
  /** Tab screens have no header, so they pad below the status bar. */
  topInset?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      keyboardShouldPersistTaps="handled"
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

type Variant = 'title' | 'heading' | 'body' | 'small' | 'label';

export function T({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: Variant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const theme = useTheme();
  const muted = variant === 'small' || variant === 'label';
  return (
    <Text
      numberOfLines={numberOfLines}
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
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label && <T variant="label">{label}</T>}
      <TextInput
        placeholderTextColor={theme.textSecondary}
        {...rest}
        style={[
          styles.field,
          { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
          rest.multiline && { minHeight: 120, textAlignVertical: 'top' },
          style,
        ]}
      />
    </View>
  );
}

/** Segmented control. */
export function Tabs<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.tab, { backgroundColor: on ? theme.text : theme.backgroundElement }]}>
            <Text style={{ color: on ? theme.background : theme.text, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
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
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  heading: { fontSize: 19, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  button: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  card: { borderRadius: 14, padding: 14, gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  chipText: { fontSize: 12, fontWeight: '700' },
  field: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  notice: { borderRadius: 12, padding: 12, gap: 6 },
});
