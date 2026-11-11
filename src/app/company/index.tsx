import { useRouter } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Switch, Text, View as Box } from 'react-native';

import { PointCard, PointList, showAlert } from '@/components/point-card';
import { showToast } from '@/components/toast';
import { Fonts } from '@/constants/theme';
import { Stats } from '@/components/stats';
import { Button, Card, Chip, Empty, Notice, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, setOrgSettings } from '@/lib/api';
import { db } from '@/lib/firebase';
import { count, timeAgo, useCollection, useDoc } from '@/lib/hooks';
import type { Point, PrivatePoint, Subject, Thread } from '@/lib/types';

type Section = 'points' | 'inbox' | 'settings';
type View = 'top' | 'unseen' | 'unanswered' | 'claimed' | 'fixes' | 'trending' | 'new' | 'private';

/**
 * What a feedback vendor and a support desk would sell them, in one place:
 * every point about the organization (duplicates merged, public and private
 * counts side by side) and the private complaints sent to it.
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
  const router = useRouter();
  const { data: subject } = useDoc<Subject>(`subjects/${subjectId}`);
  const [section, setSection] = useState<Section>('points');
  const privatePoints = useCollection<PrivatePoint>(
    query(collection(db, `subjects/${subjectId}/privatePoints`), limit(1000)),
    `private:${subjectId}`,
  );
  const inbox = useCollection<Thread>(
    query(collection(db, `subjects/${subjectId}/inbox`), orderBy('lastMessageAt', 'desc'), limit(200)),
    `inbox:${subjectId}`,
  );
  const unread = inbox.items.filter((t) => t.unreadByOrg).length;
  const privateTotal = privatePoints.items.reduce((n, p) => n + p.count, 0);

  return (
    <Screen>
      {orgs.length > 1 && (
        <Tabs
          options={orgs.map((o) => ({ key: o, label: o === subjectId ? (subject?.name ?? '…') : 'Switch' }))}
          value={subjectId}
          onChange={onSwitch}
        />
      )}
      <T variant="title">{subject?.name ?? ''}</T>
      {subject && <Stats subject={subject} />}
      <T variant="small">
        Public numbers above. Private: {count(privateTotal, 'complaint')} across{' '}
        {count(privatePoints.items.length, 'issue')}, visible only to your team.
      </T>
      <Tabs
        options={[
          { key: 'points', label: 'Issues' },
          { key: 'inbox', label: unread ? `Private inbox · ${unread}` : 'Private inbox' },
          { key: 'settings', label: 'Settings' },
        ]}
        value={section}
        onChange={setSection}
      />
      {section === 'points' && <Points subjectId={subjectId} privatePoints={privatePoints.items} />}
      {section === 'inbox' && <Inbox subjectId={subjectId} threads={inbox.items} loading={inbox.loading} />}
      {section === 'settings' && subject && <Settings subject={subject} />}
      <Button kind="quiet" icon="add" label="Respond for another organization" onPress={() => router.push('/company/claim')} />
    </Screen>
  );
}

function Points({ subjectId, privatePoints }: { subjectId: string; privatePoints: PrivatePoint[] }) {
  const theme = useTheme();
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
  const privateByPoint = useMemo(
    () => new Map(privatePoints.flatMap((p) => (p.pointId ? [[p.pointId, p.count] as const] : []))),
    [privatePoints],
  );
  const [weekAgo] = useState(() => Date.now() - 7 * 24 * 3600_000);
  const shown = items.filter((p) => {
    if (view === 'unseen') return !p.seenBy?.[subjectId];
    if (view === 'unanswered') return needsResponse(p, subjectId);
    if (view === 'claimed') return p.orgStatus?.[subjectId]?.status === 'fix_claimed';
    if (view === 'fixes') return (p.solutionCount ?? 0) > 0;
    if (view === 'trending') return (p.lastActivityAt?.toMillis() ?? 0) > weekAgo;
    return true;
  });
  if (view === 'trending') {
    shown.sort((a, b) => (b.lastActivityAt?.toMillis() ?? 0) - (a.lastActivityAt?.toMillis() ?? 0));
  }
  const privateOnly = privatePoints.filter((p) => p.isPrivateOnly).sort((a, b) => b.count - a.count);

  return (
    <>
      <Summary points={items} subjectId={subjectId} onView={setView} />
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
          { key: 'claimed', label: 'Fix awaiting confirmation' },
          { key: 'fixes', label: 'Fixes people proposed' },
          { key: 'trending', label: 'Active this week' },
          { key: 'new', label: 'Newest' },
          { key: 'private', label: 'Private only' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'private' ? (
        privateOnly.length === 0 ? (
          <Empty text="Nothing raised only privately." />
        ) : (
          privateOnly.map((p) => (
            <Card key={p.id}>
              <T>{p.text}</T>
              <Row>
                <Chip label={`${count(p.count, 'private complaint')}`} color={theme.primary} bg={theme.primarySoft} />
                <T variant="small">Not on the public record · last {timeAgo(p.lastAt?.toMillis())}</T>
              </Row>
            </Card>
          ))
        )
      ) : shown.length === 0 ? (
        <Empty loading={loading} text="Nothing here." />
      ) : (
        <PointList>
          {shown.map((p) => (
            <PointCard
              key={p.id}
              point={p}
              hideSubjects
              note={privateByPoint.get(p.id) ? `+${privateByPoint.get(p.id)} private` : undefined}
            />
          ))}
        </PointList>
      )}
    </>
  );
}

const needsResponse = (p: Point, subjectId: string) => !p.respondedBy?.[subjectId] && p.status !== 'fixed';

function hours(ms: number) {
  const h = ms / 3600_000;
  if (h < 1) return 'under an hour';
  if (h < 48) return `${Math.round(h)} hours`;
  return `${Math.round(h / 24)} days`;
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/**
 * The numbers an organization runs on, worked out from its points: what is
 * waiting on it, how fast it answers, what the complaints are about, and
 * where support is growing. Each "waiting" number opens that list. Covers
 * the points loaded (the 300 most supported).
 */
