import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { showToast } from '@/components/toast';
import { Chip, Row, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, supportPoint } from '@/lib/api';
import { db } from '@/lib/firebase';
import { tapHaptic } from '@/lib/haptics';
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

/** Kept for older call sites: a note at the top of the screen, never a pop-up. */
export function showAlert(title: string, message?: string) {
  showToast(title, message);
}

/** 2,572 → "2.6k" in rows; exact on the point's own page. */
export function shortCount(n: number) {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

/** Whether I support a point, with the change I just made shown before the server confirms it. */
function useSupport(pointId: string, count: number) {
  const { user } = useAuth();
  const [mine, setMine] = useState<boolean | null>(null);
  const [pending, setPending] = useState<boolean | null>(null);
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, `points/${pointId}/supports/${user.uid}`), (s) => setMine(s.exists()));
  }, [pointId, user]);

  const on = pending ?? mine ?? false;
  const shown = count + (pending === null || pending === mine ? 0 : pending ? 1 : -1);
  const toggle = async () => {
    const nextOn = !on;
    setPending(nextOn);
    if (nextOn) {
      tapHaptic();
      scale.setValue(0.82);
      Animated.spring(scale, { toValue: 1, friction: 3, tension: 240, useNativeDriver: Platform.OS !== 'web' }).start();
    }
    try {
      await supportPoint({ pointId, support: nextOn });
    } catch (e) {
      showToast("That didn't save", errorText(e));
    } finally {
      setPending(null);
    }
  };
  return { on, shown, toggle, scale };
}

/**
 * The upvote: a small box beside the row, arrow over count. Same meaning as
 * "Same here" (you have this problem too); support is private, the count public.
 */
export function Vote({ pointId, count }: { pointId: string; count: number }) {
  const theme = useTheme();
  const { on, shown, toggle, scale } = useSupport(pointId, count);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={toggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={on ? `You said same here. ${shown} people have this problem. Tap to take it back.` : `Same here. ${shown} people have this problem.`}
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [
          styles.vote,
          {
            backgroundColor: on ? theme.primaryFill : theme.backgroundElement,
            borderColor: on ? theme.primaryFill : theme.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}>
        <Ionicons name="arrow-up" size={18} color={on ? theme.onPrimary : theme.primary} />
        <Text style={[styles.voteCount, { color: on ? theme.onPrimary : theme.text }]}>{shortCount(shown)}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The one big "Same here" on a point's own page. */
export function SupportButton({ pointId, count }: { pointId: string; count: number }) {
  const theme = useTheme();
  const { on, shown, toggle, scale } = useSupport(pointId, count);
  return (
    <Animated.View style={{ transform: [{ scale }], alignSelf: 'flex-start' }}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={on ? 'Take back your "Same here"' : 'Same here: you have this problem too'}
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [
          styles.hero,
          {
            backgroundColor: on ? theme.primaryFill : theme.backgroundElement,
            borderColor: on ? theme.primaryFill : theme.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}>
        <Ionicons name={on ? 'checkmark' : 'arrow-up'} size={20} color={on ? theme.onPrimary : theme.primary} />
        <Text style={[styles.heroLabel, { color: on ? theme.onPrimary : theme.text }]}>
          {on ? 'You too' : 'Same here'}
        </Text>
        <Text style={[styles.heroCount, { color: on ? theme.onPrimary : theme.textSecondary }]}>
          {shown.toLocaleString()}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Rows sit flush with hairlines between them. */
export function PointList({ children }: { children: ReactNode }) {
  return <View>{children}</View>;
}

export function PointCard({
  point,
  rank,
  hideSubjects,
  note,
}: {
  point: PointHit & { hot?: boolean };
  rank?: number;
  hideSubjects?: boolean;
  /** A small extra label, e.g. an organization's private count on its own dashboard. */
  note?: string;
}) {
  const router = useRouter();
  const theme = useTheme();
  const meta = !hideSubjects && point.subjectNames.length > 0 ? point.subjectNames.slice(0, 3).join(' · ') : '';
  return (
    <Pressable
      onPress={() => router.push(`/point/${point.id}`)}
      style={({ pressed }) => [styles.row, { borderTopColor: theme.border }, pressed && { opacity: 0.7 }]}>
      {rank !== undefined && (
        <Text style={[styles.rank, { color: theme.textSecondary }]}>{rank}</Text>
      )}
      <View style={{ flex: 1, gap: 6 }}>
        <T numberOfLines={4} style={{ fontSize: 16, lineHeight: 22 }}>
          {point.text}
        </T>
        {(meta || point.hot || point.status !== 'open' || note) && (
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            <StatusChip status={point.status} />
            {point.hot && <Chip label="🔥 rant" color={theme.rant} bg={theme.rantSoft} />}
            {note && <Chip label={note} color={theme.primary} bg={theme.primarySoft} />}
            {meta ? (
              <T variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                {meta}
              </T>
            ) : null}
          </Row>
        )}
      </View>
      <Vote pointId={point.id} count={point.supportCount} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rank: { fontFamily: Fonts.display, fontSize: 22, width: 26, marginTop: -2 },
  vote: {
    width: 52,
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  voteCount: { fontFamily: Fonts.bold, fontSize: 15 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  heroLabel: { fontFamily: Fonts.bold, fontSize: 18 },
  heroCount: { fontFamily: Fonts.medium, fontSize: 18 },
});
