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
 * Every added detail has the model read the whole complaint again
 * (`rereadWithDetail` in intake.ts): the detail is checked, the points are
 * filed under what it names and reworded where that is this author's to do,
 * and what is still missing is worked out afresh. If the model can't be
 * reached, or the day's AI budget is spent, the detail is still added after
 * the plain filters here; it just isn't read until the next one.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { ANTHROPIC_API_KEY } from './ai';
import { CALLABLE, cleanText, db, ensureUser, FieldValue, rateLimit, uidOf } from './common';
import { rereadWithDetail } from './intake';
import { hasContact, nameCalling } from './moderation';
import { stripSensitive } from './private';

const MAX_DETAILS = 5;

export const addDetail = onCall(
  { ...CALLABLE, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const uid = uidOf(req);
    const submissionId =
      typeof req.data?.submissionId === 'string' && /^[\w-]{1,128}$/.test(req.data.submissionId) ? req.data.submissionId : '';
    /** The suggestion this answers or dismisses, exactly as it was listed. */
    const item = typeof req.data?.item === 'string' ? req.data.item.slice(0, 120) : '';
    const raw = req.data?.text;
    // Adding runs the model, so it counts against the same daily allowance as checking a complaint.
    await rateLimit(req, raw != null ? 'analyze' : 'settings');
    const user = await ensureUser(uid);
    const author = await db.doc(`authors/${submissionId}`).get();
    if (author.get('uid') !== uid) throw new HttpsError('permission-denied', 'Only the author can add to a complaint.');
    const mine = db.doc(`users/${uid}/mine/${submissionId}`);

    if (raw == null) {
      // Dismissed: it won't be suggested again, even if a later re-read thinks of it.
      if (item) {
        await mine
          .update({ missing: FieldValue.arrayRemove(item), dismissed: FieldValue.arrayUnion(item) })
          .catch(() => {});
      }
      return { ok: true, reread: false, filedUnder: [] as string[] };
    }

    const text = stripSensitive(cleanText(raw, 200, 'The detail'));
    if (nameCalling(text)) throw new HttpsError('failed-precondition', 'Leave the name-calling out and add it again.');
    if (hasContact(text)) throw new HttpsError('failed-precondition', 'Leave out links and contact details.');
    const ref = db.doc(`submissions/${submissionId}`);
    const sub = await ref.get();
    if (!sub.exists || sub.get('removed')) throw new HttpsError('not-found', 'That complaint is gone.');
    if (((sub.get('details') as string[] | undefined) ?? []).length >= MAX_DETAILS) {
      throw new HttpsError('failed-precondition', 'That complaint has all the added details it can hold.');
    }

    try {
      const read = await rereadWithDetail({ displayName: user.displayName, submissionId, detail: text });
      const dismissed = ((await mine.get()).get('dismissed') as string[] | undefined) ?? [];
      await mine.update({ missing: read.missing.filter((m) => !dismissed.includes(m)) }).catch(() => {});
      return { ok: true, reread: true, filedUnder: read.filedUnder };
    } catch (e) {
      // The model said no to the detail itself: that is the answer.
      if (e instanceof HttpsError && e.code === 'failed-precondition') throw e;
      // Anything else (budget spent, model unreachable): keep what they wrote.
      console.error('Re-read failed; detail added unread', e);
      await ref.update({ details: FieldValue.arrayUnion(text) });
      if (item) await mine.update({ missing: FieldValue.arrayRemove(item) }).catch(() => {});
      return { ok: true, reread: false, filedUnder: [] as string[] };
    }
  },
);
