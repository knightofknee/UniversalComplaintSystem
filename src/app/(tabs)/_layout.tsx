import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { collection, limit, query, where } from 'firebase/firestore';

import { Fonts } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/hooks';

/** The tabs open on Complaints: "new" is only a redirect, and as the initial tab it would bounce straight back. */
export const unstable_settings = { initialRouteName: 'browse' };

/** Everything past the complaint box. "New" (far left) opens the box over these tabs. */
export default function TabsLayout() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  // Something happened on one of their complaints: say so on the tab, not only inside it.
  const unread = useCollection<{ id: string }>(
    user ? query(collection(db, `users/${user.uid}/notifications`), where('read', '==', false), limit(20)) : null,
    `tab-unread:${user?.uid}`,
  );
  return (
    <Tabs
      initialRouteName="browse"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontFamily: Fonts.bold, fontSize: 11 },
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
      }}>
      <Tabs.Screen
        name="new"
        options={{
          title: 'New',
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size + 4} color={color} />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/');
          },
        }}
      />
      <Tabs.Screen
        name="browse"
        options={{
          title: 'Complaints',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Me',
          tabBarBadge: unread.items.length ? (unread.items.length >= 20 ? '20+' : unread.items.length) : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.primaryFill, color: theme.onPrimary, fontSize: 11 },
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
