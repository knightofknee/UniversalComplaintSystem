import { useRouter, type Href } from 'expo-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { Platform } from 'react-native';

import { showAlert } from '@/components/point-card';
import { Button, Card, Chip, Empty, Field, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, operatorClaim, resolveDuplicate, resolveReport } from '@/lib/api';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection, useDoc } from '@/lib/hooks';
import { isOperator } from '@/lib/operator';
import type { Timestamp } from 'firebase/firestore';

type Claim = {
  id: string;
  email: string;
  domain: string;
  subjectId: string;
  subjectName: string;
  suggestedWebsite: string | null;
  status: string;
  note: string | null;
  createdAt: Timestamp | null;
};
type Report = {
  id: string;
  kind: string;
  path: string;
  text: string;
  context: string | null;
  reason: string;
  note: string | null;
  authorUid: string | null;
  createdAt: Timestamp | null;
};

const REASON: Record<string, string> = {
  abuse: 'Threats, hate or harassment',
  private_person: 'Targets a private person',
  personal_data: 'Shows personal details',
  spam: 'Spam',
  illegal: 'Illegal',
  other: 'Other',
};

/** Where a reported item can be seen in the app, if anywhere. */
function linkFor(path: string): Href | null {
  const p = path.split('/');
  if (p[0] === 'points') return `/point/${p[1]}`;
  if (p[0] === 'submissions') return `/submission/${p[1]}`;
  if (p[0] === 'subjects' && p[2] === 'inbox') return `/thread/${p[1]}/${p[3]}`;
  if (p[0] === 'subjects') return `/subject/${p[1]}`;
  return null;
}

function ask(message: string): string | null {
  if (Platform.OS === 'web') return window.prompt(message) ?? null;
  return '';
}

/**
 * The operator queue (the account with OPERATOR_EMAIL only): organization
 * access requests the daily check couldn't confirm, reports, and AI spend.
 * The daily 6:00 check notifies the operator when anything here waits.
 */
