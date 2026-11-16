import { collection, limit, orderBy, query } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';

import { Card, Empty, Screen, T } from '@/components/ui';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/hooks';

type Removal = { id: string; kind: string; subjectNames: string[]; reason: string; at: Timestamp | null };

/** Every removal from the record, and why. */
/** The record's own words for what was removed (the log stores the collection's kind). */
const KIND_WORD: Record<string, string> = {
  point: 'issue',
  submission: 'complaint',
  subject: 'page',
  response: 'response',
  solution: 'proposed fix',
  message: 'private message',
  thread: 'private conversation',
};

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
        <Empty loading={loading} text="Nothing here yet." />
      ) : (
        items.map((r) => (
          <Card key={r.id}>
            <T style={{ fontWeight: '700' }}>
              A {KIND_WORD[r.kind] ?? 'post'} about {r.subjectNames.join(', ') || 'no company or topic'}
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
