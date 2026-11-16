import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ComplaintCard, useHotComplaints, useNewComplaints } from '@/components/complaint-feed';
import { PointCard, PointList } from '@/components/point-card';
import { Button, Empty, Row, Screen, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/hooks';
import type { Point, Submission } from '@/lib/types';

type Feed = 'hot' | 'rants' | 'easy' | 'top' | 'fixed' | 'new';
/** A page of the list; "Show more" adds another. */
const LIST = 40;
/**
 * Best rants is readers' votes. Until this many rants have a vote, the list
 * is topped up with ones the model scored this high (1-10, how good a read:
 * vivid, specific, funny), labeled as the model's pick.
 */
const ENOUGH_VOTED = 10;
const MODEL_PICK = 7;

// A name and nothing else: no line under it explaining the name.
const FEEDS: { key: Feed; label: string }[] = [
  { key: 'hot', label: '🔥 Hot' },
  { key: 'rants', label: '🤬 Best rants' },
  { key: 'easy', label: '🍋 Easiest' },
  { key: 'top', label: '🏆 Top' },
  { key: 'fixed', label: '✅ Fixed' },
  { key: 'new', label: '🆕 New' },
];
/** Said plainly, with no joke and no finger pointed: an empty list is nobody's fault. */
const EMPTY = 'Nothing here yet.';

/**
 * Complaints: everything people complained about, sorted in ways worth
 * scrolling. Hot, Best rants, Easiest and New list the complaints
 * themselves, in their authors' words; Top and Fixed list issues (what many
 * complaints share).
 */
export default function RecordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [feed, setFeedState] = useState<Feed>('hot');
  const [count, setCount] = useState(LIST);
  const setFeed = (f: Feed) => {
    setFeedState(f);
    setCount(LIST);
  };
  const points = collection(db, 'points');
  const live = where('removed', '==', false);

  const issueFeed = feed === 'top' || feed === 'fixed';
  const pointList = useCollection<Point>(
    !issueFeed
      ? null
      : query(
          points,
          live,
          // People first: support from real accounts outranks any amount
          // from the imported public records, and at equal real support
          // what a person raised comes before what was imported. The
          // public records only fill in below.
          ...(feed === 'top'
            ? [orderBy('people', 'desc'), orderBy('imported', 'asc'), orderBy('supportCount', 'desc')]
            : [where('status', '==', 'fixed'), orderBy('lastActivityAt', 'desc')]),
          limit(count),
        ),
    `record:${feed}:${count}`,
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
  // Complaints readers voted "Easy peasy": looks easy to fix from what the author says (easy.ts).
  const easy = useCollection<Submission>(
    feed === 'easy'
      ? query(
          collection(db, 'submissions'),
          where('removed', '==', false),
          where('easy', '>', 0),
          orderBy('easy', 'desc'),
          orderBy('createdAt', 'desc'),
          limit(count),
        )
      : null,
    `record:easy:${count}`,
  );
  const voted = rants.items.filter((s) => (s.loves ?? 0) > 0);
  const shownRants =
    voted.length >= ENOUGH_VOTED
      ? voted
      : [...voted, ...rants.items.filter((s) => !(s.loves ?? 0) && (s.rantScore ?? 0) >= MODEL_PICK)].slice(
          0,
          ENOUGH_VOTED,
        );
  const hot = useHotComplaints(undefined, count, feed === 'hot');
  const fresh = useNewComplaints(undefined, count, feed === 'new');
  const complaints = feed === 'hot' ? hot : fresh;

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

      {feed === 'rants' ? (
        shownRants.length === 0 ? (
          <Empty loading={rants.loading} text={EMPTY} />
        ) : (
          shownRants.map((s, i) => <ComplaintCard key={s.id} s={s} rank={i + 1} kind="rant" />)
        )
      ) : feed === 'hot' || feed === 'new' ? (
        complaints.items.length === 0 ? (
          <Empty loading={complaints.loading} text={EMPTY} />
        ) : (
          <>
            {complaints.items.map((s, i) => (
              <ComplaintCard key={s.id} s={s} kind={feed} rank={feed === 'hot' ? i + 1 : undefined} />
            ))}
            {complaints.more && <Button kind="secondary" label="Show more" onPress={() => setCount(count + LIST)} />}
          </>
        )
      ) : feed === 'easy' ? (
        easy.items.length === 0 ? (
          <Empty loading={easy.loading} text={EMPTY} />
        ) : (
          <>
            {easy.items.map((s, i) => (
              <ComplaintCard key={s.id} s={s} rank={i + 1} kind="easy" />
            ))}
            {easy.items.length >= count && (
              <Button kind="secondary" label="Show more" onPress={() => setCount(count + LIST)} />
            )}
          </>
        )
      ) : pointList.items.length === 0 ? (
        <Empty loading={pointList.loading} text={EMPTY} />
      ) : (
        <>
          <PointList>
            {pointList.items.map((p, i) => (
              <PointCard key={p.id} point={p} rank={i + 1} />
            ))}
          </PointList>
          {pointList.items.length >= count && (
            <Button kind="secondary" label="Show more" onPress={() => setCount(count + LIST)} />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  plus: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  feed: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
});
