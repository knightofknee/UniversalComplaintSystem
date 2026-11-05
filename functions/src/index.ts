import { setGlobalOptions } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db, Timestamp } from './common';

setGlobalOptions({ region: 'us-central1', maxInstances: 20 });

export { analyzeComplaint, searchPoints, submitComplaint } from './intake';
export { recountRising, supportPoint, voteFix } from './points';
export { checkClaims, markSeen, requestAccess, respondToPoint } from './company';
export { markThreadRead, sendMessage, setOrgSettings, setThreadStatus } from './private';
export { deleteAccount } from './account';

/** Drafts nobody submitted are deleted after a day; they were never public. */
export const clearDrafts = onSchedule('every day 03:00', async () => {
  const old = await db
    .collection('drafts')
    .where('createdAt', '<', Timestamp.fromMillis(Date.now() - 24 * 3600_000))
    .limit(500)
    .get();
  const batch = db.batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
});
