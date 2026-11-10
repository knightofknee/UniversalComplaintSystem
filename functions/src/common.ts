import { createHash } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldPath, FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

initializeApp();
export const db = getFirestore();

/**
 * Options for every callable. App Check is enforced everywhere: only the
 * real app (reCAPTCHA on web, App Attest on iOS, Play Integrity on
 * Android, or a registered debug token in development) can call in, so a
 * script with the public Firebase config can't run up AI costs. The
 * emulators skip it.
 */
export const CALLABLE = { cors: true, enforceAppCheck: !process.env.FUNCTIONS_EMULATOR } as const;
export const bucket = () => getStorage().bucket();

/**
 * The person who runs UCS. Their account (with this email, verified) gets
 * the operator queue in the app (held organization requests, reports) and
 * the daily "needs you" notification. Mirrored in firestore.rules and
 * src/lib/operator.ts.
 */
export const OPERATOR_EMAIL = 'bricarlis@gmail.com';

export function isOperator(req: CallableRequest): boolean {
  const t = req.auth?.token;
  return !!t && t.email === OPERATOR_EMAIL && t.email_verified === true;
}

export function requireOperator(req: CallableRequest) {
  if (!isOperator(req)) throw new HttpsError('permission-denied', 'Operator only.');
}

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

/**
 * The public, opaque id of a complaint's author: lets people hide one
 * author's complaints (Block) without revealing who they are. The same
 * person always gets the same id; it can't be turned back into an account.
 */
export function authorIdOf(uid: string): string {
  return createHash('sha256').update(`ucs-author:${uid}`).digest('hex').slice(0, 20);
}

export type UserInfo = { displayName: string; responderFor: string[]; termsAcceptedAt: Timestamp | null };

/**
 * users/{uid}, created on first use with a random public display name.
 * Banned accounts (zero tolerance for abuse, set from the operator queue)
 * stop here for everything that writes.
 */
export async function ensureUser(uid: string): Promise<UserInfo> {
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data()!;
    if (d.banned === true) {
      throw new HttpsError('permission-denied', 'This account was suspended for breaking the terms of use.');
    }
    // The account's own public id, so the app can tell which complaints and fixes are its own.
    if (!d.authorId) await ref.update({ authorId: authorIdOf(uid) });
    return { displayName: d.displayName, responderFor: d.responderFor ?? [], termsAcceptedAt: d.termsAcceptedAt ?? null };
  }
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  const displayName = `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`;
  await ref.set({ displayName, authorId: authorIdOf(uid), responderFor: [], createdAt: FieldValue.serverTimestamp() });
  return { displayName, responderFor: [], termsAcceptedAt: null };
}

/**
 * Posting anything (a complaint, a message, a response) needs the terms
 * agreed once. The app shows the agreement before the first post and sends
 * `acceptTerms: true` with it; that is recorded here.
 */
export async function requireTerms(req: CallableRequest, user: UserInfo) {
  if (user.termsAcceptedAt) return;
  if (req.data?.acceptTerms !== true) {
    throw new HttpsError('failed-precondition', 'Agree to the terms of use first.');
  }
  await db.doc(`users/${uidOf(req)}`).set({ termsAcceptedAt: FieldValue.serverTimestamp() }, { merge: true });
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
  report: { max: 30, windowMs: 24 * 3600_000 },
  settings: { max: 60, windowMs: 3600_000 },
  solution: { max: 10, windowMs: 24 * 3600_000 },
  rename: { max: 10, windowMs: 24 * 3600_000 },
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
  report: { max: 100, windowMs: 24 * 3600_000 },
  settings: { max: 200, windowMs: 3600_000 },
  solution: { max: 40, windowMs: 24 * 3600_000 },
  rename: { max: 40, windowMs: 24 * 3600_000 },
};

