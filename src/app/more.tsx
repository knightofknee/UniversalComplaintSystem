import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Switch, View } from 'react-native';

import { showToast } from '@/components/toast';
import { Card, Row, Screen, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, setNotify } from '@/lib/api';
import { pushSupported, turnOffPush, turnOnPush } from '@/lib/push';

type Link = { icon: ComponentProps<typeof Ionicons>['name']; label: string; href: Href };

const HELP: Link[] = [
  { icon: 'information-circle-outline', label: 'How UCS works', href: '/about' },
  { icon: 'help-circle-outline', label: 'Help', href: '/help' },
  { icon: 'mail-outline', label: 'Write to us', href: '/feedback' },
];

const REST: Link[] = [
  { icon: 'trash-bin-outline', label: 'Removal log', href: '/removals' },
  { icon: 'shield-checkmark-outline', label: 'Privacy policy', href: '/privacy' },
  { icon: 'document-text-outline', label: 'Terms of use', href: '/terms' },
  { icon: 'close-circle-outline', label: 'Delete account', href: '/delete-account' },
];

/** Every kind of notification, each with its own switch (NOTICE_KINDS in functions/src/common.ts). */
const KINDS: { kind: string; label: string; detail: string }[] = [
  { kind: 'votes', label: 'Votes on your complaints', detail: 'People voting yours Best rant or Easy peasy.' },
  { kind: 'joined', label: 'People joining your issues', detail: 'More people saying they have an issue you have.' },
  { kind: 'fix', label: 'Proposed fixes', detail: 'Someone proposes a fix for an issue you have, so you can say if it worked.' },
  { kind: 'status', label: 'Fixed', detail: 'An issue you have is marked fixed, or its status changes.' },
  { kind: 'response', label: 'Organizations answering', detail: 'An organization responds to an issue you have.' },
  { kind: 'thread', label: 'Private replies', detail: 'Replies to the complaints you sent privately.' },
  { kind: 'draft', label: 'Held complaints', detail: 'A complaint held during a busy moment is checked and ready to post.' },
  { kind: 'access', label: 'Responding for an organization', detail: 'Your request to respond for one is answered.' },
];

function LinkRow({ link }: { link: Link }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Card onPress={() => router.push(link.href)}>
      <Row>
        <Ionicons name={link.icon} size={20} color={theme.primary} />
        <T style={{ flex: 1, fontWeight: '600' }}>{link.label}</T>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Row>
    </Card>
  );
}

function PhoneSwitch({ on }: { on: boolean }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  if (!pushSupported) return null;
  const flip = async (next: boolean) => {
    setBusy(true);
    try {
      if (!next) await turnOffPush();
      else {
        const r = await turnOnPush();
        if (r === 'denied') showToast('Notifications are off', 'Turn them on for this app in your phone’s settings.');
        if (r === 'unsupported') showToast('Not available here', 'Phone notifications need the app on a real phone.');
      }
    } catch (e) {
      showToast("Couldn't change that", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Row>
        <Ionicons name="phone-portrait-outline" size={20} color={theme.primary} />
        <T style={{ flex: 1, fontWeight: '600' }}>On this phone</T>
        <Switch value={on} onValueChange={flip} disabled={busy} />
      </Row>
      <T variant="small">The ones switched on below also arrive as phone notifications.</T>
    </Card>
  );
}

function KindSwitches() {
  const { user, profile } = useAuth();
  // Flipped here at once; the server catches up.
  const [mine, setMine] = useState<Record<string, boolean>>({});
  const off = new Set(profile?.notifyOff ?? []);
  const flip = async (kind: string, on: boolean) => {
    setMine((m) => ({ ...m, [kind]: on }));
    try {
      await setNotify({ kind, on });
    } catch (e) {
      setMine((m) => ({ ...m, [kind]: !on }));
      showToast("Couldn't change that", errorText(e));
    }
  };
  return (
    <Card>
      {KINDS.map((k, i) => (
        <View key={k.kind} style={{ gap: 2, paddingTop: i ? 10 : 0 }}>
          <Row>
            <T style={{ flex: 1, fontWeight: '600' }}>{k.label}</T>
            <Switch
              value={mine[k.kind] ?? !off.has(k.kind)}
              onValueChange={(v) => flip(k.kind, v)}
              disabled={!user}
              accessibilityLabel={k.label}
            />
          </Row>
          <T variant="small">{k.detail}</T>
        </View>
      ))}
    </Card>
  );
}

/**
 * Me > Settings: help (and writing to us) first, then which notifications to get, then the
 * app's rules and (last, on purpose) deleting an account, so "Delete
 * account" is never one stray tap away.
 */
export default function SettingsScreen() {
  const { profile } = useAuth();
  return (
    <Screen>
      {HELP.map((l) => (
        <LinkRow key={l.label} link={l} />
      ))}
      <T variant="label">Notifications</T>
      <PhoneSwitch on={!!profile?.pushOn} />
      <KindSwitches />
      <T variant="label">About</T>
      {REST.map((l) => (
        <LinkRow key={l.label} link={l} />
      ))}
    </Screen>
  );
}
