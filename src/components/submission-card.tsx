import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { doc, onSnapshot } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { Alert, Animated, Linking, Platform, Pressable, StyleSheet, Text } from 'react-native';

import { showAlert } from '@/components/point-card';
import { ReportButton } from '@/components/report';
import { showToast } from '@/components/toast';
import { Card, Chip, Notice, Row, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, loveRant } from '@/lib/api';
import { blockAuthor, unblockAuthor, useBlockedAuthors } from '@/lib/blocks';
import { db, storage } from '@/lib/firebase';
import { tapHaptic } from '@/lib/haptics';
import { timeAgo } from '@/lib/hooks';
import type { Submission } from '@/lib/types';

export function PublicPhoto({ path, size = 96 }: { path: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    getDownloadURL(ref(storage, path)).then(setUrl, () => setUrl(null));
  }, [path]);
  if (!url) return null;
  return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 10 }} contentFit="cover" />;
}

/**
 * "Best rant": I love this one as a read. Separate from supporting the point
 * (the up arrow, "I have this problem too"). Shown before the server confirms.
 */
export function BestRantButton({ submissionId, count }: { submissionId: string; count: number }) {
  const theme = useTheme();
  const { user } = useAuth();
  const [mine, setMine] = useState<boolean | null>(null);
  const [pending, setPending] = useState<boolean | null>(null);
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, `submissions/${submissionId}/loves/${user.uid}`),
      (d) => setMine(d.exists()),
      () => setMine(false),
    );
  }, [submissionId, user]);

  const on = pending ?? mine ?? false;
  const shown = Math.max(0, count + (pending === null || pending === mine ? 0 : pending ? 1 : -1));
  const toggle = async () => {
    const next = !on;
    setPending(next);
    if (next) {
      tapHaptic();
      scale.setValue(0.94);
      Animated.spring(scale, { toValue: 1, friction: 3, tension: 240, useNativeDriver: Platform.OS !== 'web' }).start();
    }
    try {
      await loveRant({ submissionId, love: next });
    } catch (e) {
      showToast("That didn't save", errorText(e));
    } finally {
      setPending(null);
    }
  };
  const ink = on ? theme.background : theme.rant;
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={
          on
            ? `You voted this a best rant. ${shown} so far. Tap to take it back.`
            : `Vote this a best rant. ${shown} so far.`
        }
        style={({ pressed }) => [
          styles.love,
          { backgroundColor: on ? theme.rant : theme.rantSoft, opacity: pressed ? 0.85 : 1 },
        ]}>
        <Text style={styles.loveEmoji}>🤬</Text>
        <Text style={[styles.loveLabel, { color: ink }]}>Best rant</Text>
        {shown > 0 && <Text style={[styles.loveCount, { color: ink }]}>{shown.toLocaleString()}</Text>}
      </Pressable>
    </Animated.View>
  );
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
  const { user } = useAuth();
  const [original, setOriginal] = useState(false);
  const [opened, setOpened] = useState(false);
  const blocked = useBlockedAuthors();
  const translated = !!s.englishText;
  const source = s.source;
  const hidden = !!s.authorId && blocked.ids.has(s.authorId);
  const loves = s.loves ?? 0;

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
        {source && <Chip label={`Public record · ${source.shortName}`} color={theme.textSecondary} bg={theme.background} />}
        {s.tone === 'rant' && <Chip label="🔥 Rant" color={theme.rant} bg={theme.rantSoft} />}
        {addedPoint && <Chip label="Model added this point from it" color={theme.new} bg={theme.newSoft} />}
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
          <ReportButton target={{ kind: 'submission', id: s.id }} compact />
          {user && s.authorId && (
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
    gap: 8,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  loveEmoji: { fontSize: 18 },
  loveLabel: { fontFamily: Fonts.bold, fontSize: 16 },
  loveCount: { fontFamily: Fonts.medium, fontSize: 16 },
  icon: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
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
