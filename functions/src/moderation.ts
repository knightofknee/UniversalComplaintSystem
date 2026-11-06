/**
 * Keeping the record safe without letting anyone silence it.
 *
 * - Photos are screened by Cloud Vision SafeSearch before anyone else can
 *   see them (on top of the intake model's own look).
 * - New subject names pass a plain filter (no contact details, links,
 *   handles or profanity) on top of the model's "neutral names" rule.
 * - Anyone can report anything they can see. Reports go to the operator
 *   queue (in the app for the operator, and a notification), never to the
 *   organization, and nothing is hidden automatically: an organization
 *   can't make criticism disappear by reporting it.
 * - The operator removes (logged publicly in `removals`), dismisses, or
 *   suspends the author (zero tolerance for abuse, per the terms).
 * - Either side of a private conversation can block the other.
 */
import { createHash } from 'node:crypto';

import { GoogleAuth } from 'google-auth-library';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { countCall } from './budget';
import {
  CALLABLE,
  cleanText,
  db,
  ensureUser,
  FieldValue,
  notify,
  notifyOperator,
  rateLimit,
  requireOperator,
  uidOf,
} from './common';

// ── Photos ──────────────────────────────────────────────────────────────

const LIKELIHOOD = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
const at = (v: string | undefined) => LIKELIHOOD.indexOf(v ?? 'UNKNOWN');

let auth: GoogleAuth | null = null;

/**
 * SafeSearch on one photo. False for sexual or violent images. If the
 * screening service itself fails, the photo is treated as unsafe: it is
 * left off, never posted unchecked.
 */
export async function photoIsSafe(base64: string): Promise<boolean> {
  try {
    await countCall('vision');
    auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const res = await client.request<{
      responses?: { safeSearchAnnotation?: Record<string, string>; error?: { message: string } }[];
    }>({
      url: 'https://vision.googleapis.com/v1/images:annotate',
      method: 'POST',
      data: { requests: [{ image: { content: base64 }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }] },
      timeout: 15_000,
    });
    const r = res.data.responses?.[0];
    if (!r?.safeSearchAnnotation) {
      console.error('SafeSearch returned nothing', r?.error);
      return false;
    }
    const s = r.safeSearchAnnotation;
    return at(s.adult) < 4 && at(s.violence) < 4 && at(s.racy) < 5;
  } catch (e) {
    console.error('SafeSearch failed', e);
    return false;
  }
}

// ── Subject names ───────────────────────────────────────────────────────

const PROFANITY = /\b(fuck\w*|shit\w*|cunt\w*|bitch\w*|asshole\w*|dick(head)?s?|whores?|sluts?|bastards?|motherf\w*|wank\w*|twats?|pricks?|scum\w*|retard\w*)\b/i;
const CONTACT = /(https?:\/\/|www\.|@\w|\b[\w.+-]+@[\w-]+\.\w|\+?\d[\d\s().-]{7,}\d)/i;

/** Null when the name can be a subject; else why not. */
export function badSubjectName(name: string): string | null {
  const n = name.trim();
  if (n.length < 2 || n.length > 80) return 'length';
  if (CONTACT.test(n)) return 'contact details';
  if (PROFANITY.test(n)) return 'profanity';
  return null;
}

// ── Reports ─────────────────────────────────────────────────────────────

export const REPORT_REASONS = ['abuse', 'private_person', 'personal_data', 'spam', 'illegal', 'other'] as const;
const KINDS = ['point', 'submission', 'response', 'subject', 'message', 'thread'] as const;
type Kind = (typeof KINDS)[number];

const str = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,128}$/.test(v) ? v : '');

