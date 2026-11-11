import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { doc, onSnapshot } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { Alert, Animated, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { showAlert } from '@/components/point-card';
import { ReportButton } from '@/components/report';
import { showToast } from '@/components/toast';
import { Button, Card, Chip, Field, Notice, Row, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { addDetail, deleteComplaint, easyFix, errorText, loveRant } from '@/lib/api';
import { blockAuthor, unblockAuthor, useBlockedAuthors } from '@/lib/blocks';
import { db, storage } from '@/lib/firebase';
import { tapHaptic } from '@/lib/haptics';
import { timeAgo, useDoc, useVote } from '@/lib/hooks';
import type { Submission } from '@/lib/types';

export function PublicPhoto({ path, size = 96 }: { path: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    getDownloadURL(ref(storage, path)).then(setUrl, () => setUrl(null));
  }, [path]);
  const [open, setOpen] = useState(false);
  if (!url) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Open photo">
        <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 10 }} contentFit="cover" />
      </Pressable>
      {/* Tap anywhere to close: a photo is something to look at, then put away. */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(false)} accessibilityLabel="Close photo">
          <Image source={{ uri: url }} style={styles.viewerImage} contentFit="contain" />
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * A wide vote on a complaint, shown before the server confirms. Two of them
 * sit side by side on every card a person wrote: "Best rant" and "Easy peasy".
 */
function CardVote({
  path,
  count,
  send,
  emoji,
  label,
  color,
  soft,
  says,
  onOwn,
}: {
  /** Where the reader's own vote lives (private, readable only by them). */
  path: string;
  count: number;
  send: (on: boolean) => Promise<unknown>;
  emoji: string;
  label: string;
  color: string;
  soft: string;
  /** Screen readers: what the vote means. */
  says: string;
  /** Set on the author's own complaint when they can't vote on it: what a tap says. */
  onOwn?: string;
}) {
  const theme = useTheme();
  const { user } = useAuth();
  const [mine, setMine] = useState<boolean | null>(null);
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!user || onOwn) return;
    return onSnapshot(
      doc(db, `${path}/${user.uid}`),
      (d) => setMine(d.exists()),
      () => setMine(false),
    );
  }, [path, user, onOwn]);

  const vote = useVote(onOwn ? false : mine, count, send);
  const { on, shown } = vote;
  const toggle = () => {
    if (onOwn) {
      showToast(onOwn, undefined, 'info');
      return;
    }
    if (!on) {
      tapHaptic();
      scale.setValue(0.94);
      Animated.spring(scale, { toValue: 1, friction: 3, tension: 240, useNativeDriver: Platform.OS !== 'web' }).start();
    }
    void vote.toggle();
  };
  const ink = on ? theme.background : color;
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={on ? `You voted ${label}: ${says}. ${shown} so far. Tap to take it back.` : `${label}: ${says}. ${shown} so far.`}
        style={({ pressed }) => [styles.love, { backgroundColor: on ? color : soft, opacity: pressed ? 0.85 : 1 }]}>
        <Text style={styles.loveEmoji}>{emoji}</Text>
        <Text style={[styles.loveLabel, { color: ink }]} numberOfLines={1}>
          {label}
        </Text>
        {shown > 0 && <Text style={[styles.loveCount, { color: ink }]}>{shown.toLocaleString()}</Text>}
      </Pressable>
    </Animated.View>
  );
}

/**
 * "Best rant": I love this one as a read. Separate from supporting the issue
 * (the up arrow, "I have this too").
 */
export function BestRantButton({ submissionId, count }: { submissionId: string; count: number }) {
  const theme = useTheme();
  return (
    <CardVote
      path={`submissions/${submissionId}/loves`}
      count={count}
      send={(love) => loveRant({ submissionId, love })}
      emoji="🤬"
      label="Best rant"
      color={theme.rant}
      soft={theme.rantSoft}
      says="a great read"
    />
  );
}

/**
 * "Easy peasy": from what its author says, this looks easy to fix. Feeds the
 * Easiest list. Someone else's call: an author can't vote on their own.
 */
export function EasyPeasyButton({ submissionId, count, own }: { submissionId: string; count: number; own: boolean }) {
  const theme = useTheme();
  return (
    <CardVote
      path={`submissions/${submissionId}/easy`}
      count={count}
      send={(easy) => easyFix({ submissionId, easy })}
      emoji="🍋"
      label="Easy peasy"
      color={theme.good}
      soft={theme.goodSoft}
      says="this looks easy to fix"
      onOwn={own ? 'Other people decide whether yours is easy to fix.' : undefined}
    />
  );
}

