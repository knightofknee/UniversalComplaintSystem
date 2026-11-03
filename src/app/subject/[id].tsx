import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';

import { PointCard } from '@/components/point-card';
import { Stats } from '@/components/stats';
import { Button, Card, Chip, Empty, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/firebase';
import { useCollection, useDoc } from '@/lib/hooks';
import type { Point, Subject } from '@/lib/types';

export default function SubjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { profile } = useAuth();
  const { data: subject, loading } = useDoc<Subject>(`subjects/${id}`);
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const points = useCollection<Point>(
    query(
      collection(db, 'points'),
      where('removed', '==', false),
      where('subjectIds', 'array-contains', id),
      orderBy(sort === 'top' ? 'supportCount' : 'createdAt', 'desc'),
      limit(100),
    ),
    `subject:${id}:${sort}`,
  );
  if (!subject) return <Screen><Empty loading={loading} text="Not found." /></Screen>;
  const org = subject.kind === 'organization';
  const mine = profile?.responderFor.includes(subject.id);
  return (
    <Screen>
      <Stack.Screen options={{ title: subject.name }} />
      <T variant="title">{subject.name}</T>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={org ? 'Organization' : 'Topic'} color={theme.textSecondary} bg={theme.backgroundElement} />
        {org && (
          <Chip
            label={subject.claimed ? `Responds here · ${subject.domains.map((d) => `@${d}`).join(' ')}` : 'Has not claimed this page'}
            color={subject.claimed ? theme.good : theme.warning}
            bg={subject.claimed ? theme.goodSoft : theme.warningSoft}
          />
        )}
      </Row>
      <T variant="small">{subject.description}</T>
      {org && <Stats subject={subject} />}
      <Button
        label={`Complain about ${subject.name}`}
        icon="megaphone"
        onPress={() => router.push({ pathname: '/complain', params: { subjectId: subject.id, subjectName: subject.name } })}
      />
      {org && !mine && (
        <Card onPress={() => router.push({ pathname: '/company/claim', params: { subjectId: subject.id } })}>
          <T variant="small">
            Work at {subject.name}? Respond with your work email. Organizations can respond here, never remove
            or edit.
          </T>
        </Card>
      )}
      <Tabs
        options={[
          { key: 'top', label: 'Most supported' },
          { key: 'new', label: 'Newest' },
        ]}
        value={sort}
        onChange={setSort}
      />
      {points.items.length === 0 ? (
        <Empty loading={points.loading} text="No points yet." />
      ) : (
        points.items.map((p) => <PointCard key={p.id} point={p} hideSubjects />)
      )}
    </Screen>
  );
}
