/**
 * Private complaints: sent to one organization, readable only by that
 * organization's verified responders and the author.
 *
 * A private complaint is also a conversation (a support thread) with the
 * organization, so it keeps what a support case needs (order numbers,
 * account emails, addresses); only what nobody should ever send (card
 * numbers, ID numbers, passwords) is removed.
 *
 * What it's about still counts, privately: each point it raises adds to the
 * organization's private count for that point (`privatePoints`), which only
 * the organization sees. Nothing public moves: not support counts, not
 * rising, not topic totals, not the organization's stats. A point raised only
 * privately becomes public the moment someone says it publicly
 * (`promotePrivatePoint`), starting from its public count alone. People
 * writing publicly are told, yes or no, when something was also raised
 * privately - never how many times.
 *
 * An organization can choose to publish its private COUNTS
 * (`subjects/{id}.publishPrivate`): public points then show them, and private
 * complainers can confirm fixes. Private TEXT is never published.
 */
import { FieldValue as AdminFieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { embed, type IntakeResult } from './ai';
import { CALLABLE, bucket, cleanText, db, ensureUser, FieldValue, notify, rateLimit, requireTerms, uidOf } from './common';
import { existingSubject, resolveSubject } from './intake';

export async function responderUids(orgId: string): Promise<string[]> {
  const snap = await db.collection(`subjects/${orgId}/responders`).select().get();
  return snap.docs.map((d) => d.id);
}

/** Everyone following a public point privately, across organizations. */
export async function privateFollowerUids(pointId: string): Promise<string[]> {
  const holders = await db.collectionGroup('privatePoints').where('pointId', '==', pointId).get();
  const lists = await Promise.all(holders.docs.map((d) => d.ref.collection('followers').select().get()));
  return [...new Set(lists.flatMap((l) => l.docs.map((d) => d.id)))];
}

/** Card numbers and US social security numbers in free-text messages (no model reads those). */
export function stripSensitive(text: string): string {
  return text
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => (luhn(m.replace(/\D/g, '')) ? '[removed]' : m))
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[removed]');
}

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export async function submitPrivate(
  req: CallableRequest,
  draft: {
    draftRef: DocumentReference;
    text: string;
    photoPaths: string[];
    result: IntakeResult;
    vectors?: Record<string, number[]>;
    privateMatches?: (string | null)[];
    displayName: string;
  },
) {
  const uid = uidOf(req);
  const token = req.auth!.token;
  if (token.firebase?.sign_in_provider === 'anonymous' || !token.email || !token.email_verified) {
    throw new HttpsError(
      'failed-precondition',
      'Add and verify your email to send privately: the organization needs a way to reach you.',
    );
  }
  const { result } = draft;
  const target = Number.isInteger(req.data?.privateTo) ? result.subjects[req.data.privateTo] : undefined;
  if (!target) throw new HttpsError('invalid-argument', 'Pick who to send it to.');
  // A brand-new organization is created hidden: a private complaint never
  // makes a public page appear.
  const org = await resolveSubject(target, { hidden: true });
  if (org.kind !== 'organization') {
    throw new HttpsError('invalid-argument', 'Only organizations can receive private complaints.');
  }
  const keep: number[] = Array.isArray(req.data?.keepPoints)
    ? req.data.keepPoints.filter((i: unknown) => Number.isInteger(i))
    : result.points.map((_, i) => i);
  const keptIdx = result.points.map((_, i) => i).filter((i) => keep.includes(i));
  if (keptIdx.length === 0) throw new HttpsError('invalid-argument', 'Keep at least one issue.');
  const useRewrite = req.data?.useRewrite === true && !!result.suggestedRewrite;
  const finalText = useRewrite ? result.suggestedRewrite! : (result.pii.sensitiveRemovedText ?? draft.text);

  // Topics that already exist (and are public) label the private points; a
  // private complaint never creates anything public, so new topics are skipped.
  const topicIdByIndex = new Map<number, string>();
  await Promise.all(
    result.subjects.map(async (s, i) => {
      if (!s.existingId) return;
      const t = await existingSubject(s.existingId).catch(() => null);
      if (t?.kind === 'topic') topicIdByIndex.set(i, t.id);
    }),
  );

  const orgRef = db.doc(`subjects/${org.id}`);
  const orgSnap = await orgRef.get();
  const publishes = orgSnap.get('publishPrivate') === true;
  const thread = orgRef.collection('inbox').doc();

  const photos: string[] = [];
  for (const p of result.photos) {
    const src = draft.photoPaths[p.index];
    if (!src || !p.ok) continue;
    const dest = `private/${org.id}/${uid}/${thread.id}/${photos.length}.jpg`;
    await bucket().file(src).copy(bucket().file(dest));
    photos.push(dest);
  }

  // Where each point lands in the organization's private counts. Points
  // raised only privately were matched by vector distance (never by the
  // model), so no one else's private words were read next to this one.
  const ownPrefix = `subjects/${org.id}/privatePoints/`;
  const plans = await Promise.all(
    keptIdx.map(async (i) => {
      const p = result.points[i];
      const m = p.matchedPointId;
      if (m) {
        const existing = await orgRef.collection('privatePoints').where('pointId', '==', m).limit(1).get();
        if (!existing.empty) return { i, p, ref: existing.docs[0].ref, publicId: m, create: null };
        const pub = await db.doc(`points/${m}`).get();
        if (pub.exists) {
          return { i, p, ref: orgRef.collection('privatePoints').doc(), publicId: m, create: 'linked' as const, text: pub.get('text') as string };
        }
      }
      const priv = draft.privateMatches?.[i];
      if (priv?.startsWith(ownPrefix)) return { i, p, ref: db.doc(priv), publicId: null, create: null };
      return { i, p, ref: null, publicId: null, create: 'private' as const };
    }),
  );
  const needVectors = plans.filter((x) => x.create === 'private' && !draft.vectors?.[String(x.i)]);
  const fresh = await embed(needVectors.map((x) => x.p.statement));
  const vectorOf = (i: number) => draft.vectors?.[String(i)] ?? fresh[needVectors.findIndex((x) => x.i === i)];

  const threadPoints: { privatePointId: string; pointId: string | null; statement: string }[] = [];
  for (const plan of plans) {
    const topicIds = plan.p.subjectIndexes.flatMap((i) => (topicIdByIndex.has(i) ? [topicIdByIndex.get(i)!] : []));
    let ref = plan.ref;
    if (plan.create) {
      ref ??= orgRef.collection('privatePoints').doc();
      const isPrivateOnly = plan.create === 'private';
      await ref.set({
        orgId: org.id,
        pointId: plan.publicId,
        isPrivateOnly,
        text: isPrivateOnly ? plan.p.statement : (plan as { text?: string }).text ?? plan.p.statement,
        topicIds,
        count: 0,
        createdAt: FieldValue.serverTimestamp(),
        ...(isPrivateOnly ? { embedding: AdminFieldValue.vector(vectorOf(plan.i)) } : {}),
      });
    }
    await ref!.update({ count: FieldValue.increment(1), lastAt: FieldValue.serverTimestamp() });
    await ref!.collection('followers').doc(uid).set({ uid, threadId: thread.id, at: FieldValue.serverTimestamp() });
    if (plan.publicId && publishes) {
      await db.doc(`points/${plan.publicId}`).update({ [`privateCounts.${org.id}`]: FieldValue.increment(1) });
    }
    threadPoints.push({ privatePointId: ref!.id, pointId: plan.publicId, statement: plan.p.statement });
  }

  await thread.set({
    uid,
    email: token.email,
    authorName: draft.displayName,
    orgName: org.name,
    text: finalText,
    language: result.language,
    englishText: result.language.startsWith('en') || useRewrite ? null : result.englishText,
    photos,
    points: threadPoints,
    status: 'open',
    blockedBy: null,
    createdAt: FieldValue.serverTimestamp(),
    lastMessageAt: FieldValue.serverTimestamp(),
    lastFrom: 'user',
    unreadByOrg: true,
    unreadByUser: false,
  });
  await db.doc(`users/${uid}/threads/${thread.id}`).set({
    orgId: org.id,
    orgName: org.name,
    preview: finalText.slice(0, 160),
    status: 'open',
    lastMessageAt: FieldValue.serverTimestamp(),
    unread: false,
  });
  await notify(await responderUids(org.id), {
    type: 'thread',
    subjectId: org.id,
    threadId: thread.id,
    text: `New private complaint: "${finalText.slice(0, 100)}"`,
  });
  await draft.draftRef.delete();
  return {
    visibility: 'private' as const,
    threadId: thread.id,
    orgId: org.id,
    orgName: org.name,
    claimed: orgSnap.get('claimed') === true,
    website: (orgSnap.get('website') as string | null) ?? null,
    pointCount: threadPoints.length,
  };
}

