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
export function TermsCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  const router = useRouter();
  const accepted = useTermsAccepted();
  if (accepted) return null;
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
