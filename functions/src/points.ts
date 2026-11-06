/**
 * Supporting a point ("Same here"), and supporters confirming whether a fix
 * is real.
 *
 * Status is per organization (`orgStatus.{orgId}`): on a point filed under
 * two airlines, one saying it fixed it says nothing about the other. The
 * point's own `status` shows the latest change, for lists. Fixed is never
 * self-declared: an organization's "Fixed" is a claim that only people who
 * supported the point BEFORE the claim can confirm, so an organization
 * can't grade itself with a few fresh accounts.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { CALLABLE, db, ensureUser, FieldValue, notify, rateLimit, supporterUids, Timestamp, uidOf } from './common';
import { privateFollowerUids } from './private';

/** "Rising this week" counts support gained in this window. */
const RISING_WINDOW_MS = 7 * 24 * 3600_000;
/** Fixed is only shown once supporters agree; the organization can't grade itself. */
export const FIX_CONFIRMATIONS = 3;
const FIX_STATES = ['fix_claimed', 'fixed', 'not_fixed'];
/** A busy point notifies its followers at most this often; later news waits and goes out together. */
const FANOUT_EVERY_MS = 6 * 3600_000;

export type OrgStatus = {
  status: string;
  at: Timestamp;
  fixClaimedAt?: Timestamp;
  yes: number;
  no: number;
};

export const supportPoint = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const pointId = typeof req.data?.pointId === 'string' ? req.data.pointId : '';
  const support = req.data?.support !== false;
  await rateLimit(req, 'support');
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
    const delta = support ? 1 : -1;
    // Withdrawing only takes back this week's count if it was given this week.
    const recent = !support && Date.now() - (mine.get('at') as Timestamp).toMillis() < RISING_WINDOW_MS;
    if (support) {
      tx.set(mine.ref, { uid, at: FieldValue.serverTimestamp(), via: 'direct' });
      tx.update(ref, {
        supportCount: FieldValue.increment(1),
        weekSupport: FieldValue.increment(1),
        lastActivityAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.delete(mine.ref);
      tx.update(ref, {
        supportCount: FieldValue.increment(-1),
        ...(recent ? { weekSupport: FieldValue.increment(-1) } : {}),
      });
    }
    for (const sid of point.get('subjectIds') as string[]) {
      tx.update(db.doc(`subjects/${sid}`), { 'stats.supporters': FieldValue.increment(delta) });
    }
  });
  return { supported: support };
});

/**
 * People who raised a point privately can confirm an organization's fix
 * only where that organization publishes its private counts (otherwise a
 * vote would reveal private complaints exist), and only if they raised it
 * before the fix was claimed.
 */
async function raisedPrivatelyBefore(uid: string, pointId: string, orgId: string, claimedAt: Timestamp) {
  const org = await db.doc(`subjects/${orgId}`).get();
  if (org.get('publishPrivate') !== true) return false;
  const holders = await db
    .collection(`subjects/${orgId}/privatePoints`)
    .where('pointId', '==', pointId)
    .limit(1)
    .get();
  if (holders.empty) return false;
  const follower = await holders.docs[0].ref.collection('followers').doc(uid).get();
  return follower.exists && (follower.get('at') as Timestamp).toMillis() < claimedAt.toMillis();
}

