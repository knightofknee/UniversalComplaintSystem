import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { PointCard, PointList } from '@/components/point-card';
import { Empty, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import type { Point } from '@/lib/types';

/** Two columns need room for a readable point card each. */
const SIDE_BY_SIDE_MIN_WIDTH = 760;
const PREVIEW = 5;

export type ListSpec = {
  title: string;
  hint?: string;
  items: Point[];
  loading: boolean;
  empty: string;
};

/**
 * "Most supported" and "Rising this week" together: side by side where there
 * is room (tablet, web), one after the other on phones.
 */
export function PairedLists({ first, second, hideSubjects }: { first: ListSpec; second: ListSpec; hideSubjects?: boolean }) {
  const { width } = useWindowDimensions();
  const sideBySide = width >= SIDE_BY_SIDE_MIN_WIDTH;
  return (
    <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: sideBySide ? 16 : 24, alignItems: 'flex-start' }}>
      <Column spec={first} hideSubjects={hideSubjects} />
      <Column spec={second} hideSubjects={hideSubjects} />
    </View>
  );
}

function Column({ spec, hideSubjects }: { spec: ListSpec; hideSubjects?: boolean }) {
  const theme = useTheme();
  const [all, setAll] = useState(false);
  const shown = all ? spec.items : spec.items.slice(0, PREVIEW);
  return (
    <View style={{ flex: 1, alignSelf: 'stretch', gap: 10, minWidth: 0 }}>
      <View>
        <T variant="heading">{spec.title}</T>
        {spec.hint && <T variant="small">{spec.hint}</T>}
      </View>
      {shown.length === 0 ? (
        <Empty loading={spec.loading} text={spec.empty} />
      ) : (
        <PointList>
          {shown.map((p) => (
            <PointCard key={p.id} point={p} hideSubjects={hideSubjects} />
          ))}
        </PointList>
      )}
      {spec.items.length > PREVIEW && (
        <Pressable onPress={() => setAll((a) => !a)} accessibilityRole="button" hitSlop={8}>
          <T color={theme.primary} style={{ fontWeight: '700' }}>
            {all ? 'Show fewer' : `See all ${spec.items.length}`}
          </T>
        </Pressable>
      )}
    </View>
  );
}
