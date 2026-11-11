/**
 * Signing in to an account that already exists.
 *
 * Everyone starts signed out, on an anonymous account that belongs to the
 * device. Signing UP attaches an email, Google or Apple to that same
 * account, so nothing moves. Signing IN to an account that already exists
 * switches accounts, and without this the complaint someone just posted
 * would be left behind on the anonymous one. So the app hands over proof of
 * the account it was on (its ID token, taken just before switching) and
 * everything that account did moves into the one now signed in:
 *
 * - its public complaints (and the name on them becomes this account's);
 * - its support, "Best rant" votes, fix confirmations, proposed fixes and
 *   fix ratings. Where both accounts did the same thing it counts once, and
 *   the totals drop by the duplicate;
 * - its hidden authors, notifications, drafts and queued complaints.
 *
 * Then the anonymous account is deleted. Only an anonymous account can be
 * merged, and only into a signed-in one, so two real accounts can never be
 * folded together this way.
 */
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { authorIdOf, CALLABLE, db, ensureUser, FieldValue, rateLimit, Timestamp, uidOf } from './common';
import { rantRank } from './rants';
import { settleFix } from './solutions';
import { moveEasy } from './easy';

const WEEK_MS = 7 * 24 * 3600_000;

export const mergeAccount = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async (req) => {
  const to = uidOf(req);
  if (req.auth?.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('failed-precondition', 'Sign in first.');
  }
  const fromToken = typeof req.data?.fromToken === 'string' ? req.data.fromToken : '';
  const proof = await getAuth()
    .verifyIdToken(fromToken)
    .catch(() => null);
  if (!proof || proof.firebase?.sign_in_provider !== 'anonymous') {
    throw new HttpsError('permission-denied', 'Nothing to bring over.');
  }
  const from = proof.uid;
  if (from === to) return { moved: 0 };
  await rateLimit(req, 'settings');
  const me = await ensureUser(to);
  const old = await db.doc(`users/${from}`).get();
  if (!old.exists) return { moved: 0 };
  if (old.get('banned') === true) throw new HttpsError('permission-denied', 'That account was suspended.');

  const fromAuthor = authorIdOf(from);
  const toAuthor = authorIdOf(to);
  let moved = 0;

  // Support: once per person per point.
  const supports = await db.collectionGroup('supports').where('uid', '==', from).get();
  for (const s of supports.docs) {
    const pointRef = s.ref.parent.parent!;
    const point = await pointRef.get();
    const mine = await pointRef.collection('supports').doc(to).get();
    const subjectIds = (point.get('subjectIds') as string[] | undefined) ?? [];
    // Already supported, or a point about an organization this account responds for: the duplicate goes.
    if (mine.exists || !point.exists || subjectIds.some((id) => me.responderFor.includes(id))) {
      const recent = Date.now() - ((s.get('at') as Timestamp | undefined)?.toMillis() ?? 0) < WEEK_MS;
      if (point.exists) {
        await pointRef.update({
          supportCount: FieldValue.increment(-1),
          people: FieldValue.increment(-1),
          ...(recent ? { weekSupport: FieldValue.increment(-1), weekPeople: FieldValue.increment(-1) } : {}),
        });
        for (const sid of subjectIds) {
          await db.doc(`subjects/${sid}`).update({ 'stats.supporters': FieldValue.increment(-1) }).catch(() => {});
        }
      }
    } else {
      await mine.ref.set({ ...s.data(), uid: to });
      moved++;
    }
    await s.ref.delete();
  }

  // "Best rant" votes.
  const loves = await db.collectionGroup('loves').where('uid', '==', from).get();
  for (const l of loves.docs) {
    const subRef = l.ref.parent.parent!;
    const mine = await subRef.collection('loves').doc(to).get();
    if (mine.exists) {
      const sub = await subRef.get();
      if (sub.exists) {
        const left = Math.max(0, ((sub.get('loves') as number | undefined) ?? 0) - 1);
        await subRef.update({
          loves: left,
          rantRank: rantRank({ loves: left, rantScore: (sub.get('rantScore') as number | undefined) ?? 0, imported: !!sub.get('source') }),
        });
      }
    } else {
      await mine.ref.set({ ...l.data(), uid: to });
      moved++;
    }
    await l.ref.delete();
  }

  // "Easy peasy" votes.
  moved += await moveEasy(from, to);

  // Fix confirmations on an organization's claim.
  const votes = await db.collectionGroup('fixVotes').where('uid', '==', from).get();
  for (const v of votes.docs) {
    const orgId = v.get('orgId') as string | undefined;
    const mine = orgId ? await v.ref.parent.doc(`${orgId}_${to}`).get() : null;
    if (!orgId || mine!.exists || me.responderFor.includes(orgId)) {
      if (orgId) {
        await v.ref.parent.parent!
          .update({ [`orgStatus.${orgId}.${v.get('fixed') ? 'yes' : 'no'}`]: FieldValue.increment(-1) })
          .catch(() => {});
      }
    } else {
      await mine!.ref.set({ ...v.data(), uid: to });
      moved++;
    }
    await v.ref.delete();
  }

  // Ratings of proposed fixes (never of this account's own fix).
  const ratings = await db.collectionGroup('ratings').where('uid', '==', from).get();
  for (const r of ratings.docs) {
    const fixRef = r.ref.parent.parent!;
    const mine = await fixRef.collection('ratings').doc(to).get();
    if (mine.exists || fixRef.id === toAuthor) {
      const rating = r.get('rating') as string;
      await fixRef
        .update({
          [rating]: FieldValue.increment(-1),
          ...(r.get('early') ? { [rating === 'full' ? 'earlyFull' : 'earlyOther']: FieldValue.increment(-1) } : {}),
        })
        .catch(() => {});
      await r.ref.delete();
      await settleFix(fixRef.parent.parent!.id, fixRef.id);
    } else {
      await mine.ref.set({ ...r.data(), uid: to });
      await r.ref.delete();
      moved++;
    }
  }

  // Fixes it proposed: a fix's id is its proposer's author id, so it moves to this account's.
  const fixes = await db.collectionGroup('solutions').where('authorId', '==', fromAuthor).get();
  for (const f of fixes.docs) {
    const pointRef = f.ref.parent.parent!;
    const target = pointRef.collection('solutions').doc(toAuthor);
    await db.doc(`authors/s_${pointRef.id}_${f.id}`).delete();
    if ((await target.get()).exists) {
      // This account already proposed one here; one per person per point.
      await db.recursiveDelete(f.ref);
      await pointRef.update({ solutionCount: FieldValue.increment(-1) }).catch(() => {});
      await settleFix(pointRef.id, f.id);
      continue;
    }
    await target.set({ ...f.data(), authorId: toAuthor, authorName: me.displayName });
    const given = await f.ref.collection('ratings').get();
    await Promise.all(given.docs.map((g) => target.collection('ratings').doc(g.id).set(g.data())));
    await db.doc(`authors/s_${pointRef.id}_${toAuthor}`).set({ uid: to });
    if ((await pointRef.get()).get('fixedBy') === f.id) await pointRef.update({ fixedBy: toAuthor });
    await db.recursiveDelete(f.ref);
    moved++;
  }

  // Public complaints: this account's now, under its name.
  const mine = await db.collection(`users/${from}/mine`).get();
  for (const m of mine.docs) {
    await db.doc(`users/${to}/mine/${m.id}`).set(m.data());
    const sub = await db.doc(`submissions/${m.id}`).get();
    if (sub.exists) {
      await sub.ref.update({ authorId: toAuthor, authorName: me.displayName });
      for (const pid of [
        ...((sub.get('addedPointIds') as string[] | undefined) ?? []),
        ...((sub.get('matchedPointIds') as string[] | undefined) ?? []),
      ]) {
        const point = await db.doc(`points/${pid}`).get();
        if (point.get('canonical.submissionId') === m.id) await point.ref.update({ 'canonical.authorName': me.displayName });
      }
    }
    moved++;
  }
  const authored = await db.collection('authors').where('uid', '==', from).get();
  await Promise.all(authored.docs.map((d) => d.ref.update({ uid: to })));

  // The rest of what was theirs.
  for (const name of ['blocks', 'notifications']) {
    const docs = await db.collection(`users/${from}/${name}`).limit(300).get();
    await Promise.all(docs.docs.map((d) => db.doc(`users/${to}/${name}/${d.id}`).set(d.data())));
  }
  for (const name of ['drafts', 'queue']) {
    const docs = await db.collection(name).where('uid', '==', from).get();
    await Promise.all(docs.docs.map((d) => d.ref.update({ uid: to })));
  }
  const reported = await db.collection('reports').where('reporterUid', '==', from).get();
  await Promise.all(reported.docs.map((d) => d.ref.update({ reporterUid: to })));
  if (!me.termsAcceptedAt && old.get('termsAcceptedAt')) {
    await db.doc(`users/${to}`).update({ termsAcceptedAt: old.get('termsAcceptedAt') });
  }

  // The device's account is empty now.
  await db.doc(`rateLimits/${from}`).delete();
  await db.recursiveDelete(db.doc(`users/${from}`));
  await getAuth()
    .deleteUser(from)
    .catch(() => {});
  return { moved };
});
