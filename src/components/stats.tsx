import { StyleSheet, View } from 'react-native';

import { Notice, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import type { Subject } from '@/lib/types';

function pct(n: number, of: number) {
  return of ? `${Math.round((n / of) * 100)}%` : '–';
}

/**
 * The public scoreboard: what people say is wrong, and what the
 * organization did about it. An organization that hasn't joined isn't shown
 * as "0% responded" (it may never have heard of UCS); it says so plainly.
 */
export function Stats({ subject }: { subject: Subject }) {
  const theme = useTheme();
  const { points, seen, responded, fixed, supporters = 0 } = subject.stats;
  const joined = subject.claimed;
  const cells = joined
    ? [
        { label: 'Issues', value: String(points) },
        { label: 'Seen', value: pct(seen, points) },
        { label: 'Responded', value: pct(responded, points) },
        { label: 'Fixed', value: String(fixed) },
      ]
    : [
        { label: 'Issues', value: String(points) },
        { label: 'People', value: String(supporters) },
      ];
  return (
    <>
      <View style={styles.stats}>
        {cells.map((c) => (
          <View key={c.label} style={[styles.cell, { backgroundColor: theme.backgroundElement }]}>
            <T variant="heading">{c.value}</T>
            <T variant="small">{c.label}</T>
          </View>
        ))}
      </View>
      {joined ? (
        <T variant="small">Fixed counts only what supporters confirmed.</T>
      ) : (
        <Notice tone="warn">
          <T variant="small">
            {subject.name} hasn&apos;t joined UCS yet, so nothing here has been seen or answered by them. Its scoreboard
            starts when it does. Know someone there? Share this page.
          </T>
        </Notice>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexGrow: 1, flexBasis: '22%', minWidth: 72, borderRadius: 12, padding: 10, gap: 2 },
});
