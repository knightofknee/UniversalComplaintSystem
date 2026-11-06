import { useRouter } from 'expo-router';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';

import { PointCard } from '@/components/point-card';
import { Card, Empty, Field, Row, Screen, T } from '@/components/ui';
import { errorText, searchPoints } from '@/lib/api';
import { db } from '@/lib/firebase';
import { people, useCollection } from '@/lib/hooks';
import type { PointHit, Subject } from '@/lib/types';

type SubjectHit = { id: string; name: string; kind: string; description: string };

/** Search by meaning (any language), plus organizations and topics by name. */
export default function SearchScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [points, setPoints] = useState<PointHit[]>([]);
  const [subjects, setSubjects] = useState<SubjectHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const active = q.trim().length >= 2;
  const shownSubjects = active ? subjects : [];
  const shownPoints = active ? points : [];

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const lower = term.toLowerCase();
        const [byName, byMeaning] = await Promise.all([
          getDocs(
            query(
              collection(db, 'subjects'),
              where('removed', '==', false),
              orderBy('nameLower'),
              where('nameLower', '>=', lower),
              where('nameLower', '<', `${lower}`),
              limit(8),
            ),
          ),
          term.length >= 4 ? searchPoints({ query: term }) : Promise.resolve({ points: [], subjects: [] }),
        ]);
        if (mine !== seq.current) return;
        const named = byName.docs.map((d) => ({ id: d.id, ...d.data() }) as SubjectHit);
        const seen = new Set(named.map((s) => s.id));
        setSubjects([...named, ...byMeaning.subjects.filter((s) => !seen.has(s.id))]);
        setPoints(byMeaning.points);
      } catch (e) {
        if (mine === seq.current) setError(errorText(e));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <Screen topInset>
      <T variant="title">Search</T>
      <Field
        value={q}
        onChangeText={setQ}
        placeholder="A company, a product, or a problem"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search"
      />
      {error && <T variant="small">{error}</T>}
      {!active && <Starters />}
      {shownSubjects.length > 0 && <T variant="label">Organizations & topics</T>}
      {shownSubjects.map((s) => (
        <Card key={s.id} onPress={() => router.push(`/subject/${s.id}`)}>
          <T variant="heading">{s.name}</T>
          <T variant="small">
            {s.kind === 'organization' ? 'Organization' : 'Topic'} · {s.description}
          </T>
        </Card>
      ))}
      {shownPoints.length > 0 && <T variant="label">Points</T>}
      {shownPoints.map((p) => (
        <PointCard key={p.id} point={p} />
      ))}
      {q.trim().length >= 2 && !loading && shownPoints.length === 0 && shownSubjects.length === 0 && !error && (
        <Empty text="Nothing yet. If it bothers you, complain about it: you'll be the first." />
      )}
      {active && loading && shownPoints.length === 0 && shownSubjects.length === 0 && <Empty text="" loading />}
    </Screen>
  );
}

/** Before typing: the biggest topics and the most complained-about organizations. */
function Starters() {
  const router = useRouter();
  const top = (kind: 'topic' | 'organization') =>
    query(
      collection(db, 'subjects'),
      where('removed', '==', false),
      where('kind', '==', kind),
      orderBy('stats.supporters', 'desc'),
      limit(8),
    );
  const topics = useCollection<Subject>(top('topic'), 'starters:topic');
  const orgs = useCollection<Subject>(top('organization'), 'starters:org');
  if (topics.loading || orgs.loading) return <Empty text="" loading />;
  if (topics.items.length === 0 && orgs.items.length === 0) {
    return <Empty text="Search by meaning, in any language: “bag fees”, “hold music”, “my bank”." />;
  }
  const list = (items: Subject[]) =>
    items.map((s) => (
      <Card key={s.id} onPress={() => router.push(`/subject/${s.id}`)}>
        <Row>
          <T style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
            {s.name}
          </T>
          <T variant="small">{people(s.stats.supporters ?? 0)}</T>
        </Row>
      </Card>
    ));
  return (
    <>
      {orgs.items.length > 0 && <T variant="label">Most complained about</T>}
      {list(orgs.items)}
      {topics.items.length > 0 && <T variant="label">Biggest topics</T>}
      {list(topics.items)}
    </>
  );
}
