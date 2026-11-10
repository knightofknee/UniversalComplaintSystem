import { setGlobalOptions } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db, Timestamp } from './common';

setGlobalOptions({ region: 'us-central1', maxInstances: 20 });

export { analyzeComplaint, getDraft, processQueue, searchPoints, submitComplaint } from './intake';
export { flushNotices, recountRising, supportPoint, voteFix } from './points';
export { loveRant } from './rants';
export { linkPreview } from './share';
export { proposeFix, rateFix } from './solutions';
export { nameOptions, setName } from './names';
export { checkClaims, markSeen, requestAccess, respondToPoint } from './company';
export { markThreadRead, sendMessage, setOrgSettings, setThreadStatus } from './private';
export { blockThread, operatorClaim, report, resolveReport } from './moderation';
export { setPush } from './push';
export { deleteAccount } from './account';

/** Drafts nobody submitted expire (a day, or a week for a queued complaint); they were never public. */
export const clearDrafts = onSchedule('every day 03:00', async () => {
  const now = Timestamp.now();
  const [expired, legacy] = await Promise.all([
    db.collection('drafts').where('expiresAt', '<', now).limit(500).get(),
    db.collection('drafts').where('createdAt', '<', Timestamp.fromMillis(Date.now() - 7 * 24 * 3600_000)).limit(500).get(),
  ]);
  const batch = db.batch();
  new Map([...expired.docs, ...legacy.docs].map((d) => [d.id, d])).forEach((d) => batch.delete(d.ref));
  await batch.commit();
});
