import { createHash } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

initializeApp();
export const db = getFirestore();
export const bucket = () => getStorage().bucket();

export const NAME_ADJECTIVES = [
  'Patient', 'Candid', 'Steady', 'Curious', 'Earnest', 'Honest', 'Plain', 'Bright', 'Frank', 'Keen',
  'Quiet', 'Sturdy', 'Brave', 'Civil', 'Lucid', 'Nimble', 'Sincere', 'Wry', 'Gentle', 'Direct',
];
export const NAME_NOUNS = [
  'Heron', 'Otter', 'Lark', 'Badger', 'Finch', 'Marten', 'Wren', 'Falcon', 'Beaver', 'Plover',
  'Kestrel', 'Lynx', 'Puffin', 'Stoat', 'Tern', 'Ibis', 'Raven', 'Hare', 'Crane', 'Moose',
];

export function uidOf(req: CallableRequest): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Open the app again and try once more.');
  return uid;
}

/** users/{uid}, created on first use with a random public display name. */
export async function ensureUser(uid: string): Promise<{ displayName: string; responderFor: string[] }> {
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data()!;
    return { displayName: d.displayName, responderFor: d.responderFor ?? [] };
  }
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  const displayName = `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`;
  await ref.set({ displayName, responderFor: [], createdAt: FieldValue.serverTimestamp() });
  return { displayName, responderFor: [] };
}

/**
 * Per-account rate limits. Anyone can complain without an account, so these
 * are what keeps one script from flooding the record. A ledger of recent
 * times per bucket lives in rateLimits/{uid} (server only).
 */
export const LIMITS = {
  analyze: { max: 30, windowMs: 24 * 3600_000 },
  submit: { max: 10, windowMs: 24 * 3600_000 },
  search: { max: 400, windowMs: 3600_000 },
  support: { max: 300, windowMs: 24 * 3600_000 },
  respond: { max: 200, windowMs: 24 * 3600_000 },
  claim: { max: 5, windowMs: 24 * 3600_000 },
  message: { max: 100, windowMs: 24 * 3600_000 },
} as const;

/**
 * The same buckets per network address. Anonymous accounts are free to
 * make, so per-account limits alone can be reset by a script; these can't.
 * Set high enough for a shared office or campus connection.
 */
const IP_LIMITS: Record<keyof typeof LIMITS, { max: number; windowMs: number }> = {
  analyze: { max: 80, windowMs: 24 * 3600_000 },
  submit: { max: 40, windowMs: 24 * 3600_000 },
  search: { max: 1500, windowMs: 3600_000 },
  support: { max: 1000, windowMs: 24 * 3600_000 },
  respond: { max: 600, windowMs: 24 * 3600_000 },
  claim: { max: 15, windowMs: 24 * 3600_000 },
  message: { max: 300, windowMs: 24 * 3600_000 },
};

/** A one-way hash of the caller's address: we never store the address itself. */
function ipKey(req: CallableRequest): string | null {
  const forwarded = req.rawRequest?.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || req.rawRequest?.ip;
  if (!ip) return null;
  return `ip_${createHash('sha256').update(`ucs:${ip}`).digest('hex').slice(0, 32)}`;
}

/** Account and network-address limits for one action. */
export async function rateLimit(req: CallableRequest, bucketName: keyof typeof LIMITS) {
  await limitKey(uidOf(req), bucketName, LIMITS[bucketName]);
  const ip = ipKey(req);
  if (ip) await limitKey(ip, bucketName, IP_LIMITS[bucketName]);
}

async function limitKey(key: string, bucketName: string, { max, windowMs }: { max: number; windowMs: number }) {
  const ref = db.doc(`rateLimits/${key}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const times: number[] = ((snap.data()?.[bucketName] as number[] | undefined) ?? []).filter(
      (t) => now - t < windowMs,
    );
    if (times.length >= max) {
      throw new HttpsError('resource-exhausted', 'You have hit the limit for now. Try again later.');
    }
    times.push(now);
    tx.set(ref, { [bucketName]: times }, { merge: true });
  });
}

export async function notify(
  uids: string[],
  n: { type: string; pointId?: string; subjectId?: string; threadId?: string; text: string },
) {
  for (let i = 0; i < uids.length; i += 400) {
    const batch = db.batch();
    for (const uid of uids.slice(i, i + 400)) {
      batch.set(db.collection(`users/${uid}/notifications`).doc(), {
        ...n,
        read: false,
        at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

/** Every uid supporting a point (supports docs are keyed by uid). */
export async function supporterUids(pointId: string): Promise<string[]> {
  const snap = await db.collection(`points/${pointId}/supports`).select().get();
  return snap.docs.map((d) => d.id);
}

export function cleanText(v: unknown, max: number, field: string): string {
  if (typeof v !== 'string') throw new HttpsError('invalid-argument', `${field} is missing.`);
  const t = v.trim();
  if (!t) throw new HttpsError('invalid-argument', `${field} is empty.`);
  if (t.length > max) throw new HttpsError('invalid-argument', `${field} is longer than ${max} characters.`);
  return t;
}

export { FieldValue, Timestamp };
