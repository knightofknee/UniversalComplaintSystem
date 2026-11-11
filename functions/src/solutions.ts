/**
 * Proposed fixes. Anyone can propose a fix for a point: an organization, or
 * someone who found a way around the problem. The people who have the
 * problem (the point's supporters) are told, and each says whether it fixed
 * it for them: fully, partly, or not at all.
 *
 * Fixed is still never self-declared. A point shows Fixed from a proposed
 * fix only when enough people who supported it BEFORE the fix was proposed
 * say "fully", and they outnumber the rest: the same rule as an
 * organization's own claim (points.ts), so a proposer can't confirm their
 * own fix with a few fresh accounts. Later supporters' ratings are shown in
 * the tally but don't decide it.
 *
 * points/{id}/solutions/{authorId}: one per person per point (the id is the
 * proposer's opaque author id). Who rated what is private (`ratings/{uid}`).
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { authorIdOf, CALLABLE, cleanText, db, ensureUser, FieldValue, rateLimit, requireTerms, Timestamp, uidOf } from './common';
import { nameCalling } from './moderation';
import { FIX_CONFIRMATIONS, notifyPointFollowers } from './points';
import { stripSensitive } from './private';

const RATINGS = ['full', 'partial', 'none'] as const;
type Rating = (typeof RATINGS)[number];
const id = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,128}$/.test(v) ? v : '');

export const proposeFix = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const pointId = id(req.data?.pointId);
  const text = stripSensitive(cleanText(req.data?.text, 1000, 'The fix'));
  if (text.length < 10) throw new HttpsError('invalid-argument', 'Say a little more about the fix.');
  if (nameCalling(text)) throw new HttpsError('failed-precondition', 'Leave the name-calling out and post it again.');
  const user = await ensureUser(uid);
  await requireTerms(req, user);
  await rateLimit(req, 'solution');
  const pointRef = db.doc(`points/${pointId}`);
  const point = await pointRef.get();
  if (!point.exists || point.get('removed')) throw new HttpsError('not-found', 'That issue is gone.');
  const authorId = authorIdOf(uid);
  const ref = pointRef.collection('solutions').doc(authorId);
  const existing = await ref.get();
  if (existing.exists) {
    throw new HttpsError(
      'already-exists',
      existing.get('removed') ? 'Your fix here was removed.' : 'You already proposed a fix here.',
    );
  }
  await ref.set({
    text,
    authorName: user.displayName,
    authorId,
    full: 0,
    partial: 0,
    none: 0,
    earlyFull: 0,
    earlyOther: 0,
    removed: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  // Server-only, for suspending an abusive account.
  await db.doc(`authors/s_${pointId}_${authorId}`).set({ uid });
  await pointRef.update({ solutionCount: FieldValue.increment(1), lastActivityAt: FieldValue.serverTimestamp() });
  await notifyPointFollowers(pointId, {
    type: 'fix',
    text: `Someone proposed a fix for "${point.get('text') as string}". Did it work for you?`,
  });
  return { id: authorId };
});

/** `rating: null` takes a rating back. */
export const rateFix = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const pointId = id(req.data?.pointId);
  const fixId = id(req.data?.fixId);
  const rating = (RATINGS as readonly string[]).includes(req.data?.rating) ? (req.data.rating as Rating) : null;
  await rateLimit(req, 'support');
  await ensureUser(uid);
  if (authorIdOf(uid) === fixId) throw new HttpsError('permission-denied', 'The people who have the issue say if your fix worked.');
  const pointRef = db.doc(`points/${pointId}`);
  const ref = pointRef.collection('solutions').doc(fixId);
  await db.runTransaction(async (tx) => {
    const [fix, support, mine] = await Promise.all([
      tx.get(ref),
      tx.get(pointRef.collection('supports').doc(uid)),
      tx.get(ref.collection('ratings').doc(uid)),
    ]);
    if (!fix.exists || fix.get('removed')) throw new HttpsError('not-found', 'That fix is gone.');
    if (!support.exists) {
      throw new HttpsError('permission-denied', 'Tap the arrow on the issue first: the people who have it say if a fix worked.');
    }
    const before = mine.exists ? (mine.get('rating') as Rating) : null;
    if (before === rating) return;
    const proposedAt = (fix.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0;
    const early = ((support.get('at') as Timestamp | undefined)?.toMillis() ?? Infinity) < proposedAt;
    const delta: Record<string, number> = {};
    const bump = (field: string, n: number) => {
      delta[field] = (delta[field] ?? 0) + n;
    };
    const earlyField = (r: Rating) => (r === 'full' ? 'earlyFull' : 'earlyOther');
    if (before) {
      bump(before, -1);
      if (mine.get('early')) bump(earlyField(before), -1);
    }
    if (rating) {
      bump(rating, 1);
      if (early) bump(earlyField(rating), 1);
      tx.set(mine.ref, { uid, rating, early, at: FieldValue.serverTimestamp() });
    } else {
      tx.delete(mine.ref);
    }
    const update = Object.fromEntries(
      Object.entries(delta)
        .filter(([, n]) => n !== 0)
        .map(([field, n]) => [field, FieldValue.increment(n)]),
    );
    if (Object.keys(update).length) tx.update(ref, update);
  });
  const status = await settleFix(pointId, fixId);
  return { rating, status };
});

/**
 * Whether a proposed fix now makes its point Fixed, or stops doing so.
 * Run after anything that changes a fix's ratings or removes it.
 */
export async function settleFix(pointId: string, fixId: string): Promise<string> {
  const pointRef = db.doc(`points/${pointId}`);
  const [point, fix] = await Promise.all([pointRef.get(), pointRef.collection('solutions').doc(fixId).get()]);
  if (!point.exists) return 'open';
  const current = point.get('status') as string;
  const byThis = point.get('fixedBy') === fixId;
  let confirmed = false;
  if (fix.exists && !fix.get('removed') && fix.get('createdAt')) {
    // Only people who supported it before the fix was proposed decide, so they set how many it takes.
    const eligible = (await pointRef.collection('supports').where('at', '<', fix.get('createdAt')).count().get()).data().count;
    const needed = Math.max(1, Math.min(FIX_CONFIRMATIONS, eligible));
    const yes = (fix.get('earlyFull') as number) ?? 0;
    confirmed = yes >= needed && yes > ((fix.get('earlyOther') as number) ?? 0);
  }
  if (confirmed && current !== 'fixed') {
    await pointRef.update({ status: 'fixed', statusBy: null, fixedBy: fixId, lastActivityAt: FieldValue.serverTimestamp() });
    await notifyPointFollowers(pointId, {
      type: 'status',
      text: `People who had this issue say it's fixed: "${point.get('text') as string}"`,
    });
    return 'fixed';
  }
  if (!confirmed && byThis && current === 'fixed') {
    await pointRef.update({ status: 'open', fixedBy: null });
    return 'open';
  }
  return current;
}
