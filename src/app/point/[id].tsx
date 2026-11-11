import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { showAlert, StatusChip, STATUS_LABEL, SupportButton } from '@/components/point-card';
import { ReportButton } from '@/components/report';
import { Solutions } from '@/components/solutions';
import { Statements } from '@/components/statements';
import { TermsCheck, useTermsAccepted } from '@/components/terms-check';
import { Button, Card, Chip, Empty, Field, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, markSeen, respondToPoint, voteFix } from '@/lib/api';
import { useBlockedAuthors } from '@/lib/blocks';
import { db } from '@/lib/firebase';
import { successHaptic } from '@/lib/haptics';
import { timeAgo, useCollection, useDoc } from '@/lib/hooks';
import { shareLink } from '@/lib/share';
import type { OrgStatus, Point, PointStatus, Response, Submission } from '@/lib/types';

const FIX_STATES: PointStatus[] = ['fix_claimed', 'fixed', 'not_fixed'];

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
  const blocked = useBlockedAuthors();
  const { data: headlineFrom } = useDoc<Submission>(point ? `submissions/${point.canonical.submissionId}` : null);
  // A hidden author's name shows nowhere until their complaint is opened, the headline's credit included.
  const headlineBy = headlineFrom?.authorId;
  const headlineHidden = !!headlineBy && blocked.ids.has(headlineBy);

  // Organizations this person responds for that this point is about.
  const myOrgs = useMemo(
    () => (point ? point.subjectIds.filter((s) => profile?.responderFor.includes(s)) : []),
    [point, profile],
  );
  // Whether the reader has this problem (supports the point): they are who says if a proposed fix worked.
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, `points/${id}/supports/${user.uid}`),
      (s) => setSupported(s.exists()),
      () => setSupported(false),
    );
  }, [id, user]);
  const seenSent = useRef(false);
  useEffect(() => {
    if (!point || myOrgs.length === 0 || seenSent.current) return;
    seenSent.current = true;
    for (const subjectId of myOrgs) {
      if (!point.seenBy?.[subjectId]) markSeen({ pointId: point.id, subjectId }).catch(() => {});
    }
  }, [point, myOrgs]);

  if (!point) return <Screen><Empty loading={loading} text="This issue isn't on the record (or it was removed)." /></Screen>;

  const seenCount = Object.keys(point.seenBy ?? {}).length;
  // Only present for organizations that chose to publish their private counts.
  const publishedPrivate = Object.values(point.privateCounts ?? {}).reduce((n, c) => n + c, 0);
  const respondedCount = Object.keys(point.respondedBy ?? {}).length;
  const nameOf = (sid: string) => point.subjectNames[point.subjectIds.indexOf(sid)] ?? 'An organization';
  const fixClaims = Object.entries(point.orgStatus ?? {}).filter(([, s]) => FIX_STATES.includes(s.status));

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => shareLink(`/point/${point.id}`)}
              accessibilityLabel="Share this issue"
              hitSlop={10}>
              <Ionicons name="share-outline" size={22} color={theme.primary} />
            </Pressable>
          ),
        }}
      />
      <T variant="title" style={{ fontSize: 28, lineHeight: 33 }}>
        {point.text}
      </T>
      <Row style={{ flexWrap: 'wrap' }}>
        <SupportButton pointId={point.id} count={point.supportCount} />
        <StatusChip status={point.status} />
        {point.hot && <Chip label="🔥 rant" color={theme.rant} bg={theme.rantSoft} />}
      </Row>
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {point.subjectIds.map((sid, i) => (
          <Pressable
            key={sid}
            onPress={() => router.push(`/subject/${sid}`)}
            accessibilityRole="link"
            style={({ pressed }) => [styles.tag, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
            <T variant="small" color={theme.text} style={{ fontWeight: '600' }}>
              {point.subjectNames[i]}
            </T>
          </Pressable>
        ))}
      </Row>
      {Object.entries(point.orgStatus ?? {}).length > 1 && (
        <Row style={{ flexWrap: 'wrap' }}>
          {Object.entries(point.orgStatus ?? {}).map(([sid, s]) => (
            <T key={sid} variant="small">
              {nameOf(sid)}: {STATUS_LABEL[s.status]}
            </T>
          ))}
        </Row>
      )}
      {publishedPrivate > 0 && (
        <T variant="small">
          +{publishedPrivate} raised privately (the organization publishes its private counts; what they wrote stays
          private)
        </T>
      )}
      <Pressable onPress={() => router.push(`/submission/${point.canonical.submissionId}`)} accessibilityRole="link" hitSlop={6}>
        <T variant="small">
          {point.canonical.authorName.endsWith('public record') ? 'From the ' : 'Summarized from '}
          <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
            {point.canonical.authorName.endsWith('public record')
              ? point.canonical.authorName
              : headlineHidden
                ? 'a complaint you hid'
                : `${point.canonical.authorName}'s complaint`}
          </T>{' '}
          · {point.submissionCount} complaint{point.submissionCount === 1 ? '' : 's'} · first raised{' '}
          {timeAgo(point.createdAt?.toMillis())}
        </T>
      </Pressable>
      <T variant="small">
        <T variant="small" color={theme.new} style={{ fontWeight: '700' }}>
          ✨ Worded by the model
        </T>{' '}
        from the complaints that raise it. Below, what each one says about it, also pulled out by the model; tap one to
        read that complaint as its author wrote it.
      </T>
      <T variant="small">
        {seenCount > 0
          ? `Seen by ${seenCount === 1 ? 'the organization' : `${seenCount} organizations`}${
              respondedCount ? ', responded' : ', no response yet'
            }.`
          : point.subjectIds.length
            ? 'Not yet seen by anyone who can respond.'
            : ''}
      </T>

      {fixClaims.map(([sid, s]) => (
        <FixCheck key={sid} point={point} orgId={sid} orgName={nameOf(sid)} entry={s} uid={user?.uid} />
      ))}

      {responses.items.length > 0 && <T variant="label">Responses</T>}
      {responses.items
        .filter((r) => !r.removed)
        .map((r) => (
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
            <ReportButton target={{ kind: 'response', id: r.id, pointId: point.id }} />
          </Card>
        ))}

      {myOrgs.map((sid) => (
        <RespondBox key={sid} point={point} subjectId={sid} subjectName={nameOf(sid)} />
      ))}

      <Solutions pointId={point.id} supported={supported} />

      <Statements
        pointId={point.id}
        onAdd={() =>
          router.push({
            pathname: '/complain',
            params: point.subjectIds[0] ? { subjectId: point.subjectIds[0], subjectName: point.subjectNames[0] } : {},
          })
        }
      />
      <ReportButton target={{ kind: 'point', id: point.id }} label="Report this issue" />
    </Screen>
  );
}

