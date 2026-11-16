/**
 * "Best rant": a reader's vote for one complaint as a read, separate from
 * supporting the point it raises (which says "I have this problem too").
 * One vote per account per complaint; who voted is private, the count public.
 * Authors may vote for their own: accounts are free to make, so forbidding it
 * would stop nobody and only hide the button from the person who wrote it.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { CALLABLE, db, ensureUser, FieldValue, notify, rateLimit, uidOf } from './common';

/**
 * The sort key of "Best rants". People's votes come first, then anything a
 * person wrote outranks an imported record, then the model's 1-10 score.
 * Zero keeps a complaint off the list: not a rant, and nobody voted for it.
 */
export function rantRank(s: { loves: number; rantScore: number; imported: boolean }): number {
  if (s.loves <= 0 && s.rantScore <= 0) return 0;
  return s.loves * 1000 + (s.imported ? 0 : 100) + s.rantScore;
}

/** Counts at which an author hears about votes on their complaint: the first, then milestones, never every vote. */
const VOTE_MILESTONES = [1, 3, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Tells a complaint's author that people voted for it (Best rant or Easy
 * peasy), at milestones only, each milestone once (`notified.{kind}` on the
 * author record, server-only). Never for their own vote.
 */
export async function announceVote(submissionId: string, voter: string, kind: 'love' | 'easy', count: number, text: string) {
  if (!VOTE_MILESTONES.includes(count)) return;
  const author = db.doc(`authors/${submissionId}`);
  const uid = await db.runTransaction(async (tx) => {
    const a = await tx.get(author);
    const owner = a.get('uid') as string | undefined;
    if (!owner || owner === voter || owner.includes(':')) return null;
    if (((a.get(`notified.${kind}`) as number | undefined) ?? 0) >= count) return null;
    tx.update(author, { [`notified.${kind}`]: count });
    return owner;
  });
  if (!uid) return;
  const words = `"${text.length > 70 ? `${text.slice(0, 69).trimEnd()}…` : text}"`;
  const who = count === 1 ? 'Someone' : `${count.toLocaleString('en-US')} people`;
  await notify([uid], {
    type: kind,
    submissionId,
    text:
      kind === 'love'
        ? `🤬 ${who} voted your complaint Best rant: ${words}`
        : `🍋 ${who} ${count === 1 ? 'thinks' : 'think'} your complaint looks easy to fix: ${words}`,
  });
}

export const loveRant = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const submissionId = typeof req.data?.submissionId === 'string' ? req.data.submissionId : '';
  const love = req.data?.love !== false;
  if (!submissionId) throw new HttpsError('invalid-argument', 'Which complaint?');
  await rateLimit(req, 'support');
  await ensureUser(uid);
  const ref = db.doc(`submissions/${submissionId}`);
  const res = await db.runTransaction(async (tx) => {
    const sub = await tx.get(ref);
    if (!sub.exists || sub.get('removed')) throw new HttpsError('not-found', 'That complaint is gone.');
    if (sub.get('source')) throw new HttpsError('failed-precondition', 'Public records can\'t be voted on.');
    const mine = await tx.get(ref.collection('loves').doc(uid));
    const before = (sub.get('loves') as number | undefined) ?? 0;
    if (love === mine.exists) return { loved: love, loves: before };
    const loves = Math.max(0, before + (love ? 1 : -1));
    if (love) tx.set(mine.ref, { uid, at: FieldValue.serverTimestamp() });
    else tx.delete(mine.ref);
    tx.update(ref, {
      loves,
      rantRank: rantRank({ loves, rantScore: (sub.get('rantScore') as number | undefined) ?? 0, imported: false }),
    });
    return { loved: love, loves, changed: true, text: sub.get('text') as string };
  });
  if ('changed' in res && res.loved) await announceVote(submissionId, uid, 'love', res.loves, res.text ?? '').catch(() => {});
  return { loved: res.loved, loves: res.loves };
});
