/**
 * The organization side: getting access with a work email, responding,
 * statuses, and "seen".
 *
 * Access: anyone whose account has a VERIFIED email at an organization's
 * domain can ask to respond for it. If that domain is already known for the
 * organization, access is immediate. Otherwise the claim waits for the daily
 * check (`checkClaims`), which approves only when the email domain matches
 * the organization's website AS VERIFIED BY THE OPERATOR
 * (`subjects/{id}.websiteVerified`, set from the operator queue in the app or
 * `npm run review-claims -- website`). Never the website the claimant typed,
 * and never one the model guessed: either would let anyone claim any
 * organization with a domain they own. Everything else is held for the
 * operator, who gets a daily notification while anything waits.
 *
 * Restricted control: an organization can ask us to set
 * `restricted/{subjectId}.emails` (server only) to a list of addresses; then
 * only those can respond, and their responses read "Official response".
 *
 * When an organization joins (its first approved responder), everyone whose
 * private complaint was held for it is told it can now read them.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { dailyBudget, today } from './budget';
import {
  CALLABLE,
  cleanText,
  db,
  deleteAll,
  ensureUser,
  FieldValue,
  notify,
  notifyOperator,
  rateLimit,
  requireTerms,
  Timestamp,
  uidOf,
} from './common';
import { notifyPointFollowers, type OrgStatus } from './points';
import { responderUids } from './private';

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de',
  'mail.com', 'yandex.com', 'zoho.com', 'fastmail.com', 'hey.com', 'qq.com', '163.com', 'web.de',
]);

export const STATUSES = ['acknowledged', 'planned', 'fix_claimed', 'wont_fix'] as const;
const STATUS_TEXT: Record<(typeof STATUSES)[number], string> = {
  acknowledged: 'acknowledged',
  planned: 'plans to fix',
  fix_claimed: 'says it fixed',
  wont_fix: "won't fix",
};

function domainOf(email: string) {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/** Is this email domain the same organization as this website host? */
export function domainMatchesHost(domain: string, host: string) {
  const h = host.toLowerCase().replace(/^www\./, '');
  return h === domain || h.endsWith(`.${domain}`) || domain.endsWith(`.${h}`);
}

/** The addresses an organization limited responding to, or null (server only). */
async function restrictedTo(subjectId: string): Promise<string[] | null> {
  const r = await db.doc(`restricted/${subjectId}`).get();
  return (r.get('emails') as string[] | undefined) ?? null;
}

