/**
 * Deleting an account. What the privacy policy promises, in order:
 * - private complaints, their conversations and photos are deleted
 *   (the organization's anonymous private counts stay: they hold no words);
 * - public complaints lose their text, photos and author name; the points
 *   they fed stay on the record (other people share them), unattributed;
 * - every support, "Best rant" vote, fix confirmation and fix rating is
 *   withdrawn and the counts drop; fixes they proposed are deleted;
 * - organization access, requests, queued complaints, blocks, notifications,
 *   phone notification tokens, limits and the sign-in itself are removed;
 *   reports they sent stay (they're about others' posts) without their name.
 */
import { getAuth } from 'firebase-admin/auth';
import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { authorIdOf, CALLABLE, bucket, db, FieldValue, Timestamp, uidOf } from './common';
import { rantRank } from './rants';
import { settleFix } from './solutions';
import { withdrawEasy } from './easy';

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

  // Support: withdraw, and take it out of every count it was in.
  const supports = await db.collectionGroup('supports').where('uid', '==', uid).get();
  for (const s of supports.docs) {
    const pointRef = s.ref.parent.parent!;
    const point = await pointRef.get();
    const recent = Date.now() - ((s.get('at') as Timestamp | undefined)?.toMillis() ?? 0) < WEEK_MS;
    if (point.exists) {
      await pointRef.update({
        supportCount: FieldValue.increment(-1),
        people: FieldValue.increment(-1),
        ...(recent ? { weekSupport: FieldValue.increment(-1), weekPeople: FieldValue.increment(-1) } : {}),
      });
      for (const sid of point.get('subjectIds') as string[]) {
        await db.doc(`subjects/${sid}`).update({ 'stats.supporters': FieldValue.increment(-1) });
      }
    }
    await s.ref.delete();
  }
  // "Best rant" votes: withdraw, and the complaint's count and rank drop.
  const loves = await db.collectionGroup('loves').where('uid', '==', uid).get();
  for (const l of loves.docs) {
    const subRef = l.ref.parent.parent!;
    await db.runTransaction(async (tx) => {
      const sub = await tx.get(subRef);
      tx.delete(l.ref);
      if (!sub.exists) return;
      const left = Math.max(0, ((sub.get('loves') as number | undefined) ?? 0) - 1);
      tx.update(subRef, {
        loves: left,
        rantRank: rantRank({
          loves: left,
          rantScore: (sub.get('rantScore') as number | undefined) ?? 0,
          imported: !!sub.get('source'),
        }),
      });
    });
  }
  // "Easy peasy" votes: withdrawn the same way.
  await withdrawEasy(uid);
  // Fixes they proposed are deleted with their ratings; ratings they gave
  // are withdrawn and the tallies drop. Either can change what is Fixed.
  const fixes = await db.collectionGroup('solutions').where('authorId', '==', authorIdOf(uid)).get();
  for (const f of fixes.docs) {
    const pointId = f.ref.parent.parent!.id;
    await db.recursiveDelete(f.ref);
    await db.doc(`authors/s_${pointId}_${f.id}`).delete();
    await db.doc(`points/${pointId}`).update({ solutionCount: FieldValue.increment(-1) }).catch(() => {});
    await settleFix(pointId, f.id);
  }
  const ratings = await db.collectionGroup('ratings').where('uid', '==', uid).get();
  for (const r of ratings.docs) {
    const fixRef = r.ref.parent.parent!;
    const rating = r.get('rating') as string;
    await fixRef
      .update({
        [rating]: FieldValue.increment(-1),
        ...(r.get('early') ? { [rating === 'full' ? 'earlyFull' : 'earlyOther']: FieldValue.increment(-1) } : {}),
      })
      .catch(() => {});
    await r.ref.delete();
    await settleFix(fixRef.parent.parent!.id, fixRef.id);
  }
  const votes = await db.collectionGroup('fixVotes').where('uid', '==', uid).get();
  for (const v of votes.docs) {
    const orgId = v.get('orgId') as string | undefined;
    if (orgId) {
      await v.ref.parent.parent!
        .update({ [`orgStatus.${orgId}.${v.get('fixed') ? 'yes' : 'no'}`]: FieldValue.increment(-1) })
        .catch(() => {});
    }
    await v.ref.delete();
  }

  // Public complaints: the words and photos go; the shared points stay.
  const mine = await db.collection(`users/${uid}/mine`).get();
  for (const m of mine.docs) {
    const sub = db.doc(`submissions/${m.id}`);
    const snap = await sub.get();
    if (!snap.exists) continue;
    // The words are gone, so it leaves "Best rants" too.
    await sub.update({
      text: '[deleted]',
      englishText: null,
      photos: [],
      details: [],
      authorName: DELETED,
      rantScore: 0,
      rantRank: 0,
    });
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

  // Complaints waiting for the AI budget, the private links from public
  // complaints and responses to this account, and who sent which report.
  const queued = await db.collection('queue').where('uid', '==', uid).get();
  await Promise.all(queued.docs.map((d) => d.ref.delete()));
  const authored = await db.collection('authors').where('uid', '==', uid).get();
  await Promise.all(authored.docs.map((d) => d.ref.delete()));
  const reported = await db.collection('reports').where('reporterUid', '==', uid).get();
  await Promise.all(reported.docs.map((d) => d.ref.update({ reporterUid: null })));

  await db.doc(`rateLimits/${uid}`).delete();
  await bucket().deleteFiles({ prefix: `uploads/${uid}/` });
  await bucket().deleteFiles({ prefix: `queued/${uid}/` });
  await deleteTree(db.doc(`users/${uid}`));
  await getAuth().deleteUser(uid);
  return { deleted: true };
});