/** A one-way hash of the caller's address: we never store the address itself. */
function ipKey(req: CallableRequest): string | null {
  // Google's front end APPENDS the connecting address, so only the last
  // entry is trustworthy; anything before it is whatever the client sent.
  const forwarded = req.rawRequest?.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').pop()?.trim() || req.rawRequest?.ip;
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

export type NoticeInput = {
  type: string;
  pointId?: string;
  subjectId?: string;
  threadId?: string;
  draftId?: string;
  text: string;
};

/** Where tapping a notification goes (in the app's notifications and on the phone). */
export function linkFor(n: NoticeInput): string {
  if (n.threadId && n.subjectId) return `/thread/${n.subjectId}/${n.threadId}`;
  if (n.draftId) return `/complain?draft=${n.draftId}`;
  if (n.pointId) return `/point/${n.pointId}`;
  if (n.type === 'operator') return '/operator';
  if (n.subjectId) return `/subject/${n.subjectId}`;
  return '/notifications';
}

/**
 * An in-app notification for each person, and a phone notification for
 * those who turned them on. Push is best effort and never fails the call.
 */
export async function notify(uids: string[], n: NoticeInput) {
  const unique = [...new Set(uids)].filter((u) => !u.includes(':'));
  const link = linkFor(n);
  for (let i = 0; i < unique.length; i += 400) {
    const batch = db.batch();
    for (const uid of unique.slice(i, i + 400)) {
      batch.set(db.collection(`users/${uid}/notifications`).doc(), {
        ...n,
        link,
        read: false,
        at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  await sendPush(unique, n.text, link).catch((e) => console.error('Push failed', e));
}

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

/** Phone notifications through Expo's push service; dead tokens are dropped. */
export async function sendPush(uids: string[], text: string, link: string) {
  if (uids.length === 0) return;
  const messages: { to: string; uid: string; title: string; body: string; sound: string; channelId: string; data: { link: string } }[] = [];
  for (let i = 0; i < uids.length; i += 100) {
    const refs = uids.slice(i, i + 100).map((u) => db.doc(`users/${u}`));
    const snaps = await db.getAll(...refs, { fieldMask: ['pushOn', 'pushTokens'] });
    for (const s of snaps) {
      if (s.get('pushOn') !== true) continue;
      for (const to of Object.keys((s.get('pushTokens') as Record<string, unknown> | undefined) ?? {})) {
        messages.push({
          to,
          uid: s.id,
          title: 'Universal Complaint System',
          body: text.length > 178 ? `${text.slice(0, 177)}…` : text,
          sound: 'default',
          channelId: 'default',
          data: { link },
        });
      }
    }
  }
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(chunk.map(({ uid: _uid, ...m }) => m)),
      signal: AbortSignal.timeout(10_000),
    });
    const tickets = ((await res.json()) as { data?: { status: string; details?: { error?: string } }[] }).data ?? [];
    await Promise.all(
      tickets.map((t, j) =>
        t.status === 'error' && t.details?.error === 'DeviceNotRegistered'
          ? db
              .doc(`users/${chunk[j].uid}`)
              .update(new FieldPath('pushTokens', chunk[j].to), FieldValue.delete())
              .catch(() => {})
          : null,
      ),
    );
  }
}

/** The operator's account, if they've added and verified OPERATOR_EMAIL in the app. */
export async function operatorUid(): Promise<string | null> {
  try {
    const u = await getAuth().getUserByEmail(OPERATOR_EMAIL);
    return u.emailVerified ? u.uid : null;
  } catch {
    return null;
  }
}

/**
 * Tell the operator something needs them. `key` throttles: at most one
 * notice per key per `everyMs` (a burst of reports is one notification).
 */
export async function notifyOperator(text: string, key: string, everyMs = 3600_000) {
  const uid = await operatorUid();
  if (!uid) return;
  const ref = db.doc('config/operatorAlerts');
  const due = await db.runTransaction(async (tx) => {
    const last = ((await tx.get(ref)).get(key) as Timestamp | undefined)?.toMillis() ?? 0;
    if (Date.now() - last < everyMs) return false;
    tx.set(ref, { [key]: Timestamp.now() }, { merge: true });
    return true;
  });
  if (due) await notify([uid], { type: 'operator', text });
}

/** Every real uid supporting a point (imported public-record supports aren't people we can notify). */
export async function supporterUids(pointId: string): Promise<string[]> {
  const snap = await db.collection(`points/${pointId}/supports`).select().get();
  return snap.docs.map((d) => d.id).filter((id) => !id.includes(':'));
}

export function cleanText(v: unknown, max: number, field: string): string {
  if (typeof v !== 'string') throw new HttpsError('invalid-argument', `${field} is missing.`);
  const t = v.trim();
  if (!t) throw new HttpsError('invalid-argument', `${field} is empty.`);
  if (t.length > max) throw new HttpsError('invalid-argument', `${field} is longer than ${max} characters.`);
  return t;
}

/** Delete every doc a query returns, 400 at a time (a batch holds at most 500). */
export async function deleteAll(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export { FieldPath, FieldValue, Timestamp };
