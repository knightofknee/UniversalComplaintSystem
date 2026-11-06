import { useRouter } from 'expo-router';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';

import { Card, T } from '@/components/ui';
import { db } from '@/lib/firebase';
import type { Point, Subject } from '@/lib/types';

/**
 * Subjects that share points with this one. On a topic page that is "who
 * could fix this" (organizations, with how much they respond); on an
 * organization's page, the topics its points are filed under.
 */
export function RelatedSubjects({
  subjectId,
  points,
  kind,
  title,
}: {
  subjectId: string;
  points: Point[];
  kind: 'organization' | 'topic';
  title: string;
}) {
  const router = useRouter();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of points) {
      for (const id of p.subjectIds) if (id !== subjectId) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [points, subjectId]);
  const ids = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, 30);
  const key = ids.join(',');
  const [subjects, setSubjects] = useState<Subject[]>([]);

  useEffect(() => {
    if (!key) return;
    getDocs(query(collection(db, 'subjects'), where('removed', '==', false), where(documentId(), 'in', key.split(','))))
      .then((s) => setSubjects(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Subject)))
      .catch(() => setSubjects([]));
  }, [key]);

  const shown = (key ? subjects : [])
    .filter((s) => s.kind === kind && counts.has(s.id))
    .sort((a, b) => counts.get(b.id)! - counts.get(a.id)!);
  if (shown.length === 0) return null;
  return (
    <>
      <T variant="label">{title}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {shown.map((s) => {
          const here = counts.get(s.id)!;
          const rate = s.stats.points ? Math.round((s.stats.responded / s.stats.points) * 100) : 0;
          return (
            <Card key={s.id} onPress={() => router.push(`/subject/${s.id}`)} style={{ width: 190 }}>
              <T style={{ fontWeight: '700' }} numberOfLines={2}>
                {s.name}
              </T>
              <T variant="small">
                {here} point{here === 1 ? '' : 's'} here
                {kind === 'organization' ? (s.claimed ? ` · responds to ${rate}%` : ' · not on UCS yet') : ''}
              </T>
            </Card>
          );
        })}
      </ScrollView>
    </>
  );
}
