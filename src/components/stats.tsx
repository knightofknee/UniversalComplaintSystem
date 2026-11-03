import { StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import type { Subject } from '@/lib/types';

function pct(n: number, of: number) {
  return of ? `${Math.round((n / of) * 100)}%` : '–';
}

/** The public scoreboard: what people say is wrong, and what the organization did about it. */
export function Stats({ subject }: { subject: Subject }) {
  const theme = useTheme();
  const { points, seen, responded, fixed } = subject.stats;
  const cells = [
    { label: 'Points', value: String(points) },
    { label: 'Seen', value: pct(seen, points) },
    { label: 'Responded', value: pct(responded, points) },
    { label: 'Fixed', value: String(fixed), hint: 'confirmed by supporters' },
  ];
  return (
    <View style={styles.stats}>
      {cells.map((c) => (
        <View key={c.label} style={[styles.cell, { backgroundColor: theme.backgroundElement }]}>
          <T variant="heading">{c.value}</T>
          <T variant="small">{c.label}</T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexGrow: 1, flexBasis: '22%', minWidth: 72, borderRadius: 12, padding: 10, gap: 2 },
});
