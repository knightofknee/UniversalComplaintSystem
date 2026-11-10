/**
 * Adding a detail to your own complaint after posting it.
 *
 * At intake the model lists up to three things a complaint doesn't say that
 * would help (the make and model of a product, which store, when). They are
 * suggestions, never requirements: the author sees them in the review, and
 * afterwards on their own complaint (`users/{uid}/mine/{id}.missing`, theirs
 * alone). There they can answer one in a line, which is added under the
 * complaint (`submissions.details`), or wave it away.
 *
 * No model reads a detail, so it is one short line, filtered: no
 * name-calling, no contact details or links, card and ID numbers removed.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { CALLABLE, cleanText, db, ensureUser, FieldValue, rateLimit, uidOf } from './common';
import { hasContact, nameCalling } from './moderation';
import { stripSensitive } from './private';

const MAX_DETAILS = 5;

export const addDetail = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const submissionId = typeof req.data?.submissionId === 'string' && /^[\w-]{1,128}$/.test(req.data.submissionId) ? req.data.submissionId : '';
  /** The suggestion this answers or dismisses, exactly as it was listed. */
  const item = typeof req.data?.item === 'string' ? req.data.item.slice(0, 120) : '';
  const raw = req.data?.text;
  await rateLimit(req, 'settings');
  await ensureUser(uid);
  const author = await db.doc(`authors/${submissionId}`).get();
  if (author.get('uid') !== uid) throw new HttpsError('permission-denied', 'Only the author can add to a complaint.');
  if (raw != null) {
    const text = stripSensitive(cleanText(raw, 200, 'The detail'));
    if (nameCalling(text)) throw new HttpsError('failed-precondition', 'Leave the name-calling out and add it again.');
    if (hasContact(text)) throw new HttpsError('failed-precondition', 'Leave out links and contact details.');
    const ref = db.doc(`submissions/${submissionId}`);
    const sub = await ref.get();
    if (!sub.exists || sub.get('removed')) throw new HttpsError('not-found', 'That complaint is gone.');
    if (((sub.get('details') as string[] | undefined) ?? []).length >= MAX_DETAILS) {
      throw new HttpsError('failed-precondition', 'That complaint has all the added details it can hold.');
    }
    await ref.update({ details: FieldValue.arrayUnion(text) });
  }
  if (item) {
    await db
      .doc(`users/${uid}/mine/${submissionId}`)
      .update({ missing: FieldValue.arrayRemove(item) })
      .catch(() => {});
  }
  return { ok: true };
});