/** Someone said publicly what was only raised privately: link the two. */
export async function promotePrivatePoint(path: string, pointId: string) {
  const ref = db.doc(path);
  const snap = await ref.get();
  if (!snap.exists || !snap.get('isPrivateOnly')) return;
  await ref.update({ pointId, isPrivateOnly: false, embedding: FieldValue.delete() });
  const orgId = snap.get('orgId') as string;
  const org = await db.doc(`subjects/${orgId}`).get();
  if (org.get('publishPrivate') === true) {
    await db.doc(`points/${pointId}`).update({ [`privateCounts.${orgId}`]: snap.get('count') });
  }
}

async function threadAccess(uid: string, orgId: string, threadId: string) {
  const ref = db.doc(`subjects/${orgId}/inbox/${threadId}`);
  const [thread, responder] = await Promise.all([ref.get(), db.doc(`subjects/${orgId}/responders/${uid}`).get()]);
  if (!thread.exists) throw new HttpsError('not-found', 'That conversation is gone.');
  const owner = thread.get('uid') === uid;
  if (!owner && !responder.exists) throw new HttpsError('permission-denied', 'This conversation is private.');
  return { ref, thread, owner, responder };
}

function ids(req: CallableRequest) {
  const orgId = typeof req.data?.orgId === 'string' ? req.data.orgId : '';
  const threadId = typeof req.data?.threadId === 'string' ? req.data.threadId : '';
  if (!orgId || !threadId) throw new HttpsError('invalid-argument', 'Which conversation?');
  return { orgId, threadId };
}

