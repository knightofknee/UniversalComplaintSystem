import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ComplaintCard, useHotComplaints, useNewComplaints } from '@/components/complaint-feed';
import { PointCard, PointList } from '@/components/point-card';
import { RelatedSubjects } from '@/components/related-subjects';
import { ReportButton } from '@/components/report';
import { Stats } from '@/components/stats';
import { Button, Card, Chip, Empty, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/firebase';
import { count, people, useCollection, useDoc } from '@/lib/hooks';
import { shareLink } from '@/lib/share';
import type { Point, Subject } from '@/lib/types';

type Sort = 'hot' | 'top' | 'new';

const PAGE = 40;

/** Its issues, most people first: support from real accounts outranks imported public records. */
function useTopPoints(subjectId: string, count = 100, on = true) {
  return useCollection<Point>(
    on
      ? query(
          collection(db, 'points'),
          where('removed', '==', false),
          where('subjectIds', 'array-contains', subjectId),
          orderBy('people', 'desc'),
          orderBy('imported', 'asc'),
          orderBy('supportCount', 'desc'),
          limit(count),
        )
      : null,
    `subject:${subjectId}:top:${count}`,
  );
}

export default function SubjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: subject, loading } = useDoc<Subject>(`subjects/${id}`);
  if (!subject) {
    return (
      <Screen>
        <Empty loading={loading} text="This isn't here anymore." />
      </Screen>
    );
  }
  return subject.kind === 'topic' ? <TopicPage subject={subject} /> : <OrganizationPage subject={subject} />;
}

function Header({ subject }: { subject: Subject }) {
  const theme = useTheme();
  const router = useRouter();
  const org = subject.kind === 'organization';
  return (
    <>
      <Stack.Screen
        options={{
          // The page's own big title names it; a second one in the header just repeats it.
          title: '',
          headerRight: () => (
            <Pressable
              onPress={() => shareLink(`/subject/${subject.id}`)}
              accessibilityLabel="Share this page"
              hitSlop={10}>
              <Ionicons name="share-outline" size={22} color={theme.primary} />
            </Pressable>
          ),
        }}
      />
      <T variant="display" style={{ fontSize: 34, lineHeight: 38 }}>
        {subject.name}
      </T>
      <Row style={{ flexWrap: 'wrap' }}>
        {/* Not joined yet is said once, in the notice under the numbers. */}
        {org && subject.claimed && (
          <Chip
            label={`Responds here · ${subject.domains.map((d) => `@${d}`).join(' ')}`}
            color={theme.good}
            bg={theme.goodSoft}
          />
        )}
      </Row>
      <T variant="small">{subject.description}</T>
      <Button
        label={`Complain about ${subject.name}`}
        icon="megaphone"
        onPress={() =>
          router.push({ pathname: '/complain', params: { subjectId: subject.id, subjectName: subject.name } })
        }
      />
    </>
  );
}

const SORTS: { key: Sort; label: string }[] = [
  { key: 'hot', label: '🔥 Hot' },
  { key: 'top', label: '🏆 Top' },
  { key: 'new', label: '🆕 New' },
];

/**
 * The same sorts as the Complaints tab: Hot and New are the complaints
 * themselves, in their authors' words; Top is the issues they share.
 */
function SubjectFeed({ subject }: { subject: Subject }) {
  const [sort, setSortState] = useState<Sort>('hot');
  const [count, setCount] = useState(PAGE);
  const setSort = (s: Sort) => {
    setSortState(s);
    setCount(PAGE);
  };
  const points = useTopPoints(subject.id, count, sort === 'top');
  const hot = useHotComplaints(subject.id, count, sort === 'hot');
  const fresh = useNewComplaints(subject.id, count, sort === 'new');
  const complaints = sort === 'hot' ? hot : fresh;
  return (
    <>
      <Tabs options={SORTS} value={sort} onChange={setSort} />
      {sort === 'top' ? (
        points.items.length === 0 ? (
          <Empty loading={points.loading} text="Nothing here yet." />
        ) : (
          <PointList>
            {points.items.map((p, i) => (
              <PointCard key={p.id} point={p} hideSubjects rank={i + 1} />
            ))}
          </PointList>
        )
      ) : complaints.items.length === 0 ? (
        <Empty loading={complaints.loading} text="Nothing here yet." />
      ) : (
        complaints.items.map((s, i) => (
          <ComplaintCard key={s.id} s={s} kind={sort === 'hot' ? 'hot' : 'new'} rank={sort === 'hot' ? i + 1 : undefined} />
        ))
      )}
      {(sort === 'top' ? points.items.length >= count : complaints.more) && (
        <Button kind="secondary" label="Show more" onPress={() => setCount(count + PAGE)} />
      )}
    </>
  );
}

/** A kind of problem: the complaints first, then who could fix it. */
function TopicPage({ subject }: { subject: Subject }) {
  const top = useTopPoints(subject.id);
  return (
    <Screen>
      <Header subject={subject} />
      <SubjectFeed subject={subject} />
      <T variant="small">
        {people(subject.stats.supporters ?? 0)} · {count(subject.stats.points, 'issue')}
      </T>
      <RelatedSubjects subjectId={subject.id} points={top.items} kind="organization" title="Who could fix this" />
      <ReportButton target={{ kind: 'subject', id: subject.id }} label="Report this page" />
    </Screen>
  );
}

/**
 * An organization: the complaints about it come right after the button to
 * add yours. Its scoreboard and the way to respond for it are below them.
 */
function OrganizationPage({ subject }: { subject: Subject }) {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const mine = profile?.responderFor.includes(subject.id);
  return (
    <Screen>
      <Header subject={subject} />
      <SubjectFeed subject={subject} />
      <Stats subject={subject} />
      {!mine && (
        <Card onPress={() => router.push({ pathname: '/company/claim', params: { subjectId: subject.id } })}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontWeight: '700' }}>Work at {subject.name}? Respond here</T>
              <T variant="small">With your work email. Organizations can answer, never remove or edit.</T>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Row>
        </Card>
      )}
      <ReportButton target={{ kind: 'subject', id: subject.id }} label="Report this page" />
    </Screen>
  );
}
