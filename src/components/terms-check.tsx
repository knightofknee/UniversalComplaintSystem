import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

/** True once this account has agreed (the server records it with the first post). */
export function useTermsAccepted() {
  const { profile } = useAuth();
  return !!profile?.termsAcceptedAt;
}

/**
 * The terms agreement before a first post, message or response. Renders
 * nothing once agreed. The server refuses a first post without it.
 */
export function TermsCheck({
  checked,
  onChange,
  compact,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** One line, for sitting right above a post button. */
  compact?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const accepted = useTermsAccepted();
  if (accepted) return null;
  if (compact) {
    return (
      <View style={styles.row}>
        <Pressable
          onPress={() => onChange(!checked)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel="I agree to the terms of use: no threats, hate, harassment, sexual content, or posts aimed at private people"
          hitSlop={8}
          style={styles.row}>
          <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? theme.primary : theme.textSecondary} />
          <T variant="small" color={theme.text}>
            No threats, hate or going after private people. I agree to the
          </T>
        </Pressable>
        <Pressable onPress={() => router.push('/terms')} accessibilityRole="link" hitSlop={8}>
          <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
            terms
          </T>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[styles.box, { borderColor: checked ? theme.primary : theme.border }]}>
      <Pressable
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I agree to the terms of use"
        style={styles.row}
        hitSlop={6}>
        <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? theme.primary : theme.textSecondary} />
        <T style={{ flex: 1 }}>
          I agree to the{' '}
          <T color={theme.primary} style={{ fontWeight: '700' }}>
            terms of use
          </T>
          .
        </T>
      </Pressable>
      <T variant="small">
        Zero tolerance: no threats, hate, harassment, sexual content, or posts aimed at private people. Accounts that
        break this are suspended.
      </T>
      <Pressable onPress={() => router.push('/terms')} accessibilityRole="link" hitSlop={6}>
        <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
          Read the terms
        </T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1.5, borderRadius: 12, padding: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
