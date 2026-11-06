import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PairedLists } from '@/components/paired-lists';
import { PointCard } from '@/components/point-card';
import { Button, Card, Empty, Row, Screen, T, Tabs } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORIES, type Category } from '@/lib/categories';
import { db } from '@/lib/firebase';
import { count, useCollection } from '@/lib/hooks';
import type { Point, Subject } from '@/lib/types';

type More = 'new' | 'rants' | 'fixed';
const LIST = 30;
const INTRO_KEY = 'ucs:seenIntro';

/** For people who just want to read: what's most complained about, and what's rising. */
export default function BrowseScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<Category | null>(null);
  const [more, setMore] = useState<More>('new');
  const points = collection(db, 'points');
  const scope: QueryConstraint[] = [
    where('removed', '==', false),
    ...(category ? [where('categories', 'array-contains', category)] : []),
  ];
  const k = category ?? 'all';

  const top = useCollection<Point>(query(points, ...scope, orderBy('supportCount', 'desc'), limit(LIST)), `top:${k}`);
  const rising = useCollection<Point>(query(points, ...scope, orderBy('weekSupport', 'desc'), limit(LIST)), `rising:${k}`);
  const topics = useCollection<Subject>(
    query(
      collection(db, 'subjects'),
      where('removed', '==', false),
      where('kind', '==', 'topic'),
      ...(category ? [where('category', '==', category)] : []),
      orderBy('stats.supporters', 'desc'),
      limit(10),
    ),
    `topics:${k}`,
  );
  const moreList = useCollection<Point>(
    query(
      points,
      ...scope,
      ...(more === 'new'
        ? [orderBy('createdAt', 'desc')]
        : more === 'rants'
          ? [where('hot', '==', true), orderBy('supportCount', 'desc')]
          : [where('status', '==', 'fixed'), orderBy('lastActivityAt', 'desc')]),
      limit(LIST),
    ),
    `more:${k}:${more}`,
  );

  // The full pitch once; after that the content leads.
  const [firstVisit, setFirstVisit] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(INTRO_KEY)
      .then((seen) => {
        if (seen) return;
        setFirstVisit(true);
        return AsyncStorage.setItem(INTRO_KEY, '1');
      })
      .catch(() => {});
  }, []);

  return (
    <Screen topInset>
      <Row>
        <Image source={require('../../../assets/images/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <T variant={firstVisit ? 'title' : 'heading'} style={{ flex: 1 }}>
          Universal Complaint System
        </T>
      </Row>
      {firstVisit ? (
        <>
          <T>
            Everything that&apos;s wrong, about anything. Counted, merged with everyone who shares it, and in front of
            whoever can fix it.
          </T>
          <Button label="Complain about something" icon="megaphone" onPress={() => router.push('/complain')} />
        </>
      ) : (
        <Button label="What’s bugging you?" icon="megaphone" kind="secondary" onPress={() => router.push('/complain')} />
      )}

      <CategoryChips value={category} onChange={setCategory} />

      {topics.items.length > 0 && (
        <>
          <T variant="heading">Biggest topics</T>
          <View style={styles.topics}>
            {topics.items.map((t) => (
              <Card key={t.id} onPress={() => router.push(`/subject/${t.id}`)} style={styles.topic}>
                <T style={{ fontWeight: '700' }} numberOfLines={2}>
                  {t.name}
                </T>
                <T variant="small">
                  {count(t.stats.supporters ?? 0, 'supporter')} · {count(t.stats.points, 'point')}
                </T>
              </Card>
            ))}
          </View>
        </>
      )}

      <PairedLists
        first={{
          title: 'Most supported',
          items: top.items,
          loading: top.loading,
          empty: 'Nothing\'s broken here yet. Suspicious.',
        }}
        second={{
          title: 'Rising this week',
          hint: 'Most new support in the last 7 days',
          items: rising.items.filter((p) => (p.weekSupport ?? 0) > 0),
          loading: rising.loading,
          empty: 'Nothing new this week.',
        }}
      />

      <Tabs
        options={[
          { key: 'new', label: 'Newest' },
          { key: 'rants', label: 'Rants' },
          { key: 'fixed', label: 'Fixed' },
        ]}
        value={more}
        onChange={setMore}
      />
      {moreList.items.length === 0 ? (
        <Empty
          loading={moreList.loading}
          text={more === 'fixed' ? 'Nothing confirmed fixed yet. Organizations, your move.' : more === 'rants' ? 'No rants yet. Everyone is being very calm.' : 'Quiet. Too quiet.'}
        />
      ) : (
        moreList.items.map((p) => <PointCard key={p.id} point={p} />)
      )}
    </Screen>
  );
}

function CategoryChips({ value, onChange }: { value: Category | null; onChange: (c: Category | null) => void }) {
  const theme = useTheme();
  const options = [{ key: null, label: 'Everything', icon: 'globe-outline' as const }, ...CATEGORIES];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((c) => {
        const on = c.key === value;
        const fg = on ? theme.background : theme.text;
        return (
          <Pressable
            key={c.key ?? 'all'}
            onPress={() => onChange(c.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.chip, { backgroundColor: on ? theme.text : theme.backgroundElement }]}>
            <Ionicons name={c.icon} size={15} color={fg} />
            <Text style={{ color: fg, fontWeight: '600' }}>{c.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mark: { width: 36, height: 36 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  topic: { flexGrow: 1, flexBasis: 160, maxWidth: 340 },
});