export const voteFix = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const pointId = typeof req.data?.pointId === 'string' ? req.data.pointId : '';
  const orgId = typeof req.data?.orgId === 'string' ? req.data.orgId : '';
  const fixed = req.data?.fixed === true;
  await rateLimit(req, 'support');
  const { responderFor } = await ensureUser(uid);
  if (responderFor.includes(orgId)) throw new HttpsError('permission-denied', "You can't confirm your own organization's fix.");
  const ref = db.doc(`points/${pointId}`);
  const before = await ref.get();
  const claimedAt = (before.get(`orgStatus.${orgId}`) as OrgStatus | undefined)?.fixClaimedAt;
  const privateVoter = claimedAt ? await raisedPrivatelyBefore(uid, pointId, orgId, claimedAt) : false;
  // Only people who supported it before the claim can vote, so they set how many confirmations it takes.
  const eligible = claimedAt
    ? (await ref.collection('supports').where('at', '<', claimedAt).count().get()).data().count
    : 0;
  const outcome = await db.runTransaction(async (tx) => {
    const point = await tx.get(ref);
    if (!point.exists) throw new HttpsError('not-found', 'That point is gone.');
    const entry = point.get(`orgStatus.${orgId}`) as OrgStatus | undefined;
    if (!entry || !FIX_STATES.includes(entry.status) || !entry.fixClaimedAt) {
      throw new HttpsError('failed-precondition', 'Nobody has said this is fixed yet.');
    }
    const supporter = await tx.get(ref.collection('supports').doc(uid));
    const supportedBefore =
      supporter.exists && ((supporter.get('at') as Timestamp | undefined)?.toMillis() ?? Infinity) < entry.fixClaimedAt.toMillis();
    if (!supportedBefore && !privateVoter) {
      throw new HttpsError(
        'permission-denied',
        supporter.exists
          ? 'Only people who supported this before the fix was claimed can confirm it.'
          : 'Only supporters of this point can confirm.',
      );
    }
    const voteRef = ref.collection('fixVotes').doc(`${orgId}_${uid}`);
    const prev = await tx.get(voteRef);
    const votes = { yes: entry.yes ?? 0, no: entry.no ?? 0 };
    if (prev.exists) votes[prev.get('fixed') ? 'yes' : 'no'] -= 1;
    votes[fixed ? 'yes' : 'no'] += 1;
    // A point with few earlier supporters needs fewer confirmations.
    const needed = Math.max(1, Math.min(FIX_CONFIRMATIONS, eligible));
    let next: string;
    if (votes.yes >= needed && votes.yes > votes.no) next = 'fixed';
    else if (votes.no >= needed && votes.no >= votes.yes) next = 'not_fixed';
    else next = 'fix_claimed';
    tx.set(voteRef, { uid, orgId, fixed, at: FieldValue.serverTimestamp() });
    const update: Record<string, unknown> = {
      [`orgStatus.${orgId}.yes`]: votes.yes,
      [`orgStatus.${orgId}.no`]: votes.no,
      [`orgStatus.${orgId}.status`]: next,
    };
    if (next !== entry.status) {
      update.status = next;
      update.statusBy = orgId;
      update.lastActivityAt = FieldValue.serverTimestamp();
    }
    tx.update(ref, update);
    if (next !== entry.status && (next === 'fixed' || entry.status === 'fixed')) {
      tx.update(db.doc(`subjects/${orgId}`), { 'stats.fixed': FieldValue.increment(next === 'fixed' ? 1 : -1) });
    }
    const names = point.get('subjectNames') as string[];
    const orgName = names[(point.get('subjectIds') as string[]).indexOf(orgId)] ?? 'The organization';
    return { status: next, changed: next !== entry.status, text: point.get('text') as string, orgName };
  });
  if (outcome.changed && outcome.status !== 'fix_claimed') {
    await notifyPointFollowers(pointId, {
      type: 'status',
      text:
        outcome.status === 'fixed'
          ? `Supporters confirmed ${outcome.orgName} fixed it: "${outcome.text}"`
          : `Supporters say ${outcome.orgName} hasn't fixed it yet: "${outcome.text}"`,
    });
  }
  return { status: outcome.status };
});

/**
 * Tells everyone following a point (supporters, and people who raised it
 * privately) what changed. At most once per FANOUT_EVERY_MS per point:
 * later news is held as `pendingNotice` and sent by `flushNotices`, so a
 * busy point can't flood phones or run up writes.
 */
export async function notifyPointFollowers(pointId: string, n: { type: string; text: string }) {
  const ref = db.doc(`points/${pointId}`);
  const due = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const last = (s.get('lastFanoutAt') as Timestamp | undefined)?.toMillis() ?? 0;
    if (Date.now() - last < FANOUT_EVERY_MS) {
      tx.update(ref, { pendingNotice: n });
      return false;
    }
    tx.update(ref, { lastFanoutAt: Timestamp.now(), pendingNotice: null });
    return true;
  });
  if (due) await fanout(pointId, n);
}

async function fanout(pointId: string, n: { type: string; text: string }) {
  const uids = [...new Set([...(await supporterUids(pointId)), ...(await privateFollowerUids(pointId))])];
  await notify(uids, { ...n, pointId });
}

/** Hourly: held point news goes out once its point's quiet period is over. */
export const flushNotices = onSchedule('every 60 minutes', async () => {
  const pending = await db.collection('points').where('pendingNotice', '!=', null).limit(200).get();
  for (const d of pending.docs) {
    const last = (d.get('lastFanoutAt') as Timestamp | undefined)?.toMillis() ?? 0;
    if (Date.now() - last < FANOUT_EVERY_MS) continue;
    const n = d.get('pendingNotice') as { type: string; text: string };
    await d.ref.update({ lastFanoutAt: Timestamp.now(), pendingNotice: null });
    await fanout(d.id, n);
  }
});

/**
 * Support is counted into weekSupport the moment it is given; this ages it
 * out. Every 6 hours each point's weekSupport is recounted from the support
 * timestamps of the last 7 days.
 */
export const recountRising = onSchedule('every 6 hours', async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - RISING_WINDOW_MS);
  const recent = await db.collectionGroup('supports').where('at', '>=', cutoff).select().get();
  const counts = new Map<string, number>();
  for (const d of recent.docs) {
    const pointId = d.ref.parent.parent!.id;
    counts.set(pointId, (counts.get(pointId) ?? 0) + 1);
  }
  const current = await db.collection('points').where('weekSupport', '>', 0).select('weekSupport').get();
  const writes = new Map<string, number>();
  for (const d of current.docs) {
    const n = counts.get(d.id) ?? 0;
    if (n !== d.get('weekSupport')) writes.set(d.id, n);
    counts.delete(d.id);
  }
  for (const [id, n] of counts) writes.set(id, n);
  const entries = [...writes];
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    for (const [id, n] of entries.slice(i, i + 400)) batch.update(db.doc(`points/${id}`), { weekSupport: n });
    await batch.commit();
  }
});