export async function approveClaim(claimId: string, note: string) {
  const claim = await db.doc(`claims/${claimId}`).get();
  const { uid, email, subjectId } = claim.data() as { uid: string; email: string; subjectId: string };
  const subject = await db.doc(`subjects/${subjectId}`).get();
  const official = !!(await restrictedTo(subjectId))?.includes(email);
  const joining = subject.get('claimed') !== true;
  const batch = db.batch();
  batch.update(subject.ref, {
    domains: FieldValue.arrayUnion(domainOf(email)),
    claimed: true,
    // An organization that joins has a public page, even if only private
    // complaints had reached it so far.
    ...(subject.get('pendingPublic') === true ? { removed: false, pendingPublic: false } : {}),
  });
  batch.set(db.doc(`subjects/${subjectId}/responders/${uid}`), {
    email,
    official,
    addedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`users/${uid}`), { responderFor: FieldValue.arrayUnion(subjectId) }, { merge: true });
  batch.update(claim.ref, { status: 'approved', note, decidedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  await notify([uid], {
    type: 'access',
    subjectId,
    text: `You can now respond for ${subject.get('name')}.`,
  });
  if (joining) await announceJoin(subjectId, subject.get('name') as string);
}

/** Private complaints were held for this organization; tell their authors it's here now. */
async function announceJoin(subjectId: string, name: string) {
  const held = await db.collection(`subjects/${subjectId}/inbox`).get();
  if (held.empty) return;
  for (const t of held.docs) {
    await notify([t.get('uid') as string], {
      type: 'thread',
      subjectId,
      threadId: t.id,
      text: `${name} joined UCS and can now read your private complaint and reply.`,
    });
  }
  await notify(await responderUids(subjectId), {
    type: 'access',
    subjectId,
    text: `${held.size} private complaint${held.size === 1 ? ' was' : 's were'} waiting for ${name}. Open your private inbox.`,
  });
}

export const requestAccess = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const token = req.auth!.token;
  if (!token.email || !token.email_verified) {
    throw new HttpsError('failed-precondition', 'Verify your work email first.');
  }
  const email = token.email.toLowerCase();
  const domain = domainOf(email);
  if (FREE_MAIL.has(domain)) {
    throw new HttpsError('failed-precondition', `${domain} is a personal email service. Use your work email.`);
  }
  await rateLimit(req, 'claim');
  const user = await ensureUser(uid);
  await requireTerms(req, user);
  const subjectId = typeof req.data?.subjectId === 'string' ? req.data.subjectId : '';
  const subject = await db.doc(`subjects/${subjectId}`).get();
  if (!subject.exists || subject.get('kind') !== 'organization') {
    throw new HttpsError('not-found', 'Pick an organization.');
  }
  if (user.responderFor.includes(subjectId)) return { status: 'approved' };
  const limited = await restrictedTo(subjectId);
  if (limited && !limited.includes(email)) {
    throw new HttpsError(
      'permission-denied',
      `${subject.get('name')} has limited who can respond for it. Ask your team to add ${email}.`,
    );
  }
  // Only a hint for the operator; it never approves anything.
  const suggestedWebsite = typeof req.data?.website === 'string' ? req.data.website.trim().slice(0, 300) : null;
  const ref = db.collection('claims').doc();
  await ref.set({
    uid,
    email,
    domain,
    subjectId,
    subjectName: subject.get('name'),
    suggestedWebsite,
    status: 'pending',
    note: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  if ((subject.get('domains') as string[]).includes(domain)) {
    await approveClaim(ref.id, `${domain} was already verified for this organization.`);
    return { status: 'approved' };
  }
  return { status: 'pending' };
});

/** One claim against the organization's operator-verified website. */
export async function checkClaim(claimId: string): Promise<'approved' | 'held'> {
  const ref = db.doc(`claims/${claimId}`);
  const { domain, subjectId } = (await ref.get()).data() as { domain: string; subjectId: string };
  const subject = await db.doc(`subjects/${subjectId}`).get();
  const hold = async (note: string) => {
    await ref.update({ status: 'held', note, checkedAt: FieldValue.serverTimestamp() });
    return 'held' as const;
  };
  const website = subject.get('websiteVerified') === true ? (subject.get('website') as string | null) : null;
  if (!website) return hold("Needs a person to check: this organization's website hasn't been verified yet.");
  let host: string;
  try {
    host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
  } catch {
    return hold(`The verified website "${website}" is not a valid address.`);
  }
  if (!domainMatchesHost(domain, host)) return hold(`${domain} does not match ${host}.`);
  await approveClaim(claimId, `Email domain matches the verified website ${host}.`);
  return 'approved';
}

/**
 * Daily: every pending claim is checked against its organization's verified
 * website, then the operator gets one notification if anything needs them
 * (held requests, open reports, complaints queued past the AI budget).
 */
export const checkClaims = onSchedule({ schedule: 'every day 06:00', timeZone: 'America/Chicago' }, async () => {
  const pending = await db.collection('claims').where('status', '==', 'pending').get();
  for (const d of pending.docs) await checkClaim(d.id);
  await operatorDigest();
});

export async function operatorDigest() {
  const [held, reports, queued, usage, budget] = await Promise.all([
    db.collection('claims').where('status', '==', 'held').count().get(),
    db.collection('reports').where('status', '==', 'open').count().get(),
    db.collection('queue').where('status', '==', 'waiting').count().get(),
    db.doc(`usage/${new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10)}`).get(),
    dailyBudget(),
  ]);
  const n = { held: held.data().count, reports: reports.data().count, queued: queued.data().count };
  const parts = [
    n.held && `${n.held} organization request${n.held === 1 ? '' : 's'} to check`,
    n.reports && `${n.reports} open report${n.reports === 1 ? '' : 's'}`,
    n.queued && `${n.queued} complaint${n.queued === 1 ? '' : 's'} queued for the AI budget`,
  ].filter(Boolean);
  if (parts.length === 0) return;
  const spent = (usage.get('costUsd') as number | undefined) ?? 0;
  await notifyOperator(
    `Needs you: ${parts.join(', ')}. Yesterday's AI spend: $${spent.toFixed(2)} of $${budget}.`,
    `digest-${today()}`,
    0,
  );
}

async function responderFor(uid: string, pointId: string, subjectId: string) {
  const [point, responder] = await Promise.all([
    db.doc(`points/${pointId}`).get(),
    db.doc(`subjects/${subjectId}/responders/${uid}`).get(),
  ]);
  if (!point.exists) throw new HttpsError('not-found', 'That problem is gone.');
  if (!responder.exists || !(point.get('subjectIds') as string[]).includes(subjectId)) {
    throw new HttpsError('permission-denied', 'You don\'t respond for an organization on this problem.');
  }
  return { point, responder };
}

/** A responder opened the point: the organization has now seen it. */
export const markSeen = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const pointId = String(req.data?.pointId ?? '');
  const subjectId = String(req.data?.subjectId ?? '');
  const { point } = await responderFor(uid, pointId, subjectId);
  if (point.get(`seenBy.${subjectId}`)) return { seen: true };
  await point.ref.update({ [`seenBy.${subjectId}`]: FieldValue.serverTimestamp() });
  await db.doc(`subjects/${subjectId}`).update({ 'stats.seen': FieldValue.increment(1) });
  return { seen: true };
});

