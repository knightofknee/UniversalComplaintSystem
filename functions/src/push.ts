/**
 * Phone notifications. Nothing asks for permission until it means something
 * (right after posting or sending privately, or the switch in Me), then this
 * phone's Expo push token is stored on the account (`users/{uid}.pushTokens`)
 * and `pushOn` lets `notify` (common.ts) reach it.
 *
 * A phone belongs to one account at a time: registering a token takes it off
 * whichever account held it before (owners by token hash, server only), so
 * one person's notifications never land on the next person's phone.
 */
import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { CALLABLE, db, FieldPath, FieldValue, rateLimit, uidOf } from './common';

export const setPush = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  await rateLimit(req, 'settings');
  const token = typeof req.data?.token === 'string' ? req.data.token : null;
  if (token && !/^Expo(nent)?PushToken\[[\w-]+\]$/.test(token)) throw new HttpsError('invalid-argument', 'Bad token.');
  const on = req.data?.on === true;
  const user = db.doc(`users/${uid}`);
  if (on) {
    if (!token) throw new HttpsError('invalid-argument', 'No token.');
    const owner = db.doc(`pushTokenOwners/${createHash('sha256').update(token).digest('hex')}`);
    const previous = (await owner.get()).get('uid') as string | undefined;
    if (previous && previous !== uid) {
      await db
        .doc(`users/${previous}`)
        .update(new FieldPath('pushTokens', token), FieldValue.delete())
        .catch(() => {});
    }
    await owner.set({ uid, at: FieldValue.serverTimestamp() });
    await user.set(
      { pushOn: true, pushTokens: { [token]: { platform: String(req.data?.platform ?? ''), at: FieldValue.serverTimestamp() } } },
      { merge: true },
    );
  } else {
    await user.set({ pushOn: false }, { merge: true });
    if (token) await user.update(new FieldPath('pushTokens', token), FieldValue.delete()).catch(() => {});
  }
  return { on };
});
