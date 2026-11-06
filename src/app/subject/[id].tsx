import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { Pressable } from 'react-native';

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

type Sort = 'top' | 'rising' | 'new';
const SORT_FIELD: Record<Sort, string> = { top: 'supportCount', rising: 'weekSupport', new: 'createdAt' };

function usePoints(subjectId: string, sort: Sort) {
  return useCollection<Point>(
    query(
      collection(db, 'points'),
      where('removed', '==', false),
      where('subjectIds', 'array-contains', subjectId),
      orderBy(SORT_FIELD[sort], 'desc'),
      limit(100),
    ),
    `subject:${subjectId}:${sort}`,
  );
}

export default function SubjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: subject, loading } = useDoc<Subject>(`subjects/${id}`);
  if (!subject) {
    return (
      <Screen>
        <Empty loading={loading} text="Not found." />
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
          title: subject.name,
          headerRight: () => (
            <Pressable
              onPress={() =>
                shareLink(
                  org
                    ? `What people say is wrong with ${subject.name}, and what it did about it`
                    : `${subject.name}: what people say is wrong`,
                  `/subject/${subject.id}`,
                )
              }
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
        {org && (
          <Chip
            label={
              subject.claimed
                ? `Responds here · ${subject.domains.map((d) => `@${d}`).join(' ')}`
                : 'Hasn\'t joined UCS yet'
            }
            color={subject.claimed ? theme.good : theme.warning}
            bg={subject.claimed ? theme.goodSoft : theme.warningSoft}
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
  { key: 'rising', label: '🔥 Hot' },
  { key: 'top', label: '👥 Most shared' },
  { key: 'new', label: '🆕 New' },
];

/** Hot, most shared, new: the same sorts as the Complaints tab. */
function SubjectFeed({ subject }: { subject: Subject }) {
  const [sort, setSort] = useState<Sort>('top');
  const points = usePoints(subject.id, sort);
  const shown = sort === 'rising' ? points.items.filter((p) => (p.weekSupport ?? 0) > 0) : points.items;
  return (
    <>
      <Tabs options={SORTS} value={sort} onChange={setSort} />
      {shown.length === 0 ? (
        <Empty loading={points.loading} text={sort === 'rising' ? 'Nothing heating up this week.' : 'Nothing here yet.'} />
      ) : (
        <PointList>
          {shown.map((p, i) => (
            <PointCard key={p.id} point={p} hideSubjects rank={sort === 'new' ? undefined : i + 1} />
          ))}
        </PointList>
      )}
    </>
  );
}

/** A kind of problem: who could fix it, then the complaints. */
function TopicPage({ subject }: { subject: Subject }) {
  const top = usePoints(subject.id, 'top');
  return (
    <Screen>
      <Header subject={subject} />
      <T variant="small">
        {people(subject.stats.supporters ?? 0)} · {count(subject.stats.points, 'problem')}
      </T>
      <RelatedSubjects subjectId={subject.id} points={top.items} kind="organization" title="Who could fix this" />
      <SubjectFeed subject={subject} />
      <ReportButton target={{ kind: 'subject', id: subject.id }} label="Report this page" />
    </Screen>
  );
}

/** An organization is a ledger: its scoreboard, then its points. */
function OrganizationPage({ subject }: { subject: Subject }) {
  const router = useRouter();
  const { profile } = useAuth();
  const top = usePoints(subject.id, 'top');
  const mine = profile?.responderFor.includes(subject.id);
  return (
    <Screen>
      <Header subject={subject} />
      <Stats subject={subject} />
      {!mine && (
        <Card onPress={() => router.push({ pathname: '/company/claim', params: { subjectId: subject.id } })}>
          <T variant="small">
            Work at {subject.name}? Respond with your work email. Organizations can respond here, never remove or
            edit.
          </T>
        </Card>
      )}
      <RelatedSubjects subjectId={subject.id} points={top.items} kind="topic" title="Kinds of problems" />
      <SubjectFeed subject={subject} />
      <ReportButton target={{ kind: 'subject', id: subject.id }} label="Report this page" />
    </Screen>
  );
}