function Summary({ points, subjectId, onView }: { points: Point[]; subjectId: string; onView: (v: View) => void }) {
  const theme = useTheme();
  const s = useMemo(() => {
    const waiting = points.filter((p) => needsResponse(p, subjectId));
    const unseen = points.filter((p) => !p.seenBy?.[subjectId]);
    const claimed = points.filter((p) => p.orgStatus?.[subjectId]?.status === 'fix_claimed');
    const fixed = points.filter((p) => p.orgStatus?.[subjectId]?.status === 'fixed');
    const proposed = points.filter((p) => (p.solutionCount ?? 0) > 0);
    const responded = points.filter((p) => p.respondedBy?.[subjectId]);
    const waits = responded
      .map((p) => (p.firstRespondedBy?.[subjectId] ?? p.respondedBy[subjectId]).toMillis() - (p.createdAt?.toMillis() ?? 0))
      .filter((ms) => ms > 0)
      .sort((a, b) => a - b);
    const sum = (list: Point[], f: (p: Point) => number) => list.reduce((n, p) => n + f(p), 0);
    // What it is about: the kinds of problem these points are filed under.
    const topics = new Map<string, { points: number; people: number }>();
    for (const p of points) {
      p.subjectIds.forEach((id, i) => {
        if (!p.topicIds?.includes(id)) return;
        const t = topics.get(p.subjectNames[i]) ?? { points: 0, people: 0 };
        t.points++;
        t.people += p.supportCount;
        topics.set(p.subjectNames[i], t);
      });
    }
    return {
      waiting,
      unseen,
      claimed,
      fixed,
      proposed,
      waitingPeople: sum(waiting, (p) => p.supportCount),
      rate: points.length ? Math.round((responded.length / points.length) * 100) : 0,
      median: waits.length ? hours(waits[Math.floor(waits.length / 2)]) : null,
      weekNew: sum(points, (p) => p.weekSupport ?? 0),
      rising: points.filter((p) => (p.weekSupport ?? 0) > 0).length,
      here: sum(points, (p) => p.people ?? 0),
      total: sum(points, (p) => p.supportCount),
      topics: [...topics.entries()].sort((a, b) => b[1].people - a[1].people).slice(0, 5),
    };
  }, [points, subjectId]);

  const exportCsv = async () => {
    const rows = [
      ['Issue', 'People', 'New this week', 'Complaints', 'Status', 'Seen', 'Responded', 'Proposed fixes', 'First raised', 'Filed under'],
      ...points.map((p) => [
        p.text,
        p.supportCount,
        p.weekSupport ?? 0,
        p.submissionCount,
        p.orgStatus?.[subjectId]?.status ?? 'open',
        p.seenBy?.[subjectId] ? 'yes' : 'no',
        p.respondedBy?.[subjectId] ? 'yes' : 'no',
        p.solutionCount ?? 0,
        p.createdAt ? new Date(p.createdAt.toMillis()).toISOString().slice(0, 10) : '',
        p.subjectNames.join('; '),
      ]),
    ];
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    if (Platform.OS === 'web') {
      await (globalThis.navigator as Navigator | undefined)?.clipboard?.writeText(csv);
      showToast('Copied', 'The table is on your clipboard. Paste it into a spreadsheet.', 'info');
    } else await Share.share({ message: csv }).catch(() => {});
  };

  if (points.length === 0) return null;
  const tiles: { n: number; label: string; sub?: string; view?: View; alert?: boolean }[] = [
    { n: s.waiting.length, label: 'need a response', sub: `${s.waitingPeople.toLocaleString()} people waiting`, view: 'unanswered', alert: s.waiting.length > 0 },
    { n: s.unseen.length, label: 'not yet seen', view: 'unseen' },
    { n: s.claimed.length, label: 'fixes awaiting confirmation', view: 'claimed' },
    { n: s.proposed.length, label: 'have fixes people proposed', view: 'fixes' },
    { n: s.rising, label: 'gained support this week', sub: `+${s.weekNew.toLocaleString()} people`, view: 'trending' },
    { n: s.fixed.length, label: 'confirmed fixed' },
  ];
  return (
    <Card>
      <T variant="label">Where things stand</T>
      <Box style={styles.tiles}>
        {tiles.map((t) => (
          <Pressable
            key={t.label}
            disabled={!t.view}
            onPress={() => t.view && onView(t.view)}
            accessibilityRole={t.view ? 'button' : 'text'}
            accessibilityLabel={`${t.n} ${t.label}${t.sub ? `, ${t.sub}` : ''}`}
            style={({ pressed }) => [styles.tile, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.tileN, { color: t.alert ? theme.warning : theme.text }]}>{t.n.toLocaleString()}</Text>
            <T variant="small" color={theme.text}>
              {t.label}
            </T>
            {t.sub && <T variant="small">{t.sub}</T>}
          </Pressable>
        ))}
      </Box>
      <T variant="small">
        You have responded to {s.rate}% of these points
        {s.median ? `, typically ${s.median} after an issue is first raised` : ''}. {s.total.toLocaleString()} people in
        all; {s.here.toLocaleString()} of them complained or added their support here, the rest come from public
        records.
      </T>
      {s.topics.length > 0 && (
        <>
          <T variant="label">What it is about</T>
          {s.topics.map(([name, t]) => (
            <Row key={name} style={{ justifyContent: 'space-between' }}>
              <T style={{ flex: 1 }} numberOfLines={1}>
                {name}
              </T>
              <T variant="small">
                {t.people.toLocaleString()} people · {count(t.points, 'issue')}
              </T>
            </Row>
          ))}
        </>
      )}
      <Button kind="quiet" icon="download-outline" label="Export these issues as a table" onPress={exportCsv} />
    </Card>
  );
}

