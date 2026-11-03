import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Chip, Row, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, supportPoint } from '@/lib/api';
import { db } from '@/lib/firebase';
import type { PointHit, PointStatus } from '@/lib/types';

export const STATUS_LABEL: Record<PointStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  planned: 'Fix planned',
  fix_claimed: 'Fix claimed',
  fixed: 'Fixed',
  not_fixed: 'Not fixed',
  wont_fix: "Won't fix",
};

export function StatusChip({ status }: { status: PointStatus }) {
  const theme = useTheme();
  if (status === 'open') return null;
  const [color, bg] =
    status === 'fixed'
      ? [theme.good, theme.goodSoft]
      : status === 'not_fixed' || status === 'wont_fix'
        ? [theme.danger, theme.dangerSoft]
        : [theme.warning, theme.warningSoft];
  return <Chip label={STATUS_LABEL[status]} color={color} bg={bg} />;
}

export function showAlert(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

/** "Me too" button. Your support is private; only the count is public. */
export function SupportButton({ pointId, count }: { pointId: string; count: number }) {
  const theme = useTheme();
  const { user } = useAuth();
  const [mine, setMine] = useState<boolean | null>(null);
  const [pending, setPending] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, `points/${pointId}/supports/${user.uid}`), (s) => setMine(s.exists()));
  }, [pointId, user]);

  const on = pending ?? mine ?? false;
  // Show the count the person expects right away, before the server catches up.
  const shown = count + (pending === null || pending === mine ? 0 : pending ? 1 : -1);

  const toggle = async () => {
    const next = !on;
    setPending(next);
    try {
      await supportPoint({ pointId, support: next });
    } catch (e) {
      showAlert("Couldn't save that", errorText(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={on ? 'Remove your support' : 'Support this point'}
      accessibilityState={{ selected: on }}
      hitSlop={8}
      style={[
        styles.support,
        { backgroundColor: on ? theme.primary : theme.background, borderColor: theme.primary },
      ]}>
      <Ionicons name={on ? 'hand-left' : 'hand-left-outline'} size={16} color={on ? theme.onPrimary : theme.primary} />
      <Text style={{ color: on ? theme.onPrimary : theme.primary, fontWeight: '800' }}>
        Me too · {shown}
      </Text>
    </Pressable>
  );
}

export function PointCard({
  point,
  rank,
  hideSubjects,
}: {
  point: PointHit & { hot?: boolean };
  rank?: number;
  hideSubjects?: boolean;
}) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Card onPress={() => router.push(`/point/${point.id}`)}>
      <Row style={{ alignItems: 'flex-start' }}>
        {rank !== undefined && (
          <T variant="heading" color={theme.textSecondary} style={{ width: 28 }}>
            {rank}
          </T>
        )}
        <View style={{ flex: 1, gap: 8 }}>
          <T>{point.text}</T>
          <Row style={{ flexWrap: 'wrap' }}>
            <SupportButton pointId={point.id} count={point.supportCount} />
            <StatusChip status={point.status} />
            {point.hot && <Chip label="Rant" color={theme.rant} bg={theme.rantSoft} />}
          </Row>
          {!hideSubjects && point.subjectNames.length > 0 && (
            <T variant="small" numberOfLines={1}>
              {point.subjectNames.join(' · ')}
            </T>
          )}
        </View>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  support: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