/**
 * On your own complaint, and only for you: what the model thought was
 * missing when you posted (the make and model of a product, which store,
 * when). Suggestions, never required: answer one in a line and it is added
 * under the complaint, or wave it away.
 */
/** The last row: a detail nobody suggested. */
const OTHER = 'Something else';

function MissingDetails({ uid, submissionId }: { uid: string; submissionId: string }) {
  const theme = useTheme();
  const { data } = useDoc<{ missing?: string[] }>(`users/${uid}/mine/${submissionId}`);
  const [answering, setAnswering] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const missing = data?.missing ?? [];
  // Shown once the list has loaded, even when it is empty: there is always "something else".
  if (!data) return null;
  const send = async (item: string, detail?: string) => {
    setBusy(item);
    try {
      const res = await addDetail({ submissionId, ...(item === OTHER ? {} : { item }), ...(detail ? { text: detail } : {}) });
      setAnswering(null);
      setText('');
      // The model read the complaint again with the detail in it.
      if (res.filedUnder.length) showToast('Added', `Now also filed under ${res.filedUnder.join(', ')}.`, 'info');
    } catch (e) {
      showToast("That didn't save", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={[styles.missing, { borderColor: theme.border }]}>
      <T variant="label">{missing.length ? 'Potentially missing' : 'Add to it'}</T>
      <T variant="small">
        Optional, and only you see this. What you add shows under your complaint, and it is read again so it is filed
        and worded to match.
      </T>
      {[...missing, OTHER].map((m) =>
        answering === m ? (
          <View key={m} style={{ gap: 8 }}>
            <Field
              autoFocus
              value={text}
              onChangeText={setText}
              placeholder={m === OTHER ? 'One more detail' : m}
              maxLength={200}
            />
            {busy === m && <T variant="small">Reading your complaint again with this in it…</T>}
            <Row>
              <Button
                label="Cancel"
                kind="quiet"
                onPress={() => {
                  setAnswering(null);
                  setText('');
                }}
                style={{ flex: 1 }}
              />
              <Button
                label="Add"
                onPress={() => send(m, text.trim())}
                busy={busy === m}
                disabled={text.trim().length < 2}
                style={{ flex: 1 }}
              />
            </Row>
          </View>
        ) : (
          <Row key={m} style={{ gap: 6 }}>
            <Pressable
              onPress={() => {
                setAnswering(m);
                setText('');
              }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${m}`}
              style={({ pressed }) => [styles.missingRow, pressed && { opacity: 0.7 }]}>
              <Ionicons name="add-circle-outline" size={18} color={theme.primary} />
              <T style={{ flex: 1 }}>{m.charAt(0).toUpperCase() + m.slice(1)}</T>
            </Pressable>
            {m !== OTHER && (
              <Pressable
                onPress={() => send(m)}
                disabled={busy === m}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss: ${m}`}
                hitSlop={8}
                style={styles.dismiss}>
                <Ionicons name="close" size={18} color={theme.textSecondary} />
              </Pressable>
            )}
          </Row>
        ),
      )}
    </View>
  );
}

