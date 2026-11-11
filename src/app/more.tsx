import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import type { ComponentProps } from 'react';

import { Card, Row, Screen, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

const LINKS: { icon: ComponentProps<typeof Ionicons>['name']; label: string; href: Href }[] = [
  { icon: 'information-circle-outline', label: 'How UCS works', href: '/about' },
  { icon: 'help-circle-outline', label: 'Help', href: '/help' },
  { icon: 'trash-bin-outline', label: 'Removal log', href: '/removals' },
  { icon: 'shield-checkmark-outline', label: 'Privacy policy', href: '/privacy' },
  { icon: 'document-text-outline', label: 'Terms of use', href: '/terms' },
  { icon: 'close-circle-outline', label: 'Delete account', href: '/delete-account' },
];

/**
 * Me > About: what the app is, its rules, and (last, on purpose) deleting an
 * account. Kept off the Me tab itself so that tab is about the person, and
 * so "Delete account" is never one stray tap away.
 */
export default function MoreScreen() {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Screen>
      {LINKS.map((l) => (
        <Card key={l.label} onPress={() => router.push(l.href)}>
          <Row>
            <Ionicons name={l.icon} size={20} color={theme.primary} />
            <T style={{ flex: 1, fontWeight: '600' }}>{l.label}</T>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