/** The document a report is about, and whether this person may see it. */
async function reportTarget(req: CallableRequest, uid: string) {
  const kind = req.data?.kind as Kind;
  if (!KINDS.includes(kind)) throw new HttpsError('invalid-argument', 'Report what?');
  const id = str(req.data?.id);
  const orgId = str(req.data?.orgId);
  const threadId = str(req.data?.threadId);
  const pointId = str(req.data?.pointId);
  let path: string;
  if (kind === 'point') path = `points/${id}`;
  else if (kind === 'submission') path = `submissions/${id}`;
  else if (kind === 'subject') path = `subjects/${id}`;
  else if (kind === 'response') path = `points/${pointId}/responses/${id}`;
  else {
    // Private: only the two sides of the conversation can report in it.
    const thread = await db.doc(`subjects/${orgId}/inbox/${threadId}`).get();
    const responder = await db.doc(`subjects/${orgId}/responders/${uid}`).get();
    if (!thread.exists || (thread.get('uid') !== uid && !responder.exists)) {
      throw new HttpsError('permission-denied', 'You can only report what you can see.');
    }
    path = kind === 'thread' ? thread.ref.path : `${thread.ref.path}/messages/${id}`;
  }
  if (path.includes('//') || path.endsWith('/')) throw new HttpsError('invalid-argument', 'Report what?');
  const snap = await db.doc(path).get();
  if (!snap.exists) throw new HttpsError('not-found', "That's gone already.");
  return { kind, path, snap };
}

/** Who wrote it, where we know (for suspending an abusive account). Never shown to anyone. */
async function authorUidOf(kind: Kind, path: string, snap: FirebaseFirestore.DocumentSnapshot): Promise<string | null> {
  if (kind === 'submission') return ((await db.doc(`authors/${snap.id}`).get()).get('uid') as string) ?? null;
  if (kind === 'response') return ((await db.doc(`authors/r_${snap.id}`).get()).get('uid') as string) ?? null;
  if (kind === 'thread') return (snap.get('uid') as string) ?? null;
  if (kind === 'message') {
    if (snap.get('uid')) return snap.get('uid') as string;
    if (snap.get('from') === 'user') return ((await db.doc(path.split('/messages/')[0]).get()).get('uid') as string) ?? null;
  }
  return null;
}

export const report = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  await ensureUser(uid);
  const reason = REPORT_REASONS.includes(req.data?.reason) ? (req.data.reason as string) : null;
  if (!reason) throw new HttpsError('invalid-argument', 'Pick a reason.');
  const note = req.data?.note ? cleanText(req.data.note, 500, 'Note') : null;
  await rateLimit(req, 'report');
  const { kind, path, snap } = await reportTarget(req, uid);
  // One report per person per item; reporting again just updates it.
  const id = createHash('sha256').update(`${uid}|${path}`).digest('hex').slice(0, 32);
  const ref = db.doc(`reports/${id}`);
  const existing = await ref.get();
  const text = (snap.get('text') ?? snap.get('name') ?? '') as string;
  await ref.set(
    {
      kind,
      path,
      text: String(text).slice(0, 1000),
      context: (snap.get('subjectNames') as string[] | undefined)?.join(' · ') ?? snap.get('subjectName') ?? null,
      reason,
      note,
      reporterUid: uid,
      authorUid: await authorUidOf(kind, path, snap),
      status: 'open',
      createdAt: existing.exists ? existing.get('createdAt') : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await notifyOperator('New reports are waiting for you.', 'reports');
  return { ok: true };
});

/**
 * Takes something off the record (or out of a conversation). Public items
 * are hidden, not deleted, and logged in the public removal log; private
 * messages are blanked. Shared with `npm run remove`.
 */
export async function removeTarget(path: string, reason: string) {
  const ref = db.doc(path);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Not found.');
  const top = path.split('/')[0];
  if (path.includes('/inbox/')) {
    await ref.update({ text: '[Removed by UCS for breaking the terms of use]', removed: true, photos: [] });
    return;
  }
  let kind: string;
  if (path.includes('/responses/')) {
    kind = 'response';
    await ref.update({ text: null, removed: true });
  } else {
    kind = top === 'points' ? 'point' : top === 'submissions' ? 'submission' : 'subject';
    await ref.update({ removed: true });
  }
  await db.collection('removals').add({
    kind,
    subjectNames: (snap.get('subjectNames') as string[] | undefined) ?? [snap.get('subjectName') ?? snap.get('name')].filter(Boolean),
    reason,
    at: FieldValue.serverTimestamp(),
  });
}

