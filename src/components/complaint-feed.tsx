import { useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Row, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBlockedAuthors } from '@/lib/blocks';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection } from '@/lib/hooks';
import type { Submission } from '@/lib/types';

/**
 * Lists of complaints themselves (people's words), for the Complaints tab and
 * the organization and topic pages: Hot and New. People over imports: a
 * complaint a person wrote always comes before an imported public record.
 */

const WEEK_MS = 7 * 24 * 3600_000;
/** Below this many ranked complaints, Hot is topped up with the newest ones people wrote. */
const ENOUGH = 10;

/**
 * Mirror of `hotRankOf` in functions/src/points.ts, for complaints posted
 * since the last 6-hourly pass (they have no `hotRank` yet). The support of
 * their issues isn't known here, so it counts as none until the pass.
 */
function hotRankOf(s: Submission, now: number) {
  const engagement = (s.loves ?? 0) * 10 + (s.easy ?? 0) * 5;
  const created = s.createdAt?.toMillis() ?? now;
  return (s.source ? 0 : 1_000_000) + Math.log10(1 + engagement) + created / 1000 / 36_000;
}

function base(subjectId?: string): QueryConstraint[] {
  return [where('removed', '==', false), ...(subjectId ? [where('subjectIds', 'array-contains', subjectId)] : [])];
}

/** Hot: ranked by what people did with them against how new they are (the last 7 days). */
/** A complaint kept without its words (its author deleted their account) isn't listed: there is nothing to read. */
const hasWords = (s: Submission) => s.text !== '[deleted]';

export function useHotComplaints(subjectId: string | undefined, count: number, on = true) {
  const subs = collection(db, 'submissions');
  // When the list was opened: what counts as the last 7 days.
  const [now] = useState(() => Date.now());
  const ranked = useCollection<Submission>(
    on ? query(subs, ...base(subjectId), where('hotRank', '>', 0), orderBy('hotRank', 'desc'), limit(count)) : null,
    `hot:${subjectId ?? ''}:${count}`,
  );
  // People's newest, so a complaint posted since the last pass shows up at once.
  const fresh = useCollection<Submission>(
    on ? query(subs, ...base(subjectId), where('source', '==', null), orderBy('createdAt', 'desc'), limit(30)) : null,
    `hot-fresh:${subjectId ?? ''}`,
  );
  const byId = new Map<string, { s: Submission; rank: number }>();
  for (const s of ranked.items) byId.set(s.id, { s, rank: s.hotRank ?? 0 });
  for (const s of fresh.items) {
    const recent = now - (s.createdAt?.toMillis() ?? now) < WEEK_MS;
    if (!byId.has(s.id) && !(s.hotRank ?? 0) && recent) byId.set(s.id, { s, rank: hotRankOf(s, now) });
  }
  let items = [...byId.values()]
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.s)
    .filter(hasWords);
  // Never empty while anyone has written something: top up with the newest people wrote.
  if (items.length < ENOUGH) {
    const have = new Set(items.map((s) => s.id));
    items = [...items, ...fresh.items.filter((s) => !have.has(s.id) && hasWords(s))].slice(
      0,
      Math.max(items.length, ENOUGH),
    );
  }
  return { items, loading: ranked.loading || fresh.loading, more: ranked.items.length >= count };
}

/** New: what people wrote, newest first; the imported public records only after them. */
export function useNewComplaints(subjectId: string | undefined, count: number, on = true) {
  const subs = collection(db, 'submissions');
  const people = useCollection<Submission>(
    on ? query(subs, ...base(subjectId), where('source', '==', null), orderBy('createdAt', 'desc'), limit(count)) : null,
    `new-people:${subjectId ?? ''}:${count}`,
  );
  const needAll = on && !people.loading && people.items.length < count;
  const all = useCollection<Submission>(
    needAll ? query(subs, ...base(subjectId), orderBy('createdAt', 'desc'), limit(count)) : null,
    `new-all:${subjectId ?? ''}:${count}`,
  );
  const items = [...people.items, ...all.items.filter((s) => !!s.source)].filter(hasWords);
  return {
    items,
    loading: people.loading || (needAll && all.loading),
    more: people.items.length >= count || all.items.length >= count,
  };
}

/**
 * A complaint in its author's words, with what people did with it. `kind`
 * picks the corner: a rant's heat, how easy it looks to fix, its votes (Hot),
 * or when it was posted (New).
 */
export function ComplaintCard({
  s,
  rank,
  kind,
}: {
  s: Submission;
  rank?: number;
  kind: 'rant' | 'easy' | 'hot' | 'new';
}) {
  const theme = useTheme();
  const router = useRouter();
  const loves = s.loves ?? 0;
  const easy = s.easy ?? 0;
  const blocked = useBlockedAuthors();
  const hidden = !!s.authorId && blocked.ids.has(s.authorId);
  const accent = kind === 'easy' ? theme.good : kind === 'rant' ? theme.rant : theme.textSecondary;
  const votes = [loves > 0 ? `🤬 ${loves.toLocaleString()}` : '', easy > 0 ? `🍋 ${easy.toLocaleString()}` : '']
    .filter(Boolean)
    .join('  ');
  return (
    <Pressable
      onPress={() => router.push(`/submission/${s.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        {rank ? (
          <Text style={[styles.rank, { color: accent }]}>#{rank}</Text>
        ) : (
          <T variant="small">{timeAgo(s.createdAt?.toMillis())}</T>
        )}
        {kind === 'easy' ? (
          <Text style={[styles.corner, { color: theme.good }]}>🍋 {easy.toLocaleString()}</Text>
        ) : kind === 'rant' ? (
          loves > 0 ? (
            <Text style={[styles.corner, { color: theme.rant }]}>🤬 {loves.toLocaleString()}</Text>
          ) : (
            <Text style={[styles.corner, { color: theme.new }]}>✨ Model&apos;s pick · {s.rantScore ?? 0}/10</Text>
          )
        ) : votes ? (
          <Text style={[styles.corner, { color: theme.text }]}>{votes}</Text>
        ) : rank ? (
          <T variant="small">{timeAgo(s.createdAt?.toMillis())}</T>
        ) : null}
      </Row>
      {hidden ? (
        <T variant="small">Hidden by you. Tap to open it anyway.</T>
      ) : (
        <Text style={[styles.text, { color: theme.text }]} numberOfLines={8}>
          {s.text}
        </Text>
      )}
      <T variant="small" numberOfLines={1}>
        {hidden ? '' : `${s.source ? `Public record · ${s.source.shortName}` : s.authorName} · `}
        {s.subjectNames.slice(0, 3).join(' · ')}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 16, gap: 10 },
  rank: { fontFamily: Fonts.display, fontSize: 20 },
  corner: { fontFamily: Fonts.bold, fontSize: 14 },
  text: { fontFamily: Fonts.medium, fontSize: 19, lineHeight: 26 },
});
