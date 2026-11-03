import { collection, limit, orderBy, query } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';

import { Card, Empty, Screen, T } from '@/components/ui';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/hooks';

type Removal = { id: string; kind: string; subjectNames: string[]; reason: string; at: Timestamp | null };

/** Every removal from the record, and why. */
export default function RemovalsScreen() {
  const { items, loading } = useCollection<Removal>(
    query(collection(db, 'removals'), orderBy('at', 'desc'), limit(200)),
    'removals',
  );
  return (
    <Screen>
      <T variant="small">
        UCS removes only illegal content, personal data, and complaints about private individuals. Each removal is
        listed here.
      </T>
      {items.length === 0 ? (
        <Empty loading={loading} text="Nothing has been removed." />
      ) : (
        items.map((r) => (
          <Card key={r.id}>
            <T style={{ fontWeight: '700' }}>
              A {r.kind} about {r.subjectNames.join(', ') || 'no subject'}
            </T>
            <T variant="small">
              {r.reason} · {r.at?.toDate().toLocaleDateString()}
            </T>
          </Card>
        ))
      )}
    </Screen>
  );
}
