import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { signOut } from 'firebase/auth';
import { collection, documentId, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ConfirmEmail } from '@/components/email-status';
import { NameChanger } from '@/components/name-changer';
import { showAlert } from '@/components/point-card';
import { Button, Card, Chip, Empty, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText } from '@/lib/api';
import { unblockAuthor, useBlockedAuthors } from '@/lib/blocks';
import { auth, db } from '@/lib/firebase';
import { timeAgo, useCollection } from '@/lib/hooks';
import { useJustPosted } from '@/lib/just-posted';
import { isOperator } from '@/lib/operator';
import { type AppearancePref, setAppearance, useAppearancePref } from '@/lib/appearance';
import type { MyThread, Notification, Submission } from '@/lib/types';

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

/** What one of your complaints has gathered, at a glance: people with its issues and the votes on it. */
function Gathered({ people, loves, easy }: { people: number; loves: number; easy: number }) {
  const theme = useTheme();
  const bits = [
    people > 1 ? `⬆ ${people.toLocaleString('en-US')} have this` : null,
    loves > 0 ? `🤬 ${loves.toLocaleString('en-US')} Best rant` : null,
    easy > 0 ? `🍋 ${easy.toLocaleString('en-US')} Easy peasy` : null,
  ].filter(Boolean);
  if (bits.length === 0) return null;
  return (
    <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
      {bits.join('  ·  ')}
    </T>
  );
}

/** Complaints shown before "Show all". */
const RECENT = 3;

/** One of my complaints, public or private: the same row either way. */
type Mine = {
  key: string;
  isPrivate: boolean;
  text: string;
  /** Who or what it is about. */
  about: string;
  at: number;
  href: Href;
  unread?: boolean;
  resolved?: boolean;
  /** What it has gathered: people who have its issues, Best rant and Easy peasy votes. */
  people?: number;
  loves?: number;
  easy?: number;
};

/**
 * Right after posting without an account: the complaint is live either way,
 * and signing in is what keeps the history. Said once per post, and easy to
 * wave off.
 */
