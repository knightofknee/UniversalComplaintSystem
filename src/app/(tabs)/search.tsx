import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PointCard, PointList } from '@/components/point-card';
import { Empty, Field, InlineError, Row, Screen, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
      <T variant="display">Search</T>
      <Field
        value={q}
        onChangeText={setQ}
        placeholder="A company, a product, a problem…"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search"
      />
      <InlineError text={error} />
      {!active && <Starters />}
      {shownSubjects.length > 0 && <T variant="label">Pages</T>}
      <View>
        {shownSubjects.map((s) => (
          <SubjectRow
            key={s.id}
            name={s.name}
            detail={`${s.kind === 'organization' ? 'Organization' : 'Kind of problem'} · ${s.description}`}
            onPress={() => router.push(`/subject/${s.id}`)}
          />
        ))}
      </View>
      {shownPoints.length > 0 && <T variant="label">Complaints</T>}
      <PointList>
        {shownPoints.map((p) => (
          <PointCard key={p.id} point={p} />
        ))}
      </PointList>
      {q.trim().length >= 2 && !loading && shownPoints.length === 0 && shownSubjects.length === 0 && !error && (
        <Empty text="Nothing yet. If it bothers you, complain about it: you'll be the first." />
      )}
      {active && loading && shownPoints.length === 0 && shownSubjects.length === 0 && <Empty text="" loading />}
    </Screen>
  );
}

function SubjectRow({ name, detail, rank, onPress }: { name: string; detail: string; rank?: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={({ pressed }) => [styles.row, { borderTopColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
      {rank !== undefined && <Text style={[styles.rank, { color: theme.textSecondary }]}>{rank}</Text>}
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: '700' }} numberOfLines={1}>
          {name}
        </T>
        <T variant="small" numberOfLines={1}>
          {detail}
        </T>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

/** Before typing: the hall of shame (most complained-about organizations). */
function Starters() {
  const router = useRouter();
  const orgs = useCollection<Subject>(
    query(
      collection(db, 'subjects'),
      where('removed', '==', false),
      where('kind', '==', 'organization'),
      orderBy('stats.supporters', 'desc'),
      limit(10),
    ),
    'starters:org',
  );
  if (orgs.loading) return <Empty text="" loading />;
  if (orgs.items.length === 0) {
    return <Empty text="Search by meaning, in any language: “bag fees”, “hold music”, “my bank”." />;
  }
  return (
    <>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="heading">Hall of shame</T>
        <T variant="small">most complained about</T>
      </Row>
      <View>
        {orgs.items.map((s, i) => (
          <SubjectRow
            key={s.id}
            rank={i + 1}
            name={s.name}
            detail={`${people(s.stats.supporters ?? 0)} · ${s.stats.points} problem${s.stats.points === 1 ? '' : 's'}`}
            onPress={() => router.push(`/subject/${s.id}`)}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth },
  rank: { fontFamily: Fonts.display, fontSize: 20, width: 26 },
});
