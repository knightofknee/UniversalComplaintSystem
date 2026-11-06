import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { showAlert } from '@/components/point-card';
import { TermsCheck, useTermsAccepted } from '@/components/terms-check';
import { Button, Card, Field, Notice, Screen, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { errorText, requestAccess } from '@/lib/api';
import { db } from '@/lib/firebase';
import { useCollection, useDoc } from '@/lib/hooks';
import type { Subject } from '@/lib/types';

type Claim = { id: string; subjectName: string; status: 'pending' | 'held' | 'approved' | 'denied'; note: string | null };

const CLAIM_STATUS: Record<Claim['status'], string> = {
  pending: 'Waiting for the daily check',
  held: 'Being reviewed by hand',
  approved: 'Approved',
  denied: 'Not approved',
};

/**
 * Anyone with a verified email at an organization's domain can respond for
 * it. Known domains are approved at once; new ones are checked against the
 * organization's verified website once a day; anything that doesn't match is
 * reviewed by a person.
 */
export default function ClaimScreen() {
  const params = useLocalSearchParams<{ subjectId?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [results, setResults] = useState<Subject[]>([]);
  const [picked, setPicked] = useState<string | null>(params.subjectId ?? null);
  const [typedWebsite, setWebsite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const termsAccepted = useTermsAccepted();
  const [agreed, setAgreed] = useState(false);
  const { data: subject } = useDoc<Subject>(picked ? `subjects/${picked}` : null);
  const claims = useCollection<Claim>(
    user ? query(collection(db, 'claims'), where('uid', '==', user.uid), limit(20)) : null,
    `claims:${user?.uid}`,
  );

  const website = typedWebsite ?? subject?.website ?? '';
  useEffect(() => {
    const lower = name.trim().toLowerCase();
    if (lower.length < 2) return;
    const t = setTimeout(() => {
      getDocs(
        query(
          collection(db, 'subjects'),
          where('removed', '==', false),
          orderBy('nameLower'),
          where('nameLower', '>=', lower),
          where('nameLower', '<', `${lower}`),
          limit(8),
        ),
      )
        .then((s) =>
          setResults(
            s.docs.map((d) => ({ id: d.id, ...d.data() }) as Subject).filter((x) => x.kind === 'organization'),
          ),
        )
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [name]);

  const verified = !!user && !user.isAnonymous && user.emailVerified;
  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await requestAccess({ subjectId: picked, website: website.trim() || undefined, ...(agreed ? { acceptTerms: true } : {}) });
      showAlert(
        res.status === 'approved' ? 'You can respond now' : 'Request received',
        res.status === 'approved'
          ? `Open any point about ${subject?.name} to respond.`
          : `We check ${user?.email?.split('@')[1]} against ${subject?.name}'s website, and a person reviews anything that doesn't match. We'll notify you.`,
      );
      if (res.status === 'approved') router.replace('/company');
    } catch (e) {
      showAlert('Not yet', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <T>
        Respond publicly for your organization: acknowledge points, say what&apos;s planned, mark fixes. You can&apos;t
        remove or edit anything people wrote.
      </T>
      {!verified && (
        <Notice tone="warn">
          <T>First, add and verify your work email.</T>
          <Button label="Add work email" kind="secondary" onPress={() => router.push('/account')} />
        </Notice>
      )}
      {verified && <T variant="small">Applying as {user!.email}</T>}

      {subject ? (
        <Card>
          <T variant="heading">{subject.name}</T>
          <T variant="small">{subject.description}</T>
          <Button label="Change" kind="quiet" onPress={() => setPicked(null)} />
        </Card>
      ) : (
        <>
          <Field label="Organization" value={name} onChangeText={setName} placeholder="Start typing its name" />
          {(name.trim().length >= 2 ? results : []).map((r) => (
            <Card key={r.id} onPress={() => setPicked(r.id)}>
              <T style={{ fontWeight: '700' }}>{r.name}</T>
              <T variant="small">{r.description}</T>
            </Card>
          ))}
          {name.trim().length >= 2 && results.length === 0 && (
            <T variant="small">
              Not here? Organizations appear once someone complains about them. Post a complaint first, or ask us to
              add it.
            </T>
          )}
        </>
      )}
      {subject && (
        <>
          <Field
            label="Organization's website (helps us check)"
            value={website}
            onChangeText={setWebsite}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://"
          />
          <TermsCheck checked={agreed} onChange={setAgreed} />
          <Button label="Request access" onPress={submit} busy={busy} disabled={!verified || (!termsAccepted && !agreed)} />
        </>
      )}

      {claims.items.length > 0 && <T variant="label">Your requests</T>}
      {claims.items.map((c) => (
        <Card key={c.id}>
          <T style={{ fontWeight: '700' }}>{c.subjectName}</T>
          <T variant="small">
            {CLAIM_STATUS[c.status]}
            {c.note ? ` · ${c.note}` : ''}
          </T>
        </Card>
      ))}
    </Screen>
  );
}
