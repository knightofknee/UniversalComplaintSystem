import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { collection, documentId, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState, type ComponentProps } from 'react';

import { Card, Empty, Row, Screen, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection } from '@/lib/hooks';
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

export default function MeScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
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
          ? 'No account: complaints from this device are yours. Add an email to keep them on every device.'
          : user?.email}
      </T>
      <Link
        icon="notifications-outline"
        label="Notifications"
        detail={unread.items.length ? `${unread.items.length} new` : undefined}
        href="/notifications"
      />
      <Link icon="person-circle-outline" label={user?.isAnonymous ? 'Add an email' : 'Account'} href="/account" />
      {responder && <Link icon="briefcase-outline" label="Respond for your organization" href="/company" />}
      <Link icon="business-outline" label="Respond for an organization" href="/company/claim" />

      <T variant="label">Your complaints</T>
      {shown.length === 0 ? (
        <Empty text="Nothing yet." loading={mine.loading} />
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

      <T variant="label">About</T>
      <Link icon="information-circle-outline" label="How UCS works" href="/about" />
      <Link icon="trash-bin-outline" label="Removal log" href="/removals" />
    </Screen>
  );
}
