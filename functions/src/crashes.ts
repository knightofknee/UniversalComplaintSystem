/**
 * Crashes the app caught (the crash screen, src/components/crash-screen.tsx).
 * Kept in `crashes` (server only) so the daily report check can say when the
 * app is breaking for people; there is no crash service. Rate limited like
 * everything else, and nothing about the person beyond their account id.
 */
import { onCall } from 'firebase-functions/v2/https';

import { CALLABLE, db, FieldValue, rateLimit, uidOf } from './common';

const short = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export const reportCrash = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  await rateLimit(req, 'crash');
  await db.collection('crashes').add({
    message: short(req.data?.message, 500) ?? 'unknown',
    stack: short(req.data?.stack, 4000),
    where: short(req.data?.where, 200),
    platform: short(req.data?.platform, 20),
    appVersion: short(req.data?.appVersion, 20),
    uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});
