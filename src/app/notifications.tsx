import { useRouter } from 'expo-router';
import { collection, doc, limit, orderBy, query, updateDoc } from 'firebase/firestore';

import { Card, Empty, Row, Screen, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection } from '@/lib/hooks';
import type { Notification } from '@/lib/types';

export default function NotificationsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const { items, loading } = useCollection<Notification>(
    user ? query(collection(db, `users/${user.uid}/notifications`), orderBy('at', 'desc'), limit(100)) : null,
    `notifications:${user?.uid}`,
  );
  const open = (n: Notification) => {
    if (!n.read && user) updateDoc(doc(db, `users/${user.uid}/notifications/${n.id}`), { read: true }).catch(() => {});
    if (n.pointId) router.push(`/point/${n.pointId}`);
    else if (n.subjectId) router.push(`/subject/${n.subjectId}`);
  };
  return (
    <Screen>
      {items.length === 0 ? (
        <Empty loading={loading} text="When something moves on a point you support, it shows up here." />
      ) : (
        items.map((n) => (
          <Card key={n.id} onPress={() => open(n)}>
            <Row style={{ alignItems: 'flex-start' }}>
              {!n.read && <T color={theme.primary}>●</T>}
              <T style={{ flex: 1 }}>{n.text}</T>
            </Row>
            <T variant="small">{timeAgo(n.at?.toMillis())}</T>
          </Card>
        ))
      )}
    </Screen>
  );
}
