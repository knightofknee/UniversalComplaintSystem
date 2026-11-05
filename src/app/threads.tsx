import { useRouter } from 'expo-router';
import { collection, orderBy, query } from 'firebase/firestore';

import { Card, Chip, Empty, Row, Screen, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection } from '@/lib/hooks';
import type { MyThread } from '@/lib/types';

/** The author's private complaints, newest activity first. */
export default function ThreadsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const { items, loading } = useCollection<MyThread>(
    user ? query(collection(db, `users/${user.uid}/threads`), orderBy('lastMessageAt', 'desc')) : null,
    `threads:${user?.uid}`,
  );
  return (
    <Screen>
      <T variant="small">Only you and the organization can see these.</T>
      {items.length === 0 ? (
        <Empty loading={loading} text="No private complaints yet. You can choose private when you complain about an organization." />
      ) : (
        items.map((t) => (
          <Card key={t.id} onPress={() => router.push(`/thread/${t.orgId}/${t.id}`)}>
            <Row style={{ flexWrap: 'wrap' }}>
              <T style={{ fontWeight: '700', flex: 1 }}>{t.orgName}</T>
              {t.unread && <Chip label="New reply" color={theme.primary} bg={theme.primarySoft} />}
              {t.status === 'resolved' && <Chip label="Resolved" color={theme.good} bg={theme.goodSoft} />}
            </Row>
            <T numberOfLines={2}>{t.preview}</T>
            <T variant="small">{timeAgo(t.lastMessageAt?.toMillis())}</T>
          </Card>
        ))
      )}
    </Screen>
  );
}