/**
 * Supporters, not the organization, decide whether a fix is real: only
 * people who supported the point before the fix was claimed can confirm.
 */
function FixCheck({
  point,
  orgId,
  orgName,
  entry,
  uid,
}: {
  point: Point;
  orgId: string;
  orgName: string;
  entry: OrgStatus;
  uid?: string;
}) {
  const theme = useTheme();
  const [supportedAt, setSupportedAt] = useState<number | null | undefined>(undefined);
  const [myVote, setMyVote] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!uid) return;
    const a = onSnapshot(doc(db, `points/${point.id}/supports/${uid}`), (s) =>
      setSupportedAt(s.exists() ? (s.get('at')?.toMillis?.() ?? Date.now()) : null),
    );
    const b = onSnapshot(doc(db, `points/${point.id}/fixVotes/${orgId}_${uid}`), (s) =>
      setMyVote(s.exists() ? (s.get('fixed') as boolean) : null),
    );
    return () => {
      a();
      b();
    };
  }, [point.id, orgId, uid]);

  const claimedAt = entry.fixClaimedAt?.toMillis() ?? 0;
  const canVote = (supportedAt != null && supportedAt < claimedAt) || Object.keys(point.privateCounts ?? {}).includes(orgId);
  const vote = async (fixed: boolean) => {
    setBusy(true);
    try {
      const res = await voteFix({ pointId: point.id, orgId, fixed });
      if (res.status === 'fixed') successHaptic();
    } catch (e) {
      showAlert("Couldn't save that", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={entry.status === 'fixed' ? { borderWidth: 1.5, borderColor: theme.good } : undefined}>
      {entry.status === 'fixed' ? (
        <Row>
          <Ionicons name="checkmark-circle" size={26} color={theme.good} />
          <T variant="heading" color={theme.good} style={{ flex: 1 }}>
            Fixed, say the people who raised it
          </T>
        </Row>
      ) : (
        <T variant="heading">{orgName} says it fixed this. Did it?</T>
      )}
      <T variant="small">
        {entry.yes} supporter{entry.yes === 1 ? '' : 's'} say yes, {entry.no} say no. It only shows as Fixed once people
        who raised it before the claim confirm.
      </T>
      {canVote ? (
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
        <T variant="small">
          {supportedAt
            ? 'You supported this after the fix was claimed, so the call is up to people who had the issue before.'
            : 'People who supported this before the fix was claimed decide.'}
        </T>
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
  const termsAccepted = useTermsAccepted();
  const [agreed, setAgreed] = useState(false);
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
        ...(agreed ? { acceptTerms: true } : {}),
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
        Public, under your organization&apos;s name. Marking it fixed asks the people who raised it to confirm; it only
        counts once they do.
      </T>
      <Tabs options={RESPONSE_STATUSES} value={status} onChange={setStatus} />
      <Field multiline value={text} onChangeText={setText} placeholder="Your response" maxLength={4000} />
      <TermsCheck checked={agreed} onChange={setAgreed} />
      <Button
        label="Post response"
        onPress={send}
        busy={busy}
        disabled={(!text.trim() && status === 'none') || (!termsAccepted && !agreed)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
});
