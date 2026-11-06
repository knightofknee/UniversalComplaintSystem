import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Field, Row, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/firebase';

export type Tag = { id: string | null; name: string; kind: 'organization' | 'topic'; isNew?: boolean };

/**
 * What a complaint is filed under. The model picks; the author can untag
 * or add existing organizations and topics, but can't invent new ones (that
 * keeps everyone landing in the same buckets).
 */
export function FiledUnder({
  tags,
  removed,
  onRemove,
  onRestore,
  added,
  onAdd,
  onUnadd,
}: {
  tags: Tag[];
  removed: Set<number>;
  onRemove: (i: number) => void;
  onRestore: (i: number) => void;
  added: Tag[];
  onAdd: (t: Tag) => void;
  onUnadd: (id: string) => void;
}) {
  const theme = useTheme();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Tag[]>([]);
  const active = adding && q.trim().length >= 2;

  useEffect(() => {
    const lower = q.trim().toLowerCase();
    if (!adding || lower.length < 2) return;
    const t = setTimeout(() => {
      getDocs(
        query(
          collection(db, 'subjects'),
          where('removed', '==', false),
          orderBy('nameLower'),
          where('nameLower', '>=', lower),
          where('nameLower', '<', `${lower}`),
          limit(6),
        ),
      )
        .then((s) => setResults(s.docs.map((d) => ({ id: d.id, name: d.get('name'), kind: d.get('kind') }))))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, adding]);

  const taken = new Set([...tags.map((t) => t.id), ...added.map((t) => t.id)]);
  return (
    <View style={{ gap: 10 }}>
      <View>
        <T variant="heading">Filed under</T>
        <T variant="small">Picked by the model. Tap one to untag it, or add another.</T>
      </View>
      <Row style={{ flexWrap: 'wrap' }}>
        {tags.map((t, i) => (
          <TagChip
            key={`m${i}`}
            tag={t}
            off={removed.has(i)}
            onPress={() => (removed.has(i) ? onRestore(i) : onRemove(i))}
          />
        ))}
        {added.map((t) => (
          <TagChip key={`a${t.id}`} tag={t} onPress={() => onUnadd(t.id!)} />
        ))}
        {!adding && (
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            style={[styles.chip, { borderColor: theme.primary, borderStyle: 'dashed' }]}>
            <Ionicons name="add" size={14} color={theme.primary} />
            <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 13 }}>Add</Text>
          </Pressable>
        )}
      </Row>
      {adding && (
        <>
          <Field value={q} onChangeText={setQ} placeholder="Find an organization or topic" autoFocus autoCorrect={false} />
          {(active ? results : [])
            .filter((r) => !taken.has(r.id))
            .map((r) => (
              <Pressable
                key={r.id}
                onPress={() => {
                  onAdd(r);
                  setQ('');
                  setAdding(false);
                }}
                style={{ paddingVertical: 6 }}>
                <T>
                  {r.name} <T variant="small">· {r.kind === 'topic' ? 'topic' : 'organization'}</T>
                </T>
              </Pressable>
            ))}
          <Pressable onPress={() => setAdding(false)} hitSlop={8}>
            <T variant="small" color={theme.primary}>
              Done
            </T>
          </Pressable>
        </>
      )}
    </View>
  );
}

function TagChip({ tag, off, onPress }: { tag: Tag; off?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const color = off ? theme.textSecondary : tag.isNew ? theme.new : theme.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={off ? `Tag ${tag.name} again` : `Untag ${tag.name}`}
      style={[
        styles.chip,
        {
          borderColor: off ? theme.border : tag.isNew ? theme.new : theme.border,
          backgroundColor: off ? 'transparent' : tag.isNew ? theme.newSoft : theme.backgroundElement,
        },
      ]}>
      <Ionicons name={tag.kind === 'topic' ? 'pricetag-outline' : 'business-outline'} size={13} color={color} />
      <Text style={{ color, fontWeight: '600', fontSize: 13, textDecorationLine: off ? 'line-through' : 'none' }}>
        {tag.name}
        {tag.isNew ? ' · new' : ''}
      </Text>
      <Ionicons name={off ? 'refresh' : 'close'} size={13} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
