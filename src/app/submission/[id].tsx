import { useLocalSearchParams } from 'expo-router';
import { collection, documentId, query, where } from 'firebase/firestore';

import { PointCard } from '@/components/point-card';
import { SubmissionCard } from '@/components/submission-card';
import { Empty, Screen, T } from '@/components/ui';
import { db } from '@/lib/firebase';
import { useCollection, useDoc } from '@/lib/hooks';
import type { Point, Submission } from '@/lib/types';

export default function SubmissionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: s, loading } = useDoc<Submission>(`submissions/${id}`);
  const ids = s ? [...s.matchedPointIds, ...s.addedPointIds].slice(0, 30) : [];
  const points = useCollection<Point>(
    ids.length
      ? query(collection(db, 'points'), where('removed', '==', false), where(documentId(), 'in', ids))
      : null,
    `subpoints:${ids.join(',')}`,
  );
  if (!s) return <Screen><Empty loading={loading} text="Not found." /></Screen>;
  return (
    <Screen>
      <SubmissionCard s={s} />
      <T variant="label">Recorded as</T>
      {points.items.map((p) => (
        <PointCard key={p.id} point={p} />
      ))}
    </Screen>
  );
}
