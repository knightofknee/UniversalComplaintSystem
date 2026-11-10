import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { collection, documentId, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { NameChanger } from '@/components/name-changer';
import { showAlert } from '@/components/point-card';
import { Button, Card, Chip, Empty, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText } from '@/lib/api';
import { unblockAuthor, useBlockedAuthors } from '@/lib/blocks';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection } from '@/lib/hooks';
import { isOperator } from '@/lib/operator';
import { type AppearancePref, setAppearance, useAppearancePref } from '@/lib/appearance';
import { pushSupported, turnOffPush, turnOnPush } from '@/lib/push';
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
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={() => {}}>
          <T variant="heading">Your complaint is live.</T>
          <T>
            It is posted without an account. To keep your history, sign in: until then your complaints stay with this
            device only.
          </T>
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
  const { posted } = useLocalSearchParams<{ posted?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const [answered, setAnswered] = useState<string | null>(null);
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
  const responder = (profile?.responderFor ?? []).length > 0;
  const anonymous = !!user?.isAnonymous;
  return (
    <Screen topInset scrollRef={scrollRef}>
      <KeepItPrompt visible={!!posted && anonymous && answered !== posted} onClose={() => setAnswered(posted ?? null)} />
      <NameChanger name={profile?.displayName ?? 'You'} />
      <T variant="small">
        {anonymous ? 'Not signed in. Sign in to keep your history and to send private complaints.' : user?.email}
      </T>
      {anonymous && <Link icon="person-circle-outline" label="Sign in" href="/account" />}
      <Link
        icon="notifications-outline"
        label="Notifications"
        detail={unread.items.length ? `${unread.items.length} new` : undefined}
        href="/notifications"
      />
      <PushSwitch on={!!profile?.pushOn} />
      <AppearancePicker />
      {!anonymous && <Link icon="person-circle-outline" label="Account" href="/account" />}
      <Link
        icon="briefcase-outline"
        label={responder ? 'Respond for your organization' : 'Work somewhere? Respond for it'}
        href={responder ? '/company' : '/company/claim'}
      />
      {isOperator(user) && <Link icon="shield-half-outline" label="Operator queue" href="/operator" />}

      <T variant="label">Your complaints</T>
      {complaints.length === 0 ? (
        <Empty text="Nothing yet." loading={mine.loading || threads.loading} />
      ) : (
        complaints.map((c) => {
          const fresh = c.key === `s:${posted}`;
          return (
          <View
            key={c.key}
            // The one they just posted is brought into view. It is only a mark: the row works as any other.
            onLayout={fresh ? (e) => scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 120), animated: true }) : undefined}>
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
          </Card>
          </View>
          );
        })
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
      <Link icon="close-circle-outline" label="Delete account" href="/delete-account" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 18, padding: 18, gap: 12, width: '100%', maxWidth: 420, alignSelf: 'center' },
});
