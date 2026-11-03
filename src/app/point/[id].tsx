import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';

import { showAlert, StatusChip, STATUS_LABEL, SupportButton } from '@/components/point-card';
import { SubmissionCard } from '@/components/submission-card';
import { Button, Card, Chip, Empty, Field, Notice, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, markSeen, respondToPoint, voteFix } from '@/lib/api';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection, useDoc } from '@/lib/hooks';
import type { Point, PointStatus, Response, Submission } from '@/lib/types';

export default function PointScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { user, profile } = useAuth();
  const { data: point, loading } = useDoc<Point>(`points/${id}`);
  const responses = useCollection<Response>(
    query(collection(db, `points/${id}/responses`), orderBy('createdAt', 'asc')),
    `responses:${id}`,
  );
  const matched = useCollection<Submission>(
    query(
      collection(db, 'submissions'),
      where('removed', '==', false),
      where('matchedPointIds', 'array-contains', id),
      orderBy('createdAt', 'desc'),
    ),
    `matched:${id}`,
  );
  const added = useCollection<Submission>(
    query(
      collection(db, 'submissions'),
      where('removed', '==', false),
      where('addedPointIds', 'array-contains', id),
      orderBy('createdAt', 'desc'),
    ),
    `added:${id}`,
  );
  const submissions = useMemo(
    () =>
      [...added.items, ...matched.items].sort(
        (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
      ),
    [added.items, matched.items],
  );

  // Organizations this person responds for that this point is about.
  const myOrgs = useMemo(
    () => (point ? point.subjectIds.filter((s) => profile?.responderFor.includes(s)) : []),
    [point, profile],
  );
  const seenSent = useRef(false);
  useEffect(() => {
    if (!point || myOrgs.length === 0 || seenSent.current) return;
    seenSent.current = true;
    for (const subjectId of myOrgs) {
      if (!point.seenBy?.[subjectId]) markSeen({ pointId: point.id, subjectId }).catch(() => {});
    }
  }, [point, myOrgs]);

  if (!point) return <Screen><Empty loading={loading} text="This point isn't on the record." /></Screen>;

  const seenCount = Object.keys(point.seenBy ?? {}).length;
  const respondedCount = Object.keys(point.respondedBy ?? {}).length;

  return (
    <Screen>
      <Row style={{ flexWrap: 'wrap' }}>
        {point.subjectIds.map((sid, i) => (
          <Card key={sid} onPress={() => router.push(`/subject/${sid}`)} style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
            <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
              {point.subjectNames[i]}
            </T>
          </Card>
        ))}
      </Row>
      <T variant="heading" style={{ fontSize: 22, lineHeight: 29 }}>
        {point.text}
      </T>
      <Row style={{ flexWrap: 'wrap' }}>
        <SupportButton pointId={point.id} count={point.supportCount} />
        <StatusChip status={point.status} />
        {point.hot && <Chip label="Rant" color={theme.rant} bg={theme.rantSoft} />}
      </Row>
      <T variant="small">
        Wording by {point.canonical.authorName} · {point.submissionCount} complaint
        {point.submissionCount === 1 ? '' : 's'} · first raised {timeAgo(point.createdAt?.toMillis())}
      </T>
      <Notice tone="new">
        <T variant="small" color={theme.new}>
          The model added this point to the record from a complaint, and matches new complaints to it. Each
          complaint below is in its author&apos;s own words.
        </T>
      </Notice>
      <T variant="small">
        {seenCount > 0
          ? `Seen by ${seenCount === 1 ? 'the organization' : `${seenCount} organizations`}${
              respondedCount ? ', responded' : ', no response yet'
            }.`
          : point.subjectIds.length
            ? 'Not yet seen by anyone who can respond.'
            : ''}
      </T>

      <FixCheck point={point} uid={user?.uid} />

      {responses.items.length > 0 && <T variant="label">Responses</T>}
      {responses.items.map((r) => (
        <Card key={r.id} style={{ borderLeftWidth: 4, borderLeftColor: theme.primary }}>
          <Row style={{ flexWrap: 'wrap' }}>
            <T style={{ fontWeight: '700' }}>{r.subjectName}</T>
            <Chip
              label={r.official ? `Official · @${r.domain}` : `Verified @${r.domain}`}
              color={theme.primary}
              bg={theme.primarySoft}
            />
            <T variant="small">{timeAgo(r.createdAt?.toMillis())}</T>
          </Row>
          {r.status && <T variant="small">Set status: {STATUS_LABEL[r.status]}</T>}
          {r.text && <T>{r.text}</T>}
        </Card>
      ))}

      {myOrgs.map((sid) => (
        <RespondBox key={sid} point={point} subjectId={sid} subjectName={point.subjectNames[point.subjectIds.indexOf(sid)]} />
      ))}

      <T variant="label">Complaints</T>
      {submissions.length === 0 ? (
        <Empty text="" loading={matched.loading || added.loading} />
      ) : (
        submissions.map((s) => <SubmissionCard key={s.id} s={s} addedPoint={s.addedPointIds.includes(point.id)} />)
      )}
      <Button
        kind="secondary"
        label="I have more to add"
        icon="add"
        onPress={() =>
          router.push({
            pathname: '/complain',
            params: point.subjectIds[0] ? { subjectId: point.subjectIds[0], subjectName: point.subjectNames[0] } : {},
          })
        }
      />
    </Screen>
  );
}

