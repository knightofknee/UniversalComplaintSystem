import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { collection, documentId, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState, type ComponentProps } from 'react';
import { Switch } from 'react-native';

import { showAlert } from '@/components/point-card';
import { Button, Card, Empty, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText } from '@/lib/api';
import { unblockAuthor, useBlockedAuthors } from '@/lib/blocks';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection } from '@/lib/hooks';
import { isOperator } from '@/lib/operator';
import { type AppearancePref, setAppearance, useAppearancePref } from '@/lib/appearance';
import { pushSupported, turnOffPush, turnOnPush } from '@/lib/push';
import type { Notification, Submission } from '@/lib/types';

function Link({
  icon,
  label,
  detail,
  href,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  href: Href;
}) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Card onPress={() => router.push(href)}>
      <Row>
        <Ionicons name={icon} size={20} color={theme.primary} />
        <T style={{ flex: 1, fontWeight: '600' }}>{label}</T>
        {detail && <T variant="small">{detail}</T>}
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Row>
    </Card>
  );
}

function PushSwitch({ on }: { on: boolean }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  if (!pushSupported) return null;
  const flip = async (next: boolean) => {
    setBusy(true);
    try {
      if (!next) await turnOffPush();
      else {
        const r = await turnOnPush();
        if (r === 'denied') showAlert('Notifications are off', 'Turn them on for this app in your phone’s settings.');
        if (r === 'unsupported') showAlert('Not available here', 'Phone notifications need the app on a real phone.');
      }
    } catch (e) {
      showAlert("Couldn't change that", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Row>
        <Ionicons name="phone-portrait-outline" size={20} color={theme.primary} />
        <T style={{ flex: 1, fontWeight: '600' }}>Phone notifications</T>
        <Switch value={on} onValueChange={flip} disabled={busy} />
      </Row>
      <T variant="small">When an organization responds, says it fixed something, or replies to you privately.</T>
    </Card>
  );
}

const LOOKS: { key: AppearancePref; label: string }[] = [
  { key: 'dark', label: 'Dark' },
  { key: 'light', label: 'Light' },
  { key: 'system', label: 'Match phone' },
];

function AppearancePicker() {
  const theme = useTheme();
  const choice = useAppearancePref();
  return (
    <Card>
      <Row>
        <Ionicons name="contrast-outline" size={20} color={theme.primary} />
        <T style={{ flex: 1, fontWeight: '600' }}>Appearance</T>
      </Row>
      <Tabs options={LOOKS} value={choice} onChange={setAppearance} />
    </Card>
  );
}

export default function MeScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const blocked = useBlockedAuthors();
  const unread = useCollection<Notification>(
    user ? query(collection(db, `users/${user.uid}/notifications`), where('read', '==', false), limit(50)) : null,
    `unread:${user?.uid}`,
  );
  const mine = useCollection<{ id: string }>(
    user ? query(collection(db, `users/${user.uid}/mine`), orderBy('at', 'desc'), limit(30)) : null,
    `mine:${user?.uid}`,
  );
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const ids = mine.items.map((m) => m.id).join(',');

  useEffect(() => {
    const list = ids ? ids.split(',') : [];
    if (list.length === 0) return;
    // `in` takes at most 30 ids, which is the page size above.
    getDocs(query(collection(db, 'submissions'), where('removed', '==', false), where(documentId(), 'in', list)))
      .then((snap) => {
        const byId = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as Submission]));
        setSubmissions(list.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
      })
      .catch(() => setSubmissions([]));
  }, [ids]);

  const shown = ids ? submissions : [];
  const responder = (profile?.responderFor ?? []).length > 0;
  return (
    <Screen topInset>
      <T variant="title">{profile?.displayName ?? 'You'}</T>
      <T variant="small">
        {user?.isAnonymous
          ? 'No account: public complaints from this device are yours. Add an email to keep your history in one place and to send private complaints.'
          : user?.email}
      </T>
      <Link
        icon="notifications-outline"
        label="Notifications"
        detail={unread.items.length ? `${unread.items.length} new` : undefined}
        href="/notifications"
      />
      <PushSwitch on={!!profile?.pushOn} />
      <AppearancePicker />
      <Link icon="lock-closed-outline" label="Private complaints" href="/threads" />
      <Link icon="person-circle-outline" label={user?.isAnonymous ? 'Add an email' : 'Account'} href="/account" />
      <Link
        icon="briefcase-outline"
        label={responder ? 'Respond for your organization' : 'Work somewhere? Respond for it'}
        href={responder ? '/company' : '/company/claim'}
      />
      {isOperator(user) && <Link icon="shield-half-outline" label="Operator queue" href="/operator" />}

      <T variant="label">Your complaints</T>
      {shown.length === 0 ? (
        <Empty text="Nothing yet. Surely something's bugging you?" loading={mine.loading} />
      ) : (
        shown.map((s) => (
          <Card key={s.id} onPress={() => router.push(`/submission/${s.id}`)}>
            <T numberOfLines={3}>{s.text}</T>
            <T variant="small">
              {s.subjectNames.join(' · ')} · {timeAgo(s.createdAt?.toMillis())}
            </T>
          </Card>
        ))
      )}

      {blocked.list.length > 0 && (
        <>
          <T variant="label">Hidden authors</T>
          {blocked.list.map((b) => (
            <Card key={b.id}>
              <Row>
                <Ionicons name="eye-off-outline" size={18} color={theme.textSecondary} />
                <T style={{ flex: 1 }}>{b.name}</T>
                <Button kind="quiet" label="Show again" onPress={() => user && unblockAuthor(user.uid, b.id)} />
              </Row>
            </Card>
          ))}
        </>
      )}

      <T variant="label">About</T>
      <Link icon="information-circle-outline" label="How UCS works" href="/about" />
      <Link icon="trash-bin-outline" label="Removal log" href="/removals" />
      <Link icon="shield-checkmark-outline" label="Privacy policy" href="/privacy" />
      <Link icon="document-text-outline" label="Terms of use" href="/terms" />
    </Screen>
  );
}