function Inbox({ subjectId, threads, loading }: { subjectId: string; threads: Thread[]; loading: boolean }) {
  const router = useRouter();
  const theme = useTheme();
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const shown = threads.filter((t) => t.status === filter);
  return (
    <>
      <Tabs
        options={[
          { key: 'open', label: `Open · ${threads.filter((t) => t.status === 'open').length}` },
          { key: 'resolved', label: 'Resolved' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {shown.length === 0 ? (
        <Empty loading={loading} text={filter === 'open' ? 'No open private complaints.' : 'Nothing resolved yet.'} />
      ) : (
        shown.map((t) => (
          <Card key={t.id} onPress={() => router.push(`/thread/${subjectId}/${t.id}`)}>
            <Row style={{ flexWrap: 'wrap' }}>
              <T style={{ fontWeight: '700', flex: 1 }}>{t.authorName}</T>
              {t.unreadByOrg && <Chip label="New" color={theme.primary} bg={theme.primarySoft} />}
              {t.lastFrom === 'user' && !t.unreadByOrg && t.status === 'open' && (
                <Chip label="Awaiting reply" color={theme.warning} bg={theme.warningSoft} />
              )}
            </Row>
            <T numberOfLines={2}>{t.englishText ?? t.text}</T>
            <T variant="small">{timeAgo(t.lastMessageAt?.toMillis())}</T>
          </Card>
        ))
      )}
    </>
  );
}

/** Advanced, and deliberately quiet: most organizations never need it. */
function Settings({ subject }: { subject: Subject }) {
  const [busy, setBusy] = useState(false);
  const on = subject.publishPrivate === true;
  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await setOrgSettings({ subjectId: subject.id, publishPrivate: next });
    } catch (e) {
      showAlert("Couldn't change that", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <T variant="label">Advanced</T>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="heading" style={{ flex: 1 }}>
          Show private counts publicly
        </T>
        <Switch value={on} onValueChange={toggle} disabled={busy} />
      </Row>
      <T variant="small">
        Public points about {subject.name} would show how many people also raised them privately, and those people
        could confirm your fixes. What they wrote stays private either way: only the numbers are shown.
      </T>
    </Card>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '45%', borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  tileN: { fontFamily: Fonts.display, fontSize: 26 },
});
