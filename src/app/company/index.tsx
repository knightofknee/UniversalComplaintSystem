import { useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';

import { PointCard } from '@/components/point-card';
import { Stats } from '@/components/stats';
import { Button, Empty, Notice, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { useCollection, useDoc } from '@/lib/hooks';
import type { Point, Subject } from '@/lib/types';

type View = 'top' | 'unseen' | 'unanswered' | 'new' | 'trending';

/**
 * What a feedback vendor would sell them: every point about the
 * organization, duplicates already merged, sorted the ways they work.
 */
export default function CompanyScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const orgs = profile?.responderFor ?? [];
  const [orgId, setOrgId] = useState<string | null>(null);
  const current = orgId ?? orgs[0] ?? null;
  if (!current) {
    return (
      <Screen>
        <T>You don&apos;t respond for an organization yet.</T>
        <Button label="Respond for an organization" onPress={() => router.push('/company/claim')} />
      </Screen>
    );
  }
  return <Dashboard key={current} subjectId={current} orgs={orgs} onSwitch={setOrgId} />;
}

function Dashboard({ subjectId, orgs, onSwitch }: { subjectId: string; orgs: string[]; onSwitch: (id: string) => void }) {
  const { data: subject } = useDoc<Subject>(`subjects/${subjectId}`);
  const [view, setView] = useState<View>('top');
  const { items, loading } = useCollection<Point>(
    query(
      collection(db, 'points'),
      where('removed', '==', false),
      where('subjectIds', 'array-contains', subjectId),
      orderBy(view === 'new' ? 'createdAt' : 'supportCount', 'desc'),
      limit(300),
    ),
    `dash:${subjectId}:${view === 'new' ? 'new' : 'top'}`,
  );
  const [weekAgo] = useState(() => Date.now() - 7 * 24 * 3600_000);
  const shown = items.filter((p) => {
    if (view === 'unseen') return !p.seenBy?.[subjectId];
    if (view === 'unanswered') return !p.respondedBy?.[subjectId] && p.status !== 'fixed';
    if (view === 'trending') return (p.lastActivityAt?.toMillis() ?? 0) > weekAgo;
    return true;
  });
  if (view === 'trending') {
    shown.sort((a, b) => (b.lastActivityAt?.toMillis() ?? 0) - (a.lastActivityAt?.toMillis() ?? 0));
  }
  return (
    <Screen>
      {orgs.length > 1 && (
        <Tabs options={orgs.map((o) => ({ key: o, label: o === subjectId ? (subject?.name ?? '…') : 'Switch' }))} value={subjectId} onChange={onSwitch} />
      )}
      <T variant="title">{subject?.name ?? ''}</T>
      {subject && <Stats subject={subject} />}
      <Notice>
        <T variant="small">
          Opening a point marks it seen. Respond on the point itself; supporters are notified, and anything you mark
          fixed is confirmed by them.
        </T>
      </Notice>
      <Tabs
        options={[
          { key: 'top', label: 'Most supported' },
          { key: 'unseen', label: 'Unseen' },
          { key: 'unanswered', label: 'No response' },
          { key: 'trending', label: 'Active this week' },
          { key: 'new', label: 'Newest' },
        ]}
        value={view}
        onChange={setView}
      />
      {shown.length === 0 ? (
        <Empty loading={loading} text="Nothing here." />
      ) : (
        shown.map((p) => <PointCard key={p.id} point={p} hideSubjects />)
      )}
    </Screen>
  );
}
