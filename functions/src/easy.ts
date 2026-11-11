/**
 * "Easy peasy": a reader's vote that a complaint looks easy to fix, from
 * what its author says happened or suggests. It sits next to "Best rant" on
 * every complaint and feeds the "Easiest" list, which sorts by it.
 *
 * One vote per account per complaint; who voted is private
 * (`submissions/{id}/easy/{uid}`), the count public (`submissions.easy`).
 * Unlike Best rant, an author can't vote for their own complaint: the vote
 * is someone else agreeing that the fix is easy. Never on imported records.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { CALLABLE, db, ensureUser, FieldValue, rateLimit, uidOf } from './common';

export const easyFix = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const submissionId = typeof req.data?.submissionId === 'string' ? req.data.submissionId : '';
  const easy = req.data?.easy !== false;
  if (!submissionId || !/^[\w-]{1,128}$/.test(submissionId)) throw new HttpsError('invalid-argument', 'Which complaint?');
  await rateLimit(req, 'support');
  await ensureUser(uid);
  const author = await db.doc(`authors/${submissionId}`).get();
  if (author.get('uid') === uid) throw new HttpsError('failed-precondition', 'That one is yours. Others decide if it is easy.');
  const ref = db.doc(`submissions/${submissionId}`);
  return db.runTransaction(async (tx) => {
    const sub = await tx.get(ref);
    if (!sub.exists || sub.get('removed')) throw new HttpsError('not-found', 'That complaint is gone.');
    if (sub.get('source')) throw new HttpsError('failed-precondition', 'Public records can\'t be voted on.');
    const mine = await tx.get(ref.collection('easy').doc(uid));
    const before = (sub.get('easy') as number | undefined) ?? 0;
    if (easy === mine.exists) return { easy, count: before };
    const count = Math.max(0, before + (easy ? 1 : -1));
    if (easy) tx.set(mine.ref, { uid, at: FieldValue.serverTimestamp() });
    else tx.delete(mine.ref);
    tx.update(ref, { easy: count });
    return { easy, count };
  });
});

/** Deleting an account withdraws its Easy peasy votes (account.ts). */
export async function withdrawEasy(uid: string) {
  const votes = await db.collectionGroup('easy').where('uid', '==', uid).get();
  for (const v of votes.docs) {
    const subRef = v.ref.parent.parent!;
    await db.runTransaction(async (tx) => {
      const sub = await tx.get(subRef);
      tx.delete(v.ref);
      if (sub.exists) tx.update(subRef, { easy: Math.max(0, ((sub.get('easy') as number | undefined) ?? 0) - 1) });
    });
  }
}

/** Signing in to an existing account brings the device's votes along, once each (merge.ts). */
export async function moveEasy(from: string, to: string): Promise<number> {
  let moved = 0;
  const votes = await db.collectionGroup('easy').where('uid', '==', from).get();
  for (const v of votes.docs) {
    const subRef = v.ref.parent.parent!;
    const mine = await subRef.collection('easy').doc(to).get();
    const own = (await db.doc(`authors/${subRef.id}`).get()).get('uid') === to;
    if (mine.exists || own) {
      // Already voted, or it is the account's own complaint now: the vote goes.
      const sub = await subRef.get();
      if (sub.exists) await subRef.update({ easy: Math.max(0, ((sub.get('easy') as number | undefined) ?? 0) - 1) });
    } else {
      await mine.ref.set({ ...v.data(), uid: to });
      moved++;
    }
    await v.ref.delete();
  }
  return moved;
}
