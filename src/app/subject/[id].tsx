import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { PairedLists } from '@/components/paired-lists';
import { PointCard } from '@/components/point-card';
import { RelatedSubjects } from '@/components/related-subjects';
import { ReportButton } from '@/components/report';
import { Stats } from '@/components/stats';
import { Button, Card, Chip, Empty, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel } from '@/lib/categories';
import { db } from '@/lib/firebase';
import { count, useCollection, useDoc } from '@/lib/hooks';
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
  const category = categoryLabel(subject.category);
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
      <T variant="title">{subject.name}</T>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={org ? 'Organization' : 'Topic'} color={theme.textSecondary} bg={theme.backgroundElement} />
        {category && <Chip label={category} color={theme.textSecondary} bg={theme.backgroundElement} />}
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

/** A topic is a conversation: what's biggest and what's rising, side by side. */
function TopicPage({ subject }: { subject: Subject }) {
  const top = usePoints(subject.id, 'top');
  const rising = usePoints(subject.id, 'rising');
  const newest = usePoints(subject.id, 'new');
  return (
    <Screen>
      <Header subject={subject} />
      <T variant="small">
        {count(subject.stats.supporters ?? 0, 'supporter')} · {count(subject.stats.points, 'point')}
      </T>
      <RelatedSubjects subjectId={subject.id} points={top.items} kind="organization" title="Who could fix this" />
      <PairedLists
        hideSubjects
        first={{ title: 'Most supported', items: top.items, loading: top.loading, empty: 'No points yet.' }}
        second={{
          title: 'Rising this week',
          hint: 'Most new support in the last 7 days',
          items: rising.items.filter((p) => (p.weekSupport ?? 0) > 0),
          loading: rising.loading,
          empty: 'Nothing new this week.',
        }}
      />
      <T variant="heading">Newest</T>
      {newest.items.slice(0, 10).map((p) => (
        <PointCard key={p.id} point={p} hideSubjects />
      ))}
      <ReportButton target={{ kind: 'subject', id: subject.id }} label="Report this page" />
    </Screen>
  );
}

/** An organization is a ledger: its scoreboard, then its points. */
function OrganizationPage({ subject }: { subject: Subject }) {
  const router = useRouter();
  const { profile } = useAuth();
  const [sort, setSort] = useState<Sort>('top');
  const points = usePoints(subject.id, sort);
  const top = usePoints(subject.id, 'top');
  const mine = profile?.responderFor.includes(subject.id);
  const shown = sort === 'rising' ? points.items.filter((p) => (p.weekSupport ?? 0) > 0) : points.items;
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
      <RelatedSubjects subjectId={subject.id} points={top.items} kind="topic" title="Topics" />
      <Tabs
        options={[
          { key: 'top', label: 'Most supported' },
          { key: 'rising', label: 'Rising this week' },
          { key: 'new', label: 'Newest' },
        ]}
        value={sort}
        onChange={setSort}
      />
      {shown.length === 0 ? (
        <Empty loading={points.loading} text={sort === 'rising' ? 'Nothing new this week.' : 'No points yet.'} />
      ) : (
        shown.map((p) => <PointCard key={p.id} point={p} hideSubjects />)
      )}
      <ReportButton target={{ kind: 'subject', id: subject.id }} label="Report this page" />
    </Screen>
  );
}