function confirmDelete(onYes: () => void) {
  const title = 'Delete this complaint?';
  const msg = "Its words and photos are removed, and the support it gave is withdrawn. This can't be undone.";
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${msg}`)) onYes();
    return;
  }
  Alert.alert(title, msg, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onYes },
  ]);
}

function confirmHide(name: string, onYes: () => void) {
  const msg = `Complaints by ${name} get folded shut: you'll see that one is there and can open it if you want. They won't know. Undo it in Me > Hidden authors.`;
  if (Platform.OS === 'web') {
    if (window.confirm(msg)) onYes();
    return;
  }
  Alert.alert(`Hide ${name}?`, msg, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Hide', style: 'destructive', onPress: onYes },
  ]);
}

/** One person's complaint, in their own words (and in English if they wrote another language). */
export function SubmissionCard({ s, addedPoint }: { s: Submission; addedPoint?: boolean }) {
  const theme = useTheme();
  const { user, profile } = useAuth();
  const [original, setOriginal] = useState(false);
  const [opened, setOpened] = useState(false);
  const blocked = useBlockedAuthors();
  const translated = !!s.englishText;
  const source = s.source;
  const hidden = !!s.authorId && blocked.ids.has(s.authorId);
  const loves = s.loves ?? 0;
  const own = !!s.authorId && s.authorId === profile?.authorId;

  // An author you hid: folded shut, never gone. You can still see that
  // someone you hid weighed in, and open it if this is the one time you want
  // to know. No name until it is opened: the name is part of what was hidden.
  if (hidden && !opened) {
    return (
      <Pressable
        onPress={() => setOpened(true)}
        accessibilityRole="button"
        accessibilityLabel="A complaint by an author you hid. Tap to show it."
        style={({ pressed }) => [styles.folded, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
        <Ionicons name="eye-off-outline" size={16} color={theme.textSecondary} />
        <T variant="small" numberOfLines={1} style={{ flex: 1 }}>
          Hidden by you
        </T>
        <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
          Show
        </T>
      </Pressable>
    );
  }
  return (
    <Card>
      <Row style={{ flexWrap: 'wrap' }}>
        <T variant="small" style={{ fontWeight: '700' }}>
          {s.authorName}
        </T>
        <T variant="small">{timeAgo(s.createdAt?.toMillis())}</T>
        {own && <Chip label="Yours" color={theme.primary} bg={theme.primarySoft} />}
        {source && <Chip label={`Public record · ${source.shortName}`} color={theme.textSecondary} bg={theme.background} />}
        {s.tone === 'rant' && <Chip label="🔥 Rant" color={theme.rant} bg={theme.rantSoft} />}
        {addedPoint && <Chip label="Model added this issue from it" color={theme.new} bg={theme.newSoft} />}
        {s.rewritten && <Chip label="Clearer version" color={theme.textSecondary} bg={theme.background} />}
      </Row>
      <T>{translated && !original ? s.englishText : s.text}</T>
      {translated && (
        <Pressable onPress={() => setOriginal((o) => !o)} accessibilityRole="button" hitSlop={8}>
          <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
            {original ? 'Show English translation' : `Translated from "${s.language}" · show original`}
          </T>
        </Pressable>
      )}
      {source && (
        <Notice>
          {source.orgReply && <T variant="small">{source.orgReply}</T>}
          {source.note && <T variant="small">{source.note}</T>}
          <Pressable onPress={() => Linking.openURL(source.url)} accessibilityRole="link" hitSlop={6}>
            <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
              From the {source.name} <Ionicons name="open-outline" size={12} />
            </T>
          </Pressable>
        </Notice>
      )}
      {(s.details ?? []).map((d) => (
        <T key={d} variant="small" color={theme.text}>
          <T variant="small" style={{ fontWeight: '700' }}>
            Added:{' '}
          </T>
          {d}
        </T>
      ))}
      {own && user && <MissingDetails uid={user.uid} submissionId={s.id} />}
      {s.photos.length > 0 && (
        <Row style={{ flexWrap: 'wrap' }}>
          {s.photos.map((p) => (
            <PublicPhoto key={p} path={p} />
          ))}
        </Row>
      )}
      {source ? (
        <ReportButton target={{ kind: 'submission', id: s.id }} />
      ) : (
        <Row style={{ gap: 4 }}>
          <BestRantButton submissionId={s.id} count={loves} />
          <EasyPeasyButton submissionId={s.id} count={s.easy ?? 0} own={own} />
          {own ? (
            <Pressable
              onPress={() =>
                confirmDelete(() =>
                  deleteComplaint({ submissionId: s.id }).then(
                    () => showToast('Complaint deleted', undefined, 'info'),
                    (e) => showToast("Couldn't delete it", errorText(e)),
                  ),
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Delete this complaint"
              hitSlop={6}
              style={styles.icon}>
              <Ionicons name="trash-outline" size={19} color={theme.textSecondary} />
            </Pressable>
          ) : (
            <ReportButton target={{ kind: 'submission', id: s.id }} compact />
          )}
          {user && s.authorId && !own && (
            <Pressable
              onPress={() =>
                hidden
                  ? unblockAuthor(user.uid, s.authorId!).then(
                      () => showToast(`${s.authorName} is no longer hidden`, undefined, 'info'),
                      () => showAlert("Couldn't change that"),
                    )
                  : confirmHide(s.authorName, () =>
                      blockAuthor(user.uid, s.authorId!, s.authorName).then(
                        // Fold it even if it had been opened before.
                        () => setOpened(false),
                        () => showAlert("Couldn't hide them"),
                      ),
                    )
              }
              accessibilityRole="button"
              accessibilityLabel={hidden ? 'Stop hiding this author' : 'Hide this author'}
              hitSlop={6}
              style={styles.icon}>
              <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={19} color={theme.textSecondary} />
            </Pressable>
          )}
        </Row>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  love: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  loveEmoji: { fontSize: 17 },
  loveLabel: { fontFamily: Fonts.bold, fontSize: 15, flexShrink: 1 },
  loveCount: { fontFamily: Fonts.medium, fontSize: 15 },
  icon: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
  missing: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  missingRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  dismiss: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  folded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