/**
 * Deleting one of your own public complaints. The words, photos and added
 * details go and it leaves every list. What it did to the record is undone:
 * the support it gave each point is withdrawn, and a point that existed only
 * because of this complaint goes with it. A point other people share stays,
 * without this author's name on its headline.
 */
export const deleteComplaint = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async (req) => {
  const uid = uidOf(req);
  const id = typeof req.data?.submissionId === 'string' && /^[\w-]{1,128}$/.test(req.data.submissionId) ? req.data.submissionId : '';
  const author = await db.doc(`authors/${id}`).get();
  if (!id || author.get('uid') !== uid) throw new HttpsError('permission-denied', 'Only the author can delete a complaint.');
  const ref = db.doc(`submissions/${id}`);
  const sub = await ref.get();
  if (!sub.exists) throw new HttpsError('not-found', 'That complaint is gone.');
  const isRant = sub.get('tone') === 'rant';
  const pointIds = [
    ...new Set([
      ...((sub.get('addedPointIds') as string[] | undefined) ?? []),
      ...((sub.get('matchedPointIds') as string[] | undefined) ?? []),
    ]),
  ];
  for (const pid of pointIds) {
    const pointRef = db.doc(`points/${pid}`);
    const point = await pointRef.get();
    if (!point.exists) continue;
    const subjectIds = (point.get('subjectIds') as string[] | undefined) ?? [];
    const update: Record<string, unknown> = {
      submissionCount: FieldValue.increment(-1),
      ...(isRant ? { rantCount: FieldValue.increment(-1) } : {}),
    };
    // The support this complaint gave (not support given separately with the arrow).
    const support = await pointRef.collection('supports').doc(uid).get();
    if (support.exists && support.get('submissionId') === id) {
      const recent = Date.now() - ((support.get('at') as Timestamp | undefined)?.toMillis() ?? 0) < WEEK_MS;
      update.supportCount = FieldValue.increment(-1);
      update.people = FieldValue.increment(-1);
      if (recent) {
        update.weekSupport = FieldValue.increment(-1);
        update.weekPeople = FieldValue.increment(-1);
      }
      await support.ref.delete();
      for (const sid of subjectIds) {
        await db.doc(`subjects/${sid}`).update({ 'stats.supporters': FieldValue.increment(-1) }).catch(() => {});
      }
    }
    const alone = ((point.get('submissionCount') as number | undefined) ?? 1) <= 1;
    if (alone) {
      update.removed = true;
      for (const sid of subjectIds) {
        await db.doc(`subjects/${sid}`).update({ 'stats.points': FieldValue.increment(-1) }).catch(() => {});
      }
    } else if (point.get('canonical.submissionId') === id) {
      update['canonical.authorName'] = DELETED;
    }
    await pointRef.update(update);
  }
  await ref.update({
    text: '[deleted]',
    englishText: null,
    photos: [],
    details: [],
    authorName: DELETED,
    rantScore: 0,
    rantRank: 0,
    removed: true,
  });
  await bucket().deleteFiles({ prefix: `public/${id}/` });
  await db.recursiveDelete(ref.collection('loves'));
  await db.recursiveDelete(ref.collection('easy'));
  await db.doc(`users/${uid}/mine/${id}`).delete();
  await author.ref.delete();
  return { deleted: true };
});
