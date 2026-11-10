import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PointCard, PointList } from '@/components/point-card';
import { Empty, Row, Screen, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBlockedAuthors } from '@/lib/blocks';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/hooks';
import type { Point, Submission } from '@/lib/types';

type Feed = 'hot' | 'rants' | 'shared' | 'fixed' | 'new';
const LIST = 40;
/**
 * Best rants is readers' votes. Until this many rants have a vote, the list
 * is topped up with ones the model scored this high (1-10, how good a read:
 * vivid, specific, funny), labeled as the model's pick.
 */
const ENOUGH_VOTED = 10;
const MODEL_PICK = 7;

const FEEDS: { key: Feed; label: string; blurb: string; empty: string }[] = [
  { key: 'hot', label: '🔥 Hot', blurb: 'Picking up the most voices this week.', empty: 'Nothing heating up this week. Yet.' },
  { key: 'rants', label: '🤬 Best rants', blurb: 'Voted best by readers. Open one and vote.', empty: 'No great rants yet. Vote for one, or write it.' },
  { key: 'shared', label: '👥 Most shared', blurb: 'The problems the most people have.', empty: "Nothing's broken here yet. Suspicious." },
  { key: 'fixed', label: '✅ Fixed', blurb: 'Fixes the complainers themselves confirmed.', empty: 'Nothing confirmed fixed yet. Organizations, your move.' },
  { key: 'new', label: '🆕 New', blurb: 'Fresh off the record.', empty: 'Quiet. Too quiet.' },
];

/** Complaints: everything people complained about, sorted in ways worth scrolling. */
export default function RecordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [feed, setFeed] = useState<Feed>('hot');
  const spec = FEEDS.find((f) => f.key === feed)!;
  const points = collection(db, 'points');
  const live = where('removed', '==', false);

  const pointList = useCollection<Point>(
    feed === 'rants'
      ? null
      : query(
          points,
          live,
          // People first: support from real accounts outranks any amount
          // from the imported public records, and at equal real support
          // what a person raised comes before what was imported. The
          // public records only fill in below.
          ...(feed === 'hot'
            ? [orderBy('weekPeople', 'desc'), orderBy('imported', 'asc'), orderBy('weekSupport', 'desc')]
            : feed === 'shared'
              ? [orderBy('people', 'desc'), orderBy('imported', 'asc'), orderBy('supportCount', 'desc')]
              : feed === 'fixed'
                ? [where('status', '==', 'fixed'), orderBy('lastActivityAt', 'desc')]
                : [orderBy('imported', 'asc'), orderBy('createdAt', 'desc')]),
          limit(LIST),
        ),
    `record:${feed}`,
  );
  const rants = useCollection<Submission>(
    feed === 'rants'
      ? query(
          collection(db, 'submissions'),
          where('removed', '==', false),
          // Readers' votes first, then rants people wrote, then imported ones (rantRank).
          where('rantRank', '>', 0),
          orderBy('rantRank', 'desc'),
          limit(LIST),
        )
      : null,
    'record:rants',
  );
  const voted = rants.items.filter((s) => (s.loves ?? 0) > 0);
  const shownRants =
    voted.length >= ENOUGH_VOTED
      ? voted
      : [...voted, ...rants.items.filter((s) => !(s.loves ?? 0) && (s.rantScore ?? 0) >= MODEL_PICK)].slice(
          0,
          ENOUGH_VOTED,
        );
  const shownPoints = feed === 'hot' ? pointList.items.filter((p) => (p.weekSupport ?? 0) > 0) : pointList.items;

  return (
    <Screen topInset>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="display">Complaints</T>
        <Pressable
          onPress={() => router.push('/')}
          accessibilityRole="button"
          accessibilityLabel="Complain about something"
          style={({ pressed }) => [styles.plus, { backgroundColor: theme.primaryFill, opacity: pressed ? 0.8 : 1 }]}>
          <Ionicons name="add" size={26} color={theme.onPrimary} />
        </Pressable>
      </Row>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -16 }}>
        <View style={{ width: 8 }} />
        {FEEDS.map((f) => {
          const on = f.key === feed;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFeed(f.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.feed, { backgroundColor: on ? theme.text : theme.backgroundElement }]}>
              <Text style={{ color: on ? theme.background : theme.text, fontFamily: Fonts.bold, fontSize: 15 }}>{f.label}</Text>
            </Pressable>
          );
        })}
        <View style={{ width: 8 }} />
      </ScrollView>
      <T variant="small">{spec.blurb}</T>

      {feed === 'rants' ? (
        shownRants.length === 0 ? (
          <Empty loading={rants.loading} text={spec.empty} />
        ) : (
          shownRants.map((s, i) => <RantCard key={s.id} s={s} rank={i + 1} />)
        )
      ) : shownPoints.length === 0 ? (
        <Empty loading={pointList.loading} text={spec.empty} />
      ) : (
        <PointList>
          {shownPoints.map((p, i) => (
            <PointCard key={p.id} point={p} rank={feed === 'new' ? undefined : i + 1} />
          ))}
        </PointList>
      )}
    </Screen>
  );
}

/** A rant, in its author's words, with its heat. */
function RantCard({ s, rank }: { s: Submission; rank: number }) {
  const theme = useTheme();
  const router = useRouter();
  const score = s.rantScore ?? 0;
  const loves = s.loves ?? 0;
  const blocked = useBlockedAuthors();
  const hidden = !!s.authorId && blocked.ids.has(s.authorId);
  return (
    <Pressable
      onPress={() => router.push(`/submission/${s.id}`)}
      style={({ pressed }) => [styles.rant, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[styles.rantRank, { color: theme.rant }]}>#{rank}</Text>
        {loves > 0 ? (
          <Text style={{ color: theme.rant, fontFamily: Fonts.bold, fontSize: 14 }}>🤬 {loves.toLocaleString()}</Text>
        ) : (
          <Text style={{ color: theme.new, fontFamily: Fonts.bold, fontSize: 14 }}>✨ Model&apos;s pick · {score}/10</Text>
        )}
      </Row>
      {hidden ? (
        <T variant="small">Hidden by you. Tap to open it anyway.</T>
      ) : (
        <Text style={[styles.rantText, { color: theme.text }]} numberOfLines={8}>
          {s.text}
        </Text>
      )}
      <T variant="small" numberOfLines={1}>
        {hidden ? '' : `${s.authorName} · `}
        {s.subjectNames.slice(0, 3).join(' · ')}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  plus: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  feed: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  rant: { borderRadius: 18, padding: 16, gap: 10 },
  rantRank: { fontFamily: Fonts.display, fontSize: 20 },
  rantText: { fontFamily: Fonts.medium, fontSize: 19, lineHeight: 26 },
});
