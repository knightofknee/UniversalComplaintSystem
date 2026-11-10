import { Ionicons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ReportButton } from '@/components/report';
import { TermsCheck, useTermsAccepted } from '@/components/terms-check';
import { showToast } from '@/components/toast';
import { Button, Card, Field, Row, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, proposeFix, rateFix, type FixRating } from '@/lib/api';
import { useBlockedAuthors } from '@/lib/blocks';
import { db } from '@/lib/firebase';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { timeAgo, useCollection } from '@/lib/hooks';
import type { Solution } from '@/lib/types';

const RATINGS: { key: FixRating; label: string }[] = [
  { key: 'full', label: 'Fixed it' },
  { key: 'partial', label: 'Partly' },
  { key: 'none', label: "Didn't" },
];

/**
 * Fixes anyone proposed for a point (an organization, or someone who found a
 * way around it). The people who have the problem say whether each one
 * worked: fully, partly, or not at all. `supported` is whether the reader is
 * one of them.
 */
export function Solutions({ pointId, supported }: { pointId: string; supported: boolean }) {
  const { profile } = useAuth();
  const { items } = useCollection<Solution>(
    query(collection(db, `points/${pointId}/solutions`), where('removed', '==', false), orderBy('createdAt', 'asc')),
    `solutions:${pointId}`,
  );
  const [writing, setWriting] = useState(false);
  // A fix's id is its proposer's public author id: one per person per point.
  const mine = items.some((s) => s.id === profile?.authorId);
  return (
    <>
      {items.length > 0 && <T variant="label">Proposed fixes</T>}
      {items.map((s) => (
        <SolutionCard key={s.id} pointId={pointId} s={s} supported={supported} />
      ))}
      {writing ? (
        <ProposeBox pointId={pointId} onDone={() => setWriting(false)} />
      ) : (
        !mine && <Button kind="secondary" icon="construct-outline" label="Propose a fix" onPress={() => setWriting(true)} />
      )}
    </>
  );
}

function ProposeBox({ pointId, onDone }: { pointId: string; onDone: () => void }) {
  const termsAccepted = useTermsAccepted();
  const [agreed, setAgreed] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const post = async () => {
    setBusy(true);
    try {
      await proposeFix({ pointId, text: text.trim(), ...(agreed ? { acceptTerms: true } : {}) });
      successHaptic();
      onDone();
    } catch (e) {
      showToast("Couldn't post the fix", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <T variant="label">Propose a fix</T>
      <T variant="small">
        What fixes this, or gets around it. It is public. The people who have the problem are told and say if it worked.
      </T>
      <Field multiline autoFocus value={text} onChangeText={setText} placeholder="The fix" maxLength={1000} />
      <TermsCheck checked={agreed} onChange={setAgreed} compact />
      <Row>
        <Button label="Cancel" kind="quiet" onPress={onDone} style={{ flex: 1 }} />
        <Button
          label="Post"
          onPress={post}
          busy={busy}
          disabled={text.trim().length < 10 || (!termsAccepted && !agreed)}
          style={{ flex: 1 }}
        />
      </Row>
    </Card>
  );
}

function SolutionCard({ pointId, s, supported }: { pointId: string; s: Solution; supported: boolean }) {
  const theme = useTheme();
  const { user, profile } = useAuth();
  const blocked = useBlockedAuthors();
  const [opened, setOpened] = useState(false);
  const [mine, setMine] = useState<FixRating | null>(null);
  // What was just tapped, shown until the server's count and vote both catch up (see useVote).
  const [held, setHeld] = useState<{ rating: FixRating | null; counts: Record<FixRating, number> } | null>(null);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, `points/${pointId}/solutions/${s.id}/ratings/${user.uid}`),
      (d) => setMine(d.exists() ? (d.get('rating') as FixRating) : null),
      () => setMine(null),
    );
  }, [pointId, s.id, user]);

  const rating = held ? held.rating : mine;
  const counts = held?.counts ?? { full: s.full, partial: s.partial, none: s.none };
  const rate = async (key: FixRating) => {
    const next = rating === key ? null : key;
    const after = { ...counts };
    if (rating) after[rating] = Math.max(0, after[rating] - 1);
    if (next) after[next] += 1;
    const hold = { rating: next, counts: after };
    setHeld(hold);
    tapHaptic();
    let settle = 1500;
    try {
      const res = await rateFix({ pointId, fixId: s.id, rating: next });
      if (res.status === 'fixed') successHaptic();
    } catch (e) {
      settle = 0;
      showToast("That didn't save", errorText(e));
    }
    setTimeout(() => setHeld((h) => (h === hold ? null : h)), settle);
  };

  // An author the reader hid: folded shut, no name until opened (as complaints are).
  if (blocked.ids.has(s.authorId) && !opened) {
    return (
      <Pressable
        onPress={() => setOpened(true)}
        accessibilityRole="button"
        accessibilityLabel="A proposed fix by an author you hid. Tap to show it."
        style={[styles.folded, { borderColor: theme.border }]}>
        <Ionicons name="eye-off-outline" size={16} color={theme.textSecondary} />
        <T variant="small" style={{ flex: 1 }}>
          Hidden by you
        </T>
        <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
          Show
        </T>
      </Pressable>
    );
  }
  const own = s.id === profile?.authorId;
  const total = counts.full + counts.partial + counts.none;
  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: theme.good }}>
      <Row style={{ flexWrap: 'wrap' }}>
        <T variant="small" style={{ fontWeight: '700' }}>
          {s.authorName}
        </T>
        <T variant="small">{timeAgo(s.createdAt?.toMillis())}</T>
      </Row>
      <T>{s.text}</T>
      {supported && !own ? (
        <>
          <T variant="small">Did it fix this for you?</T>
          <Row style={{ gap: 8 }}>
            {RATINGS.map((r) => {
              const on = rating === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => rate(r.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${r.label}. ${counts[r.key]} so far.`}
                  style={({ pressed }) => [
                    styles.rate,
                    {
                      backgroundColor: on ? theme.primaryFill : theme.background,
                      borderColor: on ? theme.primaryFill : theme.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}>
                  <Text style={[styles.rateLabel, { color: on ? theme.onPrimary : theme.text }]}>{r.label}</Text>
                  <Text style={[styles.rateCount, { color: on ? theme.onPrimary : theme.textSecondary }]}>
                    {counts[r.key]}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </>
      ) : (
        <T variant="small">
          {total > 0
            ? `${counts.full} fixed it · ${counts.partial} partly · ${counts.none} didn't`
            : own
              ? 'Waiting for the people who have this problem to say if it worked.'
              : 'Have this problem? Tap the arrow up top, then say if this worked.'}
        </T>
      )}
      {!own && <ReportButton target={{ kind: 'solution', id: s.id, pointId }} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  rate: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  rateLabel: { fontFamily: Fonts.bold, fontSize: 14 },
  rateCount: { fontFamily: Fonts.medium, fontSize: 13 },
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