function KeepItPrompt({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.scrim }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          onPress={() => {}}>
          <T variant="heading">Want to keep your history?</T>
          <T>It&apos;s up, no account needed. Sign in to keep your complaints with you on any phone.</T>
          <Button
            label="Sign in"
            onPress={() => {
              onClose();
              router.push('/account');
            }}
          />
          <Button label="Not now" kind="quiet" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function MeScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  // Set when arriving straight from posting: that complaint is marked and scrolled to.
  const posted = useJustPosted();
  const scrollRef = useRef<ScrollView>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const blocked = useBlockedAuthors();
  const unread = useCollection<Notification>(
    user ? query(collection(db, `users/${user.uid}/notifications`), where('read', '==', false), limit(50)) : null,
    `unread:${user?.uid}`,
  );
  const mine = useCollection<{ id: string }>(
    user ? query(collection(db, `users/${user.uid}/mine`), orderBy('at', 'desc'), limit(30)) : null,
    `mine:${user?.uid}`,
  );
  const threads = useCollection<MyThread>(
    user ? query(collection(db, `users/${user.uid}/threads`), orderBy('lastMessageAt', 'desc'), limit(30)) : null,
    `threads:${user?.uid}`,
  );
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  // How many people have each issue they raise (the most, per complaint).
  const [support, setSupport] = useState<Map<string, number>>(new Map());
  const ids = mine.items.map((m) => m.id).join(',');

  useEffect(() => {
    const list = ids ? ids.split(',') : [];
    if (list.length === 0) return;
    // `in` takes at most 30 ids, which is the page size above.
    getDocs(query(collection(db, 'submissions'), where('removed', '==', false), where(documentId(), 'in', list)))
      .then(async (snap) => {
        const byId = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as Submission]));
        const subs = list.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
        setSubmissions(subs);
        const pointIds = [...new Set(subs.flatMap((s) => [...s.matchedPointIds, ...s.addedPointIds]))];
        const counts = new Map<string, number>();
        for (let i = 0; i < pointIds.length; i += 30) {
          const points = await getDocs(query(collection(db, 'points'), where(documentId(), 'in', pointIds.slice(i, i + 30))));
          for (const p of points.docs) counts.set(p.id, (p.get('supportCount') as number | undefined) ?? 0);
        }
        setSupport(counts);
      })
      .catch(() => setSubmissions([]));
  }, [ids]);

  // Public and private complaints are one list, newest activity first:
  // they are all "what I complained about", told apart by one small label.
  const complaints: Mine[] = [
    ...(ids ? submissions : []).map((s) => ({
      key: `s:${s.id}`,
      isPrivate: false,
      text: s.text,
      about: s.subjectNames.join(' · '),
      at: s.createdAt?.toMillis() ?? 0,
      href: `/submission/${s.id}` as Href,
      people: Math.max(0, ...[...s.matchedPointIds, ...s.addedPointIds].map((id) => support.get(id) ?? 0)),
      loves: s.loves ?? 0,
      easy: s.easy ?? 0,
    })),
    ...threads.items.map((t) => ({
      key: `t:${t.id}`,
      isPrivate: true,
      text: t.preview,
      about: t.orgName,
      at: t.lastMessageAt?.toMillis() ?? 0,
      href: `/thread/${t.orgId}/${t.id}` as Href,
      unread: t.unread,
      resolved: t.status === 'resolved',
    })),
  ].sort((a, b) => b.at - a.at);
  // The latest three, then "Show all". The one just posted is always among them.
  const first = complaints.slice(0, RECENT);
  const shown =
    showAll || complaints.length <= RECENT
      ? complaints
      : posted && !first.some((c) => c.key === `s:${posted}`)
        ? [...first, ...complaints.filter((c) => c.key === `s:${posted}`)]
        : first;
  const responder = (profile?.responderFor ?? []).length > 0;
  const anonymous = !!user?.isAnonymous;
  return (
    <Screen topInset scrollRef={scrollRef}>
      <KeepItPrompt
        visible={!!posted && anonymous && answered !== posted}
        onClose={() => setAnswered(posted ?? null)}
      />
      <NameChanger name={profile?.displayName ?? 'You'} />
      <T variant="small">{anonymous ? 'Not signed in.' : user?.email}</T>
      {anonymous && <Button label="Sign in or sign up" onPress={() => router.push('/account')} />}
      <ConfirmEmail />

      {/* What they complained about comes first; the settings are below it. */}
      <T variant="label">Your complaints</T>
      {complaints.length === 0 ? (
        <Empty text="Nothing here yet." loading={mine.loading || threads.loading} />
      ) : (
        shown.map((c) => {
          const fresh = c.key === `s:${posted}`;
          return (
            <View
              key={c.key}
              // The one they just posted is brought into view. It is only a mark: the row works as any other.
              onLayout={
                fresh
                  ? (e) => scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 120), animated: true })
                  : undefined
              }>
              <Card
                onPress={() => router.push(c.href)}
                style={fresh ? { borderWidth: 1.5, borderColor: theme.primary } : undefined}>
                <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                  <Ionicons name={c.isPrivate ? 'lock-closed' : 'earth'} size={14} color={theme.textSecondary} />
                  <T variant="small" style={{ flex: 1 }}>
                    {c.isPrivate ? 'Private' : 'Public'} · {timeAgo(c.at)}
                  </T>
                  {fresh && <Chip label="Just posted" color={theme.primary} bg={theme.primarySoft} />}
                  {c.unread && <Chip label="New reply" color={theme.primary} bg={theme.primarySoft} />}
                  {c.resolved && <Chip label="Resolved" color={theme.good} bg={theme.goodSoft} />}
                </Row>
                <T numberOfLines={3}>{c.text}</T>
                {c.about ? <T variant="small">{c.about}</T> : null}
                {!c.isPrivate && <Gathered people={c.people ?? 0} loves={c.loves ?? 0} easy={c.easy ?? 0} />}
              </Card>
            </View>
          );
        })
      )}
      {complaints.length > shown.length && (
        <Button
          label={`Show all ${complaints.length} complaints`}
          kind="quiet"
          onPress={() => setShowAll(true)}
        />
      )}

      <Link
        icon="notifications-outline"
        label="Notifications"
        detail={unread.items.length ? `${unread.items.length} new` : undefined}
        href="/notifications"
      />
      <AppearancePicker />
      <Link
        icon="briefcase-outline"
        label={responder ? 'Respond for your organization' : 'Work somewhere? Respond for it'}
        href={responder ? '/company' : '/company/claim'}
      />
      {isOperator(user) && <Link icon="shield-half-outline" label="Operator queue" href="/operator" />}

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

      {!anonymous && (
        <Button
          label="Sign out"
          kind="secondary"
          onPress={() => signOut(auth).catch((e) => showAlert("Couldn't sign out", errorText(e)))}
        />
      )}
      {/* Help, which notifications to get, the rules, and deleting an account: one tap further in. */}
      <Link icon="settings-outline" label="Settings" href="/more" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Dimmed enough that the page reads as background: a sheet's words must never run into the page's.
  backdrop: { flex: 1, justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 18, borderWidth: 1, padding: 22, gap: 14, width: '100%', maxWidth: 420, alignSelf: 'center' },
});