export const respondToPoint = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const pointId = String(req.data?.pointId ?? '');
  const subjectId = String(req.data?.subjectId ?? '');
  const status = req.data?.status as (typeof STATUSES)[number] | null | undefined;
  if (status && !STATUSES.includes(status)) throw new HttpsError('invalid-argument', 'Unknown status.');
  const text = req.data?.text ? cleanText(req.data.text, 4000, 'Response') : null;
  if (!text && !status) throw new HttpsError('invalid-argument', 'Write a response or pick a status.');
  const user = await ensureUser(uid);
  await requireTerms(req, user);
  await rateLimit(req, 'respond');
  const { point, responder } = await responderFor(uid, pointId, subjectId);
  const subject = await db.doc(`subjects/${subjectId}`).get();
  const email = responder.get('email') as string;

  const firstResponse = !point.get(`respondedBy.${subjectId}`);
  const response = await point.ref.collection('responses').add({
    subjectId,
    subjectName: subject.get('name'),
    domain: domainOf(email),
    official: responder.get('official') === true,
    text,
    status: status ?? null,
    removed: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  // Who wrote it stays server-side (for suspending an abusive account).
  await db.doc(`authors/r_${response.id}`).set({ uid });
  const update: Record<string, unknown> = {
    [`respondedBy.${subjectId}`]: FieldValue.serverTimestamp(),
    // Kept from the first response only: how long people waited (the dashboard's response time).
    ...(firstResponse ? { [`firstRespondedBy.${subjectId}`]: FieldValue.serverTimestamp() } : {}),
    lastActivityAt: FieldValue.serverTimestamp(),
  };
  if (!point.get(`seenBy.${subjectId}`)) update[`seenBy.${subjectId}`] = FieldValue.serverTimestamp();
  // Status is this organization's own: it never changes another's.
  const prev = point.get(`orgStatus.${subjectId}`) as OrgStatus | undefined;
  if (status) {
    const now = Timestamp.now();
    update[`orgStatus.${subjectId}`] =
      status === 'fix_claimed'
        ? { status, at: now, fixClaimedAt: now, yes: 0, no: 0 }
        : { status, at: now, yes: prev?.yes ?? 0, no: prev?.no ?? 0 };
    update.status = status;
    update.statusBy = subjectId;
  }
  await point.ref.update(update);
  const stats: Record<string, FieldValue> = {};
  if (firstResponse) stats['stats.responded'] = FieldValue.increment(1);
  if (!point.get(`seenBy.${subjectId}`)) stats['stats.seen'] = FieldValue.increment(1);
  if (status && prev?.status === 'fixed') stats['stats.fixed'] = FieldValue.increment(-1);
  if (Object.keys(stats).length) await subject.ref.update(stats);
  if (status === 'fix_claimed') {
    // Old confirmations were about an earlier fix.
    const votes = await point.ref.collection('fixVotes').where('orgId', '==', subjectId).get();
    await deleteAll(votes.docs);
  }

  await notifyPointFollowers(pointId, {
    type: status ? 'status' : 'response',
    text: status
      ? `${subject.get('name')} ${STATUS_TEXT[status]}: "${point.get('text')}"${
          status === 'fix_claimed' ? ' Is it actually fixed? Tell us.' : ''
        }`
      : `${subject.get('name')} responded: "${point.get('text')}"`,
  });
  return { ok: true };
});