export const sendMessage = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const { orgId, threadId } = ids(req);
  const text = stripSensitive(cleanText(req.data?.text, 4000, 'Message'));
  const user = await ensureUser(uid);
  await requireTerms(req, user);
  await rateLimit(req, 'message');
  const { ref, thread, owner, responder } = await threadAccess(uid, orgId, threadId);
  if (thread.get('blockedBy')) {
    throw new HttpsError(
      'failed-precondition',
      thread.get('blockedBy') === (owner ? 'user' : 'org') ? 'You blocked this conversation. Unblock it to send.' : 'This conversation was blocked.',
    );
  }
  const org = await db.doc(`subjects/${orgId}`).get();
  const orgName = (org.get('name') as string | undefined) ?? (thread.get('orgName') as string);
  const fromOrg = !owner;
  await ref.collection('messages').add({
    from: fromOrg ? 'org' : 'user',
    uid,
    text,
    ...(fromOrg ? { domain: (responder.get('email') as string).split('@')[1] } : { authorName: thread.get('authorName') }),
    at: FieldValue.serverTimestamp(),
  });
  await ref.update({
    lastMessageAt: FieldValue.serverTimestamp(),
    lastFrom: fromOrg ? 'org' : 'user',
    ...(fromOrg ? { unreadByUser: true } : { unreadByOrg: true }),
    ...(thread.get('status') === 'resolved' && !fromOrg ? { status: 'open' } : {}),
  });
  await db.doc(`users/${thread.get('uid')}/threads/${threadId}`).update({
    preview: text.slice(0, 160),
    lastMessageAt: FieldValue.serverTimestamp(),
    ...(fromOrg ? { unread: true } : {}),
    ...(thread.get('status') === 'resolved' && !fromOrg ? { status: 'open' } : {}),
  });
  if (fromOrg) {
    await notify([thread.get('uid')], {
      type: 'thread',
      subjectId: orgId,
      threadId,
      text: `${orgName} replied to your private complaint.`,
    });
  } else {
    await notify(await responderUids(orgId), {
      type: 'thread',
      subjectId: orgId,
      threadId,
      text: `New reply on a private complaint: "${text.slice(0, 100)}"`,
    });
  }
  return { ok: true };
});

export const setThreadStatus = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const { orgId, threadId } = ids(req);
  const status = req.data?.status === 'resolved' ? 'resolved' : 'open';
  const { ref, thread } = await threadAccess(uid, orgId, threadId);
  await ref.update({ status });
  await db.doc(`users/${thread.get('uid')}/threads/${threadId}`).update({ status });
  return { status };
});

export const markThreadRead = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const { orgId, threadId } = ids(req);
  const { ref, owner } = await threadAccess(uid, orgId, threadId);
  if (owner) {
    await ref.update({ unreadByUser: false });
    await db.doc(`users/${uid}/threads/${threadId}`).update({ unread: false });
  } else {
    await ref.update({ unreadByOrg: false });
  }
  return { ok: true };
});

/**
 * Advanced: an organization can publish its private counts. Public points
 * then show "+N private" and private complainers can confirm fixes. The
 * text of private complaints is never published.
 */
export const setOrgSettings = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const subjectId = typeof req.data?.subjectId === 'string' ? req.data.subjectId : '';
  await rateLimit(req, 'settings');
  const responder = await db.doc(`subjects/${subjectId}/responders/${uid}`).get();
  if (!responder.exists) throw new HttpsError('permission-denied', 'Only people who respond for it can change this.');
  const publish = req.data?.publishPrivate === true;
  await db.doc(`subjects/${subjectId}`).update({ publishPrivate: publish });
  const linked = await db.collection(`subjects/${subjectId}/privatePoints`).where('isPrivateOnly', '==', false).get();
  for (let i = 0; i < linked.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of linked.docs.slice(i, i + 400)) {
      batch.update(db.doc(`points/${d.get('pointId')}`), {
        [`privateCounts.${subjectId}`]: publish ? d.get('count') : FieldValue.delete(),
      });
    }
    await batch.commit();
  }
  return { publishPrivate: publish };
});
