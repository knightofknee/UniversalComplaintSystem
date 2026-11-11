/**
 * Two points that say the same thing.
 *
 * At intake the model matches a complaint to an existing point when it can,
 * so duplicates are rare: they happen when the model misses a match and
 * makes a new point beside an old one. They are caught here, cheaply and
 * with no model call: whenever a complaint is posted, each point it touched
 * is compared (one vector lookup) with its nearest neighbours, and a pair
 * close enough to be the same complaint is put in the operator's queue
 * (`duplicates/{a}_{b}`). Nothing merges on its own: a person looks at the
 * pair and says "merge" or "not the same".
 *
 * Merging folds the smaller point into the larger: its supporters,
 * complaints, responses and proposed fixes move over, counts are recounted
 * from what is actually there, and it leaves the record.
 */
import { FieldValue as AdminFieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { CALLABLE, db, FieldValue, requireOperator, Timestamp } from './common';
import { moveStatements } from './statements';

/**
 * Cosine distance under which two points are probably the same complaint.
 * Measured: the same complaint reworded sits at 0.07-0.15, unrelated ones at
 * 0.19 and up. This only nominates a pair; a person decides.
 */
const DUPLICATE_DISTANCE = 0.12;
const WEEK_MS = 7 * 24 * 3600_000;

/** After a complaint is posted: nominate near-identical neighbours of the points it touched. Never throws. */
export async function flagDuplicates(store: Firestore, pointIds: string[]) {
  for (const id of pointIds.slice(0, 4)) {
    try {
      const point = await store.doc(`points/${id}`).get();
      const vector = (point.get('embedding') as { toArray(): number[] } | undefined)?.toArray();
      if (!point.exists || point.get('removed') || !vector) continue;
      const near = await store
        .collection('points')
        .where('removed', '==', false)
        .findNearest({
          vectorField: 'embedding',
          queryVector: AdminFieldValue.vector(vector),
          limit: 4,
          distanceMeasure: 'COSINE',
          distanceResultField: 'distance',
        })
        .get();
      for (const other of near.docs) {
        const distance = other.get('distance') as number;
        if (other.id === id || distance >= DUPLICATE_DISTANCE) continue;
        const [a, b] = [id, other.id].sort();
        const ref = store.doc(`duplicates/${a}_${b}`);
        // A pair is nominated once; a "not the same" stays decided.
        if ((await ref.get()).exists) continue;
        await ref.set({
          a,
          b,
          texts: { [id]: point.get('text'), [other.id]: other.get('text') },
          people: { [id]: point.get('supportCount') ?? 0, [other.id]: other.get('supportCount') ?? 0 },
          distance: Math.round(distance * 1000) / 1000,
          status: 'open',
          at: FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      console.error('Duplicate check failed', id, e);
    }
  }
}

/** Operator: merge a nominated pair, or say they are not the same. */
export const resolveDuplicate = onCall({ ...CALLABLE, timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  requireOperator(req);
  const id = typeof req.data?.id === 'string' && /^[\w-]{3,300}$/.test(req.data.id) ? req.data.id : '';
  const ref = db.doc(`duplicates/${id}`);
  const pair = await ref.get();
  if (!pair.exists) throw new HttpsError('not-found', 'No such pair.');
  if (req.data?.action !== 'merge') {
    await ref.update({ status: 'dismissed', decidedAt: FieldValue.serverTimestamp() });
    return { merged: null };
  }
  const [x, y] = await Promise.all([db.doc(`points/${pair.get('a')}`).get(), db.doc(`points/${pair.get('b')}`).get()]);
  if (!x.exists || !y.exists || x.get('removed') || y.get('removed')) {
    await ref.update({ status: 'dismissed', decidedAt: FieldValue.serverTimestamp() });
    throw new HttpsError('failed-precondition', 'One of them is already gone.');
  }
  // The one more people stand behind keeps its place and its wording.
  const [keep, gone] = ((x.get('supportCount') as number) ?? 0) >= ((y.get('supportCount') as number) ?? 0) ? [x, y] : [y, x];
  await mergePoints(keep.id, gone.id);
  await ref.update({ status: 'merged', into: keep.id, decidedAt: FieldValue.serverTimestamp() });
  return { merged: keep.id };
});

/** Folds `goneId` into `keepId`. Counts are recounted from the documents, not adjusted. */
export async function mergePoints(keepId: string, goneId: string) {
  const keepRef = db.doc(`points/${keepId}`);
  const goneRef = db.doc(`points/${goneId}`);
  const [keep, gone] = await Promise.all([keepRef.get(), goneRef.get()]);
  const keepSubjects = (keep.get('subjectIds') as string[]) ?? [];
  const goneSubjects = (gone.get('subjectIds') as string[]) ?? [];
  const oldKeepCount = (keep.get('supportCount') as number) ?? 0;
  const oldGoneCount = (gone.get('supportCount') as number) ?? 0;

  // Supporters: once each.
  const supports = await goneRef.collection('supports').get();
  for (const s of supports.docs) {
    const mine = keepRef.collection('supports').doc(s.id);
    if (!(await mine.get()).exists) await mine.set(s.data());
    await s.ref.delete();
  }
  // Complaints that raised or matched the old point now belong to the kept one.
  let rants = 0;
  const moved = new Set<string>();
  for (const field of ['matchedPointIds', 'addedPointIds'] as const) {
    const subs = await db.collection('submissions').where(field, 'array-contains', goneId).get();
    for (const s of subs.docs) {
      await s.ref.update({ [field]: FieldValue.arrayRemove(goneId) });
      const already = [...((s.get('matchedPointIds') as string[]) ?? []), ...((s.get('addedPointIds') as string[]) ?? [])].includes(keepId);
      if (!already) {
        await s.ref.update({ matchedPointIds: FieldValue.arrayUnion(keepId) });
        if (!moved.has(s.id) && !s.get('removed')) {
          moved.add(s.id);
          if (s.get('tone') === 'rant') rants++;
        }
      }
    }
  }
  // Responses and proposed fixes come along (a fix by someone who proposed on both stays single).
  for (const name of ['responses', 'solutions']) {
    const docs = await goneRef.collection(name).get();
    for (const d of docs.docs) {
      const target = keepRef.collection(name).doc(d.id);
      if (!(await target.get()).exists) {
        await target.set(d.data());
        if (name === 'solutions') {
          const ratings = await d.ref.collection('ratings').get();
          await Promise.all(ratings.docs.map((r) => target.collection('ratings').doc(r.id).set(r.data())));
        }
      }
      await db.recursiveDelete(d.ref);
    }
  }
  // What each complaint said about the old issue now reads under the kept one.
  await moveStatements(goneRef, keepRef);
  // Private complaints linked to the old point follow it.
  const linked = await db.collectionGroup('privatePoints').where('pointId', '==', goneId).get();
  await Promise.all(linked.docs.map((d) => d.ref.update({ pointId: keepId })));

  // Recount from what is there now.
  const all = await keepRef.collection('supports').select('at').get();
  const cutoff = Date.now() - WEEK_MS;
  const recent = (d: FirebaseFirestore.QueryDocumentSnapshot) => ((d.get('at') as Timestamp | undefined)?.toMillis() ?? 0) >= cutoff;
  const real = all.docs.filter((d) => !d.id.includes(':'));
  const solutions = (await keepRef.collection('solutions').where('removed', '==', false).count().get()).data().count;
  const submissionCount = ((keep.get('submissionCount') as number) ?? 0) + moved.size;
  const rantCount = ((keep.get('rantCount') as number) ?? 0) + rants;
  const extra = goneSubjects.filter((s) => !keepSubjects.includes(s)).slice(0, Math.max(0, 8 - keepSubjects.length));
  const names = gone.get('subjectNames') as string[];
  const topics = (gone.get('topicIds') as string[] | undefined) ?? [];
  await keepRef.update({
    supportCount: all.size,
    people: real.length,
    weekSupport: all.docs.filter(recent).length,
    weekPeople: real.filter(recent).length,
    submissionCount,
    rantCount,
    hot: submissionCount > 0 && rantCount / submissionCount >= 0.5,
    solutionCount: solutions,
    // Raised by a person if either was.
    imported: keep.get('imported') === true && gone.get('imported') === true,
    lastActivityAt: FieldValue.serverTimestamp(),
    ...(extra.length
      ? {
          subjectIds: FieldValue.arrayUnion(...extra),
          subjectNames: FieldValue.arrayUnion(...extra.map((s) => names[goneSubjects.indexOf(s)])),
          ...(extra.some((s) => topics.includes(s)) ? { topicIds: FieldValue.arrayUnion(...extra.filter((s) => topics.includes(s))) } : {}),
        }
      : {}),
  });
  // Each page's totals: the old point leaves, the kept one changes size.
  const bump = (sid: string, points: number, supporters: number) =>
    db
      .doc(`subjects/${sid}`)
      .update({ 'stats.points': FieldValue.increment(points), 'stats.supporters': FieldValue.increment(supporters) })
      .catch(() => {});
  for (const sid of goneSubjects) await bump(sid, -1, -oldGoneCount);
  for (const sid of keepSubjects) await bump(sid, 0, all.size - oldKeepCount);
  for (const sid of extra) await bump(sid, 1, all.size);
  await goneRef.update({ removed: true, mergedInto: keepId });
}
