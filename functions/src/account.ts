/**
 * Deleting an account. What the privacy policy promises, in order:
 * - private complaints, their conversations and photos are deleted
 *   (the organization's anonymous private counts stay: they hold no words);
 * - public complaints lose their text, photos and author name; the points
 *   they fed stay on the record (other people share them), unattributed;
 * - every "Me too" and fix confirmation is withdrawn and the counts drop;
 * - organization access, requests, notifications, limits and the sign-in
 *   itself are removed.
 */
import { getAuth } from 'firebase-admin/auth';
import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { CALLABLE, bucket, db, FieldValue, Timestamp, uidOf } from './common';

const DELETED = 'Deleted account';
const WEEK_MS = 7 * 24 * 3600_000;

async function deleteTree(ref: DocumentReference) {
  await db.recursiveDelete(ref);
}

export const deleteAccount = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async (req) => {
  const uid = uidOf(req);
  if (req.data?.confirm !== true) throw new HttpsError('invalid-argument', 'Confirm first.');

  // Private complaints and their conversations.
  const threads = await db.collection(`users/${uid}/threads`).get();
  for (const t of threads.docs) {
    const orgId = t.get('orgId') as string;
    await deleteTree(db.doc(`subjects/${orgId}/inbox/${t.id}`));
    await bucket().deleteFiles({ prefix: `private/${orgId}/${uid}/${t.id}/` });
  }
  const follows = await db.collectionGroup('followers').where('uid', '==', uid).get();
  await Promise.all(follows.docs.map((d) => d.ref.delete()));

  // "Me too": withdraw, and take it out of every count it was in.
  const supports = await db.collectionGroup('supports').where('uid', '==', uid).get();
  for (const s of supports.docs) {
    const pointRef = s.ref.parent.parent!;
    const point = await pointRef.get();
    const recent = Date.now() - ((s.get('at') as Timestamp | undefined)?.toMillis() ?? 0) < WEEK_MS;
    if (point.exists) {
      await pointRef.update({
        supportCount: FieldValue.increment(-1),
        ...(recent ? { weekSupport: FieldValue.increment(-1) } : {}),
      });
      for (const sid of point.get('subjectIds') as string[]) {
        await db.doc(`subjects/${sid}`).update({ 'stats.supporters': FieldValue.increment(-1) });
      }
    }
    await s.ref.delete();
  }
  const votes = await db.collectionGroup('fixVotes').where('uid', '==', uid).get();
  for (const v of votes.docs) {
    await v.ref.parent.parent!.update({ [`fixVotes.${v.get('fixed') ? 'yes' : 'no'}`]: FieldValue.increment(-1) });
    await v.ref.delete();
  }

  // Public complaints: the words and photos go; the shared points stay.
  const mine = await db.collection(`users/${uid}/mine`).get();
  for (const m of mine.docs) {
    const sub = db.doc(`submissions/${m.id}`);
    const snap = await sub.get();
    if (!snap.exists) continue;
    await sub.update({ text: '[deleted]', englishText: null, photos: [], authorName: DELETED });
    await bucket().deleteFiles({ prefix: `public/${m.id}/` });
    for (const pid of [...(snap.get('addedPointIds') as string[]), ...(snap.get('matchedPointIds') as string[])]) {
      const point = await db.doc(`points/${pid}`).get();
      if (point.get('canonical.submissionId') === m.id) {
        await point.ref.update({ 'canonical.authorName': DELETED });
      }
    }
  }

  // Organization access and requests.
  const user = await db.doc(`users/${uid}`).get();
  for (const sid of (user.get('responderFor') as string[] | undefined) ?? []) {
    await db.doc(`subjects/${sid}/responders/${uid}`).delete();
  }
  const claims = await db.collection('claims').where('uid', '==', uid).get();
  await Promise.all(claims.docs.map((d) => d.ref.delete()));
  const drafts = await db.collection('drafts').where('uid', '==', uid).get();
  await Promise.all(drafts.docs.map((d) => d.ref.delete()));

  await db.doc(`rateLimits/${uid}`).delete();
  await bucket().deleteFiles({ prefix: `uploads/${uid}/` });
  await deleteTree(db.doc(`users/${uid}`));
  await getAuth().deleteUser(uid);
  return { deleted: true };
});
