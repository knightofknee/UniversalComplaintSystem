import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Empty, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useBlockedAuthors } from '@/lib/blocks';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection } from '@/lib/hooks';
import type { Statement } from '@/lib/types';

/** Statements shown before "Show more". */
const PAGE = 20;
/** Read at most this many; an issue with more still shows its newest. */
const READ = 200;

/**
 * What each complaint said about one issue (functions/src/statements.ts),
 * people before imported public records, newest first. Each one opens the
 * complaint it came from, in its author's own words.
 */
export function Statements({ pointId, onAdd }: { pointId: string; onAdd: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const blocked = useBlockedAuthors();
  const [shown, setShown] = useState(PAGE);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const list = useCollection<Statement>(
    query(
      collection(db, `points/${pointId}/statements`),
      where('removed', '==', false),
      orderBy('createdAt', 'desc'),
      limit(READ),
    ),
    `statements:${pointId}`,
  );
  const sorted = useMemo(
    () => [...list.items].sort((a, b) => Number(a.imported) - Number(b.imported)),
    [list.items],
  );
  const count = sorted.length;
  return (
    <View style={{ gap: 4 }}>
      <T variant="label">
        What {count === 1 ? 'the complaint says' : `${count >= READ ? `${READ}+` : count} complaints say`} about it
      </T>
      {count === 0 ? (
        <Empty text="" loading={list.loading} />
      ) : (
        <View>
          {sorted.slice(0, shown).map((s) => {
            const hidden = !!s.authorId && blocked.ids.has(s.authorId) && !opened.has(s.id);
            if (hidden) {
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setOpened((o) => new Set(o).add(s.id))}
                  accessibilityRole="button"
                  accessibilityLabel="Said by an author you hid. Tap to show it."
                  style={[styles.row, { borderTopColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                  <Ionicons name="eye-off-outline" size={16} color={theme.textSecondary} />
                  <T variant="small" style={{ flex: 1 }}>
                    Hidden by you
                  </T>
                  <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
                    Show
                  </T>
                </Pressable>
              );
            }
            return (
              <Pressable
                key={s.id}
                onPress={() => router.push(`/submission/${s.submissionId}`)}
                accessibilityRole="link"
                accessibilityHint="Opens the complaint this came from"
                style={({ pressed }) => [styles.row, { borderTopColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
                <T>{s.text}</T>
                <T variant="small">
                  {s.authorName} · {timeAgo(s.createdAt?.toMillis())} ·{' '}
                  <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
                    Read the complaint
                  </T>
                </T>
              </Pressable>
            );
          })}
        </View>
      )}
      {count > shown && <Button kind="secondary" label="Show more" onPress={() => setShown(shown + PAGE)} />}
      <Button kind="secondary" label="I have more to add" icon="add" onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12, gap: 4 },
});
