import { useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';

import { PointCard } from '@/components/point-card';
import { Button, Empty, Screen, T, Tabs } from '@/components/ui';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/hooks';
import type { Point } from '@/lib/types';

type Board = 'top' | 'new' | 'rants' | 'fixed';

const BOARDS: { key: Board; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'new', label: 'New' },
  { key: 'rants', label: 'Rants' },
  { key: 'fixed', label: 'Fixed' },
];

function boardQuery(board: Board) {
  const points = collection(db, 'points');
  const live = where('removed', '==', false);
  switch (board) {
    case 'top':
      return query(points, live, orderBy('supportCount', 'desc'), limit(50));
    case 'new':
      return query(points, live, orderBy('createdAt', 'desc'), limit(50));
    case 'rants':
      return query(points, live, where('hot', '==', true), orderBy('supportCount', 'desc'), limit(50));
    case 'fixed':
      return query(points, live, where('status', '==', 'fixed'), orderBy('lastActivityAt', 'desc'), limit(50));
  }
}

/** The world's complaints, across every company and thing. */
export default function TopScreen() {
  const router = useRouter();
  const [board, setBoard] = useState<Board>('top');
  const { items, loading } = useCollection<Point>(boardQuery(board), `board:${board}`);
  return (
    <Screen topInset>
      <T variant="title">Universal Complaint System</T>
      <T color={undefined} variant="body">
        Everything that&apos;s wrong, about anything. Counted, merged with everyone who shares it, and in front of
        whoever can fix it.
      </T>
      <Button label="Complain about something" icon="megaphone" onPress={() => router.push('/complain')} />
      <Tabs options={BOARDS} value={board} onChange={setBoard} />
      {items.length === 0 ? (
        <Empty
          loading={loading}
          text={
            board === 'fixed'
              ? 'Nothing confirmed fixed yet.'
              : board === 'rants'
                ? 'No rants yet.'
                : 'Nothing here yet. Be the first.'
          }
        />
      ) : (
        items.map((p, i) => <PointCard key={p.id} point={p} rank={board === 'top' ? i + 1 : undefined} />)
      )}
    </Screen>
  );
}