/** Operator: act on a report. */
export const resolveReport = onCall(CALLABLE, async (req) => {
  requireOperator(req);
  const ref = db.doc(`reports/${str(req.data?.reportId)}`);
  const r = await ref.get();
  if (!r.exists) throw new HttpsError('not-found', 'No such report.');
  const action = req.data?.action as 'remove' | 'dismiss' | 'suspend';
  const reason = typeof req.data?.reason === 'string' && req.data.reason.trim() ? req.data.reason.trim().slice(0, 300) : null;
  if (action === 'remove' || action === 'suspend') {
    await removeTarget(r.get('path'), reason ?? 'Broke the terms of use.');
  }
  if (action === 'suspend') {
    const author = r.get('authorUid') as string | null;
    if (!author) throw new HttpsError('failed-precondition', "We don't know who wrote this one; it was removed.");
    await suspend(author);
  }
  if (!['remove', 'dismiss', 'suspend'].includes(action)) throw new HttpsError('invalid-argument', 'Unknown action.');
  // Every open report on the same item is settled together.
  const same = await db.collection('reports').where('path', '==', r.get('path')).where('status', '==', 'open').get();
  const batch = db.batch();
  for (const d of same.docs) {
    batch.update(d.ref, { status: action === 'dismiss' ? 'dismissed' : 'actioned', action, decidedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  return { ok: true };
});

/** Zero tolerance: the account can no longer post, message, respond or support. */
export async function suspend(uid: string) {
  const user = await db.doc(`users/${uid}`).get();
  for (const sid of (user.get('responderFor') as string[] | undefined) ?? []) {
    await db.doc(`subjects/${sid}/responders/${uid}`).delete();
  }
  await db.doc(`users/${uid}`).set({ banned: true, responderFor: [], bannedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// ── Blocking in private conversations ───────────────────────────────────

/**
 * Either side of a private conversation can block the other: then nobody
 * can send in it until whoever blocked unblocks. (Hiding an author's public
 * complaints is the reader's own setting: users/{uid}/blocks, written by
 * the app.)
 */
export const blockThread = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const orgId = str(req.data?.orgId);
  const threadId = str(req.data?.threadId);
  const ref = db.doc(`subjects/${orgId}/inbox/${threadId}`);
  const [thread, responder] = await Promise.all([ref.get(), db.doc(`subjects/${orgId}/responders/${uid}`).get()]);
  if (!thread.exists) throw new HttpsError('not-found', 'That conversation is gone.');
  const side = thread.get('uid') === uid ? 'user' : responder.exists ? 'org' : null;
  if (!side) throw new HttpsError('permission-denied', 'This conversation is private.');
  const blockedBy = thread.get('blockedBy') as string | null | undefined;
  if (req.data?.blocked === true) {
    await ref.update({ blockedBy: side });
  } else {
    if (blockedBy && blockedBy !== side) throw new HttpsError('permission-denied', 'Only whoever blocked can unblock.');
    await ref.update({ blockedBy: null });
  }
  return { blockedBy: req.data?.blocked === true ? side : null };
});

// ── Operator: organization access ───────────────────────────────────────

export const operatorClaim = onCall(CALLABLE, async (req) => {
  requireOperator(req);
  const { approveClaim, checkClaim } = await import('./company');
  const claimId = str(req.data?.claimId);
  const ref = db.doc(`claims/${claimId}`);
  const claim = await ref.get();
  if (!claim.exists) throw new HttpsError('not-found', 'No such request.');
  const action = req.data?.action as 'approve' | 'deny' | 'website';
  if (action === 'approve') {
    await approveClaim(claimId, 'Approved by the operator.');
    return { status: 'approved' };
  }
  if (action === 'website') {
    const website = typeof req.data?.website === 'string' ? req.data.website.trim() : '';
    if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/.test(website)) throw new HttpsError('invalid-argument', 'That isn\'t a website.');
    await db.doc(`subjects/${claim.get('subjectId')}`).update({ website, websiteVerified: true });
    return { status: await checkClaim(claimId) };
  }
  if (action === 'deny') {
    const reason =
      (typeof req.data?.reason === 'string' && req.data.reason.trim().slice(0, 300)) ||
      'We could not confirm this email belongs to the organization.';
    await ref.update({ status: 'denied', note: reason, decidedAt: FieldValue.serverTimestamp() });
    await notify([claim.get('uid')], {
      type: 'access',
      subjectId: claim.get('subjectId'),
      text: `Your request to respond for ${claim.get('subjectName')} was not approved: ${reason}`,
    });
    return { status: 'denied' };
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
});
