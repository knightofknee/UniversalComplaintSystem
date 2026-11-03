/** Supporting a point, and supporters confirming whether a fix is real. */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, ensureUser, FieldValue, notify, rateLimit, uidOf } from './common';

/** Fixed is only shown once supporters agree; the organization can't grade itself. */
export const FIX_CONFIRMATIONS = 3;

export const supportPoint = onCall({ cors: true }, async (req) => {
  const uid = uidOf(req);
  const pointId = typeof req.data?.pointId === 'string' ? req.data.pointId : '';
  const support = req.data?.support !== false;
  await rateLimit(uid, 'support');
  const { responderFor } = await ensureUser(uid);
  const ref = db.doc(`points/${pointId}`);
  await db.runTransaction(async (tx) => {
    const point = await tx.get(ref);
    if (!point.exists || point.get('removed')) throw new HttpsError('not-found', 'That point is gone.');
    if ((point.get('subjectIds') as string[]).some((s) => responderFor.includes(s))) {
      throw new HttpsError(
        'permission-denied',
        'You respond for this organization, so you can\'t support points about it.',
      );
    }
    const mine = await tx.get(ref.collection('supports').doc(uid));
    if (support === mine.exists) return;
    if (support) {
      tx.set(mine.ref, { at: FieldValue.serverTimestamp(), via: 'direct' });
      tx.update(ref, { supportCount: FieldValue.increment(1), lastActivityAt: FieldValue.serverTimestamp() });
    } else {
      tx.delete(mine.ref);
      tx.update(ref, { supportCount: FieldValue.increment(-1) });
    }
  });
  return { supported: support };
});

export const voteFix = onCall({ cors: true }, async (req) => {
  const uid = uidOf(req);
  const pointId = typeof req.data?.pointId === 'string' ? req.data.pointId : '';
  const fixed = req.data?.fixed === true;
  await rateLimit(uid, 'support');
  const ref = db.doc(`points/${pointId}`);
  const outcome = await db.runTransaction(async (tx) => {
    const point = await tx.get(ref);
    if (!point.exists) throw new HttpsError('not-found', 'That point is gone.');
    const status = point.get('status') as string;
    if (!['fix_claimed', 'fixed', 'not_fixed'].includes(status)) {
      throw new HttpsError('failed-precondition', 'Nobody has said this is fixed yet.');
    }
    const supporter = await tx.get(ref.collection('supports').doc(uid));
    if (!supporter.exists) throw new HttpsError('permission-denied', 'Only supporters of this point can confirm.');
    const voteRef = ref.collection('fixVotes').doc(uid);
    const prev = await tx.get(voteRef);
    const votes = { ...(point.get('fixVotes') as { yes: number; no: number }) };
    if (prev.exists) votes[prev.get('fixed') ? 'yes' : 'no'] -= 1;
    votes[fixed ? 'yes' : 'no'] += 1;
    // A point with few supporters needs fewer confirmations.
    const needed = Math.min(FIX_CONFIRMATIONS, point.get('supportCount') as number);
    let next = status;
    if (votes.yes >= needed && votes.yes > votes.no) next = 'fixed';
    else if (votes.no >= needed && votes.no >= votes.yes) next = 'not_fixed';
    else next = 'fix_claimed';
    tx.set(voteRef, { fixed, at: FieldValue.serverTimestamp() });
    tx.update(ref, { fixVotes: votes, status: next });
    const by = point.get('fixClaimedBy') as string | null;
    if (by && next !== status && (next === 'fixed' || status === 'fixed')) {
      tx.update(db.doc(`subjects/${by}`), { 'stats.fixed': FieldValue.increment(next === 'fixed' ? 1 : -1) });
    }
    return { status: next, changed: next !== status, text: point.get('text') as string };
  });
  if (outcome.changed && outcome.status !== 'fix_claimed') {
    const uids = (await db.collection(`points/${pointId}/supports`).select().get()).docs.map((d) => d.id);
    await notify(uids, {
      type: 'status',
      pointId,
      text:
        outcome.status === 'fixed'
          ? `Supporters confirmed it's fixed: "${outcome.text}"`
          : `Supporters say it's not fixed yet: "${outcome.text}"`,
    });
  }
  return { status: outcome.status };
});
