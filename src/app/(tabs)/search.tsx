import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PointCard, PointList } from '@/components/point-card';
import { Button, Empty, Field, InlineError, Row, Screen, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorText, searchPoints, type ComplaintHit } from '@/lib/api';
import { db } from '@/lib/firebase';
import { people, timeAgo, useCollection } from '@/lib/hooks';
import type { PointHit, Subject } from '@/lib/types';

type SubjectHit = { id: string; name: string; kind: string; description: string };
type Kind = 'organization' | 'topic' | 'both';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'organization', label: 'Companies' },
  { key: 'topic', label: 'Topics' },
  { key: 'both', label: 'Both' },
];

/**
 * A small choice of what kind of pages to show. It sits under the search
 * box and is ALWAYS there, whatever the results: a filter that disappears
 * when it filters everything out can't be switched back.
 */
function KindPick({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  const theme = useTheme();
  return (
    <Row style={{ gap: 16 }}>
      {KINDS.map((k) => {
        const on = k.key === value;
        return (
          <Pressable
            key={k.key}
            onPress={() => onChange(k.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            hitSlop={8}>
            <T variant="small" color={on ? theme.text : theme.textSecondary} style={{ fontWeight: on ? '700' : '400' }}>
              {k.label}
            </T>
          </Pressable>
        );
      })}
    </Row>
  );
}

/** Search by meaning (any language), plus organizations and topics by name. */
export default function SearchScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('both');
  const [points, setPoints] = useState<PointHit[]>([]);
  const [subjects, setSubjects] = useState<SubjectHit[]>([]);
  const [complaints, setComplaints] = useState<ComplaintHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const active = q.trim().length >= 2;
  const shownSubjects = active ? subjects.filter((s) => kind === 'both' || s.kind === kind) : [];
  const shownPoints = active ? points : [];
  // What people said comes first; the Companies / Topics pick narrows to pages, so they show under Both.
  const shownComplaints = active && kind === 'both' ? complaints : [];
  const nothing = shownPoints.length === 0 && shownSubjects.length === 0 && shownComplaints.length === 0;

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
          term.length >= 4
            ? searchPoints({ query: term, complaints: true })
            : Promise.resolve({ points: [], subjects: [], complaints: [] }),
        ]);
        if (mine !== seq.current) return;
        const named = byName.docs.map((d) => ({ id: d.id, ...d.data() }) as SubjectHit);
        const seen = new Set(named.map((s) => s.id));
        setSubjects([...named, ...byMeaning.subjects.filter((s) => !seen.has(s.id))]);
        setPoints(byMeaning.points);
        setComplaints(byMeaning.complaints ?? []);
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
        placeholder="A company, a product, an issue…"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search"
      />
      <KindPick value={kind} onChange={setKind} />
      <InlineError text={error} />
      {!active && <Starters kind={kind} />}
      {shownComplaints.length > 0 && <T variant="label">What people said</T>}
      <View>
        {shownComplaints.map((c) => (
          <ComplaintRow key={c.id} c={c} onPress={() => router.push(`/submission/${c.id}`)} />
        ))}
      </View>
      {shownSubjects.length > 0 && <T variant="label">Companies and topics</T>}
      <View>
        {shownSubjects.map((s) => (
          <SubjectRow
            key={s.id}
            name={s.name}
            detail={`${s.kind === 'organization' ? 'Organization' : 'Kind of issue'} · ${s.description}`}
            onPress={() => router.push(`/subject/${s.id}`)}
          />
        ))}
      </View>
      {shownPoints.length > 0 && <T variant="label">Issues</T>}
      <PointList>
        {shownPoints.map((p) => (
          <PointCard key={p.id} point={p} />
        ))}
      </PointList>
      {q.trim().length >= 2 && !loading && nothing && !error && (
        <>
          <Empty text="Nothing here yet." />
          <Button kind="secondary" icon="add" label="Complain about it" onPress={() => router.push('/complain')} />
        </>
      )}
      {active && loading && nothing && <Empty text="" loading />}
    </Screen>
  );
}

function SubjectRow({
  name,
  detail,
  rank,
  onPress,
}: {
  name: string;
  detail: string;
  rank?: number;
  onPress: () => void;
}) {
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

/** One complaint found by its words: the words first, then who, when and what it's about. */
function ComplaintRow({ c, onPress }: { c: ComplaintHit; onPress: () => void }) {
  const theme = useTheme();
  const votes = [c.loves ? `🤬 ${c.loves}` : '', c.easy ? `🍋 ${c.easy}` : ''].filter(Boolean).join('  ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={({ pressed }) => [styles.complaint, { borderTopColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
      <T numberOfLines={3}>{c.text}</T>
      <T variant="small" numberOfLines={1}>
        {[c.source ? `Public record · ${c.source}` : c.authorName, timeAgo(c.createdAt ?? undefined), c.subjectNames.join(' · ')]
          .filter(Boolean)
          .join(' · ')}
      </T>
      {votes ? <T variant="small">{votes}</T> : null}
    </Pressable>
  );
}

/** Before typing: the most complained-about companies, topics, or both. */
function Starters({ kind }: { kind: Kind }) {
  const router = useRouter();
  const kinds = kind === 'both' ? ['organization', 'topic'] : [kind];
  const orgs = useCollection<Subject>(
    query(
      collection(db, 'subjects'),
      where('removed', '==', false),
      where('kind', 'in', kinds),
      orderBy('stats.supporters', 'desc'),
      limit(10),
    ),
    `starters:${kind}`,
  );
  if (orgs.loading) return <Empty text="" loading />;
  if (orgs.items.length === 0) {
    return <Empty text="Search by meaning, in any language: “bag fees”, “hold music”, “my bank”." />;
  }
  return (
    <>
      <T variant="heading">Most complained about</T>
      <View>
        {orgs.items.map((s, i) => (
          <SubjectRow
            key={s.id}
            rank={i + 1}
            name={s.name}
            detail={`${people(s.stats.supporters ?? 0)} · ${s.stats.points} issue${s.stats.points === 1 ? '' : 's'}`}
            onPress={() => router.push(`/subject/${s.id}`)}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rank: { fontFamily: Fonts.display, fontSize: 20, width: 26 },
  complaint: { gap: 4, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