export default function OperatorScreen() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'claims' | 'reports' | 'duplicates' | 'spend'>('claims');
  const op = isOperator(user);
  const claims = useCollection<Claim>(
    op ? query(collection(db, 'claims'), where('status', 'in', ['held', 'pending']), orderBy('createdAt', 'desc'), limit(100)) : null,
    'op:claims',
  );
  const reports = useCollection<Report>(
    op ? query(collection(db, 'reports'), where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(100)) : null,
    'op:reports',
  );
  // Pairs of points that may say the same thing (functions/src/duplicates.ts).
  const duplicates = useCollection<Duplicate>(
    op ? query(collection(db, 'duplicates'), where('status', '==', 'open'), limit(50)) : null,
    'op:duplicates',
  );
  if (!op) {
    return (
      <Screen>
        <Empty text="Only the operator can see this." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Tabs
        options={[
          { key: 'claims', label: `Organizations · ${claims.items.length}` },
          { key: 'reports', label: `Reports · ${reports.items.length}` },
          { key: 'duplicates', label: `Duplicates · ${duplicates.items.length}` },
          { key: 'spend', label: 'AI spend' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'claims' &&
        (claims.items.length === 0 ? (
          <Empty loading={claims.loading} text="No organization requests waiting." />
        ) : (
          claims.items.map((c) => <ClaimCard key={c.id} c={c} />)
        ))}
      {tab === 'reports' &&
        (reports.items.length === 0 ? (
          <Empty loading={reports.loading} text="No open reports. Quiet day." />
        ) : (
          reports.items.map((r) => <ReportCard key={r.id} r={r} />)
        ))}
      {tab === 'duplicates' &&
        (duplicates.items.length === 0 ? (
          <Empty loading={duplicates.loading} text="No likely duplicates." />
        ) : (
          duplicates.items.map((d) => <DuplicateCard key={d.id} d={d} />)
        ))}
      {tab === 'spend' && <Spend />}
    </Screen>
  );
}

type Duplicate = {
  id: string;
  a: string;
  b: string;
  texts: Record<string, string>;
  people: Record<string, number>;
  distance: number;
};

/** Two points that read alike. Merging folds the smaller into the larger; it can't be undone. */
function DuplicateCard({ d }: { d: Duplicate }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'merge' | 'dismiss' | null>(null);
  const act = async (action: 'merge' | 'dismiss') => {
    setBusy(action);
    try {
      await resolveDuplicate({ id: d.id, action });
    } catch (e) {
      showAlert("Couldn't do that", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      {[d.a, d.b].map((id) => (
        <Card key={id} onPress={() => router.push(`/point/${id}`)}>
          <T>{d.texts[id]}</T>
          <T variant="small">{(d.people[id] ?? 0).toLocaleString()} people</T>
        </Card>
      ))}
      <T variant="small">
        Closeness {d.distance} (under 0.12 is usually the same complaint). Merging keeps the one with more people and
        moves the other's supporters, complaints, responses and fixes into it.
      </T>
      <Row>
        <Button label="Not the same" kind="secondary" onPress={() => act('dismiss')} busy={busy === 'dismiss'} style={{ flex: 1 }} />
        <Button label="Merge" onPress={() => act('merge')} busy={busy === 'merge'} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}

function ClaimCard({ c }: { c: Claim }) {
  const theme = useTheme();
  const [website, setWebsite] = useState(c.suggestedWebsite ?? '');
  const [busy, setBusy] = useState(false);
  const act = async (action: 'approve' | 'deny' | 'website') => {
    let reason: string | undefined;
    if (action === 'deny') {
      const r = ask('Why? (they see this)');
      if (r === null) return;
      reason = r || undefined;
    }
    setBusy(true);
    try {
      const res = await operatorClaim({ claimId: c.id, action, reason, ...(action === 'website' ? { website } : {}) });
      if (action === 'website' && res.status === 'held') showAlert('Saved the website', `${c.domain} still doesn't match it, so it's held.`);
    } catch (e) {
      showAlert("Couldn't do that", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Row style={{ flexWrap: 'wrap' }}>
        <T style={{ fontWeight: '700', flex: 1 }}>{c.subjectName}</T>
        <Chip label={c.status} color={theme.warning} bg={theme.warningSoft} />
      </Row>
      <T>{c.email}</T>
      <T variant="small">
        Asked {timeAgo(c.createdAt?.toMillis())}
        {c.note ? ` · ${c.note}` : ''}
      </T>
      <Field
        label="Their real website (check it yourself)"
        value={website}
        onChangeText={setWebsite}
        autoCapitalize="none"
        keyboardType="url"
        placeholder="https://"
      />
      <T variant="small">
        Saving a verified website approves this request if @{c.domain} matches it, and every future request from that
        domain.
      </T>
      <Row style={{ flexWrap: 'wrap' }}>
        <Button label="Verify website" kind="secondary" onPress={() => act('website')} disabled={busy || !website.trim()} />
        <Button label="Approve" onPress={() => act('approve')} disabled={busy} />
        <Button label="Deny" kind="quiet" onPress={() => act('deny')} disabled={busy} />
      </Row>
    </Card>
  );
}

function ReportCard({ r }: { r: Report }) {
  const router = useRouter();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const link = linkFor(r.path);
  const act = async (action: 'remove' | 'dismiss' | 'suspend') => {
    let reason: string | undefined;
    if (action !== 'dismiss') {
      const x = ask('Reason for the public removal log?');
      if (x === null) return;
      reason = x || undefined;
    }
    setBusy(true);
    try {
      await resolveReport({ reportId: r.id, action, reason });
    } catch (e) {
      showAlert("Couldn't do that", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={REASON[r.reason] ?? r.reason} color={theme.danger} bg={theme.dangerSoft} />
        <T variant="small">
          {r.kind} · {timeAgo(r.createdAt?.toMillis())}
        </T>
      </Row>
      {r.context && <T variant="small">{r.context}</T>}
      <T>{r.text || '(no text)'}</T>
      {r.note && <T variant="small">Reporter: “{r.note}”</T>}
      {link && <Button kind="quiet" label="Open it" onPress={() => router.push(link)} />}
      <Row style={{ flexWrap: 'wrap' }}>
        <Button label="Remove" onPress={() => act('remove')} disabled={busy} />
        {r.authorUid && <Button label="Remove + suspend" kind="secondary" onPress={() => act('suspend')} disabled={busy} />}
        <Button label="Keep it" kind="quiet" onPress={() => act('dismiss')} disabled={busy} />
      </Row>
    </Card>
  );
}

function Spend() {
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = useDoc<{ costUsd?: number; claudeCalls?: number; calls?: Record<string, number>; pausedAt?: unknown }>(
    `usage/${day}`,
  );
  const { data: config } = useDoc<{ dailyBudgetUsd?: number }>('config/ai');
  const budget = config?.dailyBudgetUsd ?? 25;
  return (
    <Card>
      <T variant="label">Today (UTC)</T>
      <T variant="title">
        ${(usage?.costUsd ?? 0).toFixed(2)} <T variant="small">of ${budget}</T>
      </T>
      <T variant="small">
        {usage?.claudeCalls ?? 0} complaints checked · {usage?.calls?.search ?? 0} searches · {usage?.calls?.vision ?? 0}{' '}
        photos screened
      </T>
      {!!usage?.pausedAt && <T variant="small">Hit the ceiling today: new complaints are queued until midnight UTC.</T>}
      <T variant="small">Change the ceiling with npm run usage -- budget 40.</T>
    </Card>
  );
}