/** Supporters, not the organization, decide whether a fix is real. */
function FixCheck({ point, uid }: { point: Point; uid?: string }) {
  const [supporter, setSupporter] = useState(false);
  const [myVote, setMyVote] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!uid) return;
    const a = onSnapshot(doc(db, `points/${point.id}/supports/${uid}`), (s) => setSupporter(s.exists()));
    const b = onSnapshot(doc(db, `points/${point.id}/fixVotes/${uid}`), (s) =>
      setMyVote(s.exists() ? (s.get('fixed') as boolean) : null),
    );
    return () => {
      a();
      b();
    };
  }, [point.id, uid]);

  if (!['fix_claimed', 'fixed', 'not_fixed'].includes(point.status)) return null;
  const vote = async (fixed: boolean) => {
    setBusy(true);
    try {
      await voteFix({ pointId: point.id, fixed });
    } catch (e) {
      showAlert("Couldn't save that", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <T variant="heading">Is it actually fixed?</T>
      <T variant="small">
        {point.fixVotes.yes} supporter{point.fixVotes.yes === 1 ? '' : 's'} say yes, {point.fixVotes.no} say no. It only
        shows as Fixed once supporters confirm.
      </T>
      {supporter ? (
        <Row>
          <Button
            label={myVote === true ? 'Yes ✓' : 'Yes, fixed'}
            kind={myVote === true ? 'primary' : 'secondary'}
            onPress={() => vote(true)}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <Button
            label={myVote === false ? 'Not fixed ✓' : 'Not fixed'}
            kind={myVote === false ? 'primary' : 'secondary'}
            onPress={() => vote(false)}
            disabled={busy}
            style={{ flex: 1 }}
          />
        </Row>
      ) : (
        <T variant="small">Support this point to have a say.</T>
      )}
    </Card>
  );
}

const RESPONSE_STATUSES: { key: PointStatus | 'none'; label: string }[] = [
  { key: 'none', label: 'Just respond' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'planned', label: 'Fix planned' },
  { key: 'fix_claimed', label: 'Fixed' },
  { key: 'wont_fix', label: "Won't fix" },
];

function RespondBox({ point, subjectId, subjectName }: { point: Point; subjectId: string; subjectName: string }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<PointStatus | 'none'>('none');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await respondToPoint({
        pointId: point.id,
        subjectId,
        text: text.trim() || undefined,
        status: status === 'none' ? null : status,
      });
      setText('');
      setStatus('none');
    } catch (e) {
      showAlert("Couldn't post the response", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ borderWidth: 1.5, borderColor: theme.primary }}>
      <T variant="label">Respond for {subjectName}</T>
      <T variant="small">
        Public, under your organization&apos;s name. Marking it fixed asks this point&apos;s supporters to confirm.
      </T>
      <Tabs options={RESPONSE_STATUSES} value={status} onChange={setStatus} />
      <Field multiline value={text} onChangeText={setText} placeholder="Your response" maxLength={4000} />
      <Button label="Post response" onPress={send} busy={busy} disabled={!text.trim() && status === 'none'} />
    </Card>
  );
}
