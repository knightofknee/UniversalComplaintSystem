/**
 * Complaint intake: search while typing, analyze a draft, submit it.
 *
 * A submission is never posted until its author has seen what the model did
 * with it: which existing points it matched, which points are new, and any
 * personal data or rewrite suggestions. Only `submitComplaint` writes to the
 * public record.
 */
import { FieldValue as AdminFieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { ANTHROPIC_API_KEY, embed, runIntake, type IntakeResult } from './ai';
import { bucket, cleanText, db, ensureUser, FieldValue, rateLimit, uidOf } from './common';

const MAX_TEXT = 4000;
const MAX_PHOTOS = 4;
const RANT_SHARE = 0.5;

type Neighbor<T> = T & { id: string; distance: number };

async function nearest<T>(
  store: Firestore,
  collection: 'points' | 'subjects',
  vector: number[],
  limit: number,
): Promise<Neighbor<T>[]> {
  const snap = await store
    .collection(collection)
    .where('removed', '==', false)
    .findNearest({
      vectorField: 'embedding',
      queryVector: AdminFieldValue.vector(vector),
      limit,
      distanceMeasure: 'COSINE',
      distanceResultField: 'distance',
    })
    .get();
  return snap.docs.map((d) => {
    const { embedding: _embedding, ...rest } = d.data();
    return { ...(rest as T), id: d.id, distance: d.get('distance') as number };
  });
}

type PointDoc = {
  text: string;
  subjectIds: string[];
  subjectNames: string[];
  supportCount: number;
  status: string;
};
type SubjectDoc = { kind: string; name: string; description: string };

/** Live "is this what you mean?" while someone types, or the search box. */
export const searchPoints = onCall({ cors: true }, async (req) => {
  const uid = uidOf(req);
  const query = cleanText(req.data?.query, 1000, 'Search');
  await rateLimit(uid, 'search');
  const [vector] = await embed([query]);
  const [points, subjects] = await Promise.all([
    nearest<PointDoc>(db, 'points', vector, 10),
    nearest<SubjectDoc>(db, 'subjects', vector, 5),
  ]);
  // Cosine distance: 0 is identical. Past ~0.45 results stop being related.
  return {
    points: points.filter((p) => p.distance < 0.45).map(publicPoint),
    subjects: subjects
      .filter((s) => s.distance < 0.4)
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind, description: s.description })),
  };
});

function publicPoint(p: Neighbor<PointDoc>) {
  return {
    id: p.id,
    text: p.text,
    subjectNames: p.subjectNames,
    supportCount: p.supportCount,
    status: p.status,
  };
}

async function readPhoto(uid: string, path: unknown) {
  if (typeof path !== 'string' || !path.startsWith(`uploads/${uid}/`) || path.includes('..')) {
    throw new HttpsError('invalid-argument', 'Bad photo.');
  }
  const file = bucket().file(path);
  const [meta] = await file.getMetadata();
  const type = meta.contentType;
  if (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp') {
    throw new HttpsError('invalid-argument', 'Photos must be JPEG, PNG or WebP.');
  }
  const [bytes] = await file.download();
  return { path, mediaType: type, base64: bytes.toString('base64') } as const;
}

/** Step 1: the model reads the draft. Nothing public is written. */
export const analyzeComplaint = onCall(
  { cors: true, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const uid = uidOf(req);
    const text = cleanText(req.data?.text, MAX_TEXT, 'Your complaint');
    if (text.length < 8) throw new HttpsError('invalid-argument', 'Say a little more.');
    const photoPaths: unknown[] = Array.isArray(req.data?.photoPaths) ? req.data.photoPaths : [];
    if (photoPaths.length > MAX_PHOTOS) throw new HttpsError('invalid-argument', `At most ${MAX_PHOTOS} photos.`);
    const hintId = typeof req.data?.subjectId === 'string' ? req.data.subjectId : null;
    await rateLimit(uid, 'analyze');

    const [vector] = await embed([text]);
    const [points, subjects, photos, hint] = await Promise.all([
      nearest<PointDoc>(db, 'points', vector, 15),
      nearest<SubjectDoc>(db, 'subjects', vector, 10),
      Promise.all(photoPaths.map((p) => readPhoto(uid, p))),
      hintId ? db.doc(`subjects/${hintId}`).get() : null,
    ]);
    const candidateSubjects = subjects.map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      description: s.description,
    }));
    if (hint?.exists && !candidateSubjects.some((s) => s.id === hint.id)) {
      const h = hint.data() as SubjectDoc;
      candidateSubjects.unshift({ id: hint.id, kind: h.kind, name: h.name, description: h.description });
    }
    const result = await runIntake({
      text: hint?.exists ? `(Written on the page for ${hint.get('name')})\n${text}` : text,
      candidateSubjects,
      candidatePoints: points.map((p) => ({
        id: p.id,
        text: p.text,
        subjects: p.subjectNames,
        supportCount: p.supportCount,
      })),
      photos,
    });

    // The model may only point at candidates it was shown.
    const subjectIds = new Set(candidateSubjects.map((s) => s.id));
    const pointIds = new Set(points.map((p) => p.id));
    result.subjects = result.subjects.filter(
      (s) => (s.existingId && subjectIds.has(s.existingId)) || (!s.existingId && s.newSubject),
    );
    for (const p of result.points) {
      if (p.matchedPointId && !pointIds.has(p.matchedPointId)) p.matchedPointId = null;
      p.subjectIndexes = p.subjectIndexes.filter((i) => i >= 0 && i < result.subjects.length);
      if (p.subjectIndexes.length === 0 && result.subjects.length > 0) p.subjectIndexes = [0];
    }

    const draft = db.collection('drafts').doc();
    await draft.set({
      uid,
      text,
      photoPaths: photos.map((p) => p.path),
      result,
      createdAt: FieldValue.serverTimestamp(),
    });

    const byId = new Map(points.map((p) => [p.id, p]));
    const subjectInfo = (s: IntakeResult['subjects'][number]) => {
      if (s.existingId) {
        const c = candidateSubjects.find((x) => x.id === s.existingId)!;
        return { id: c.id, name: c.name, kind: c.kind, isNew: false };
      }
      return { id: null, name: s.newSubject!.name, kind: s.newSubject!.kind, isNew: true };
    };
    return {
      draftId: draft.id,
      result,
      subjects: result.subjects.map(subjectInfo),
      matched: Object.fromEntries(
        result.points
          .filter((p) => p.matchedPointId)
          .map((p) => [p.matchedPointId!, publicPoint(byId.get(p.matchedPointId!)!)]),
      ),
    };
  },
);

async function resolveSubject(s: IntakeResult['subjects'][number]): Promise<{ id: string; name: string }> {
  if (s.existingId) {
    const snap = await db.doc(`subjects/${s.existingId}`).get();
    return { id: snap.id, name: snap.get('name') };
  }
  const ns = s.newSubject!;
  const name = ns.name.trim().slice(0, 120);
  const existing = await db
    .collection('subjects')
    .where('nameLower', '==', name.toLowerCase())
    .limit(1)
    .get();
  if (!existing.empty) return { id: existing.docs[0].id, name: existing.docs[0].get('name') };
  const [vector] = await embed([`${name}: ${ns.description}`]);
  const ref = db.collection('subjects').doc();
  await ref.set({
    kind: ns.kind,
    name,
    nameLower: name.toLowerCase(),
    description: ns.description.slice(0, 300),
    website: ns.website,
    domains: [],
    restrictedTo: null,
    claimed: false,
    createdBy: 'model',
    stats: { points: 0, seen: 0, responded: 0, fixed: 0 },
    removed: false,
    embedding: AdminFieldValue.vector(vector),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, name };
}

/**
 * Step 2: the author confirms. Matched points gain a supporter; new points
 * are created; the author's words are kept as the submission.
 */
export const submitComplaint = onCall({ cors: true, timeoutSeconds: 120 }, async (req) => {
  const uid = uidOf(req);
  const draftId = typeof req.data?.draftId === 'string' ? req.data.draftId : '';
  const draftSnap = draftId ? await db.doc(`drafts/${draftId}`).get() : null;
  if (!draftSnap?.exists || draftSnap.get('uid') !== uid) {
    throw new HttpsError('not-found', 'That draft has expired. Check your complaint again.');
  }
  await rateLimit(uid, 'submit');
  const { text, photoPaths, result } = draftSnap.data() as {
    text: string;
    photoPaths: string[];
    result: IntakeResult;
  };
  if (!result.isComplaint) throw new HttpsError('failed-precondition', 'There is nothing to record in this one.');

  const useRewrite = req.data?.useRewrite === true && !!result.suggestedRewrite;
  const removePII = req.data?.removePII !== false && !!result.pii.redactedText;
  const keep: number[] = Array.isArray(req.data?.keepPoints)
    ? req.data.keepPoints.filter((i: unknown) => Number.isInteger(i))
    : result.points.map((_, i) => i);
  const finalText = useRewrite ? result.suggestedRewrite! : removePII ? result.pii.redactedText! : text;
  const kept = result.points.filter((_, i) => keep.includes(i));
  if (kept.length === 0) throw new HttpsError('invalid-argument', 'Keep at least one point.');

  const { displayName, responderFor } = await ensureUser(uid);
  const subjects = await Promise.all(result.subjects.map(resolveSubject));
  const submission = db.collection('submissions').doc();
  const isRant = result.tone === 'rant';

  // Photos the model passed (and that show no personal data) become public.
  const photos: string[] = [];
  for (const p of result.photos) {
    const src = photoPaths[p.index];
    if (!src || !p.ok || p.containsPersonalData) continue;
    const dest = `public/${submission.id}/${photos.length}.jpg`;
    await bucket().file(src).copy(bucket().file(dest));
    photos.push(dest);
  }

  const newStatements = kept.filter((p) => !p.matchedPointId).map((p) => p.statement);
  const vectors = await embed(newStatements);
  const matchedPointIds: string[] = [];
  const addedPointIds: string[] = [];

  for (const p of kept) {
    const pointSubjects = p.subjectIndexes.map((i) => subjects[i]).filter(Boolean);
    if (p.matchedPointId) {
      const ref = db.doc(`points/${p.matchedPointId}`);
      const pointSnap = await ref.get();
      if (!pointSnap.exists || pointSnap.get('removed')) continue;
      if ((pointSnap.get('subjectIds') as string[]).some((s) => responderFor.includes(s))) continue;
      matchedPointIds.push(ref.id);
      const newSupporter = await db
        .doc(`points/${ref.id}/supports/${uid}`)
        .create({ at: FieldValue.serverTimestamp(), via: 'submission', submissionId: submission.id })
        .then(() => true)
        .catch(() => false);
      const subCount = (pointSnap.get('submissionCount') as number) + 1;
      const rantCount = (pointSnap.get('rantCount') as number) + (isRant ? 1 : 0);
      const update: Record<string, unknown> = {
        submissionCount: FieldValue.increment(1),
        rantCount: FieldValue.increment(isRant ? 1 : 0),
        hot: rantCount / subCount >= RANT_SHARE,
        lastActivityAt: FieldValue.serverTimestamp(),
        ...(newSupporter ? { supportCount: FieldValue.increment(1) } : {}),
      };
      // The clearest wording leads the point, credited to its author.
      if (p.actionability > (pointSnap.get('canonical.actionability') as number)) {
        update.text = p.statement;
        update.canonical = { submissionId: submission.id, authorName: displayName, actionability: p.actionability };
      }
      // A new subject (another airline with the same problem) joins the point.
      const extra = pointSubjects.filter((s) => !(pointSnap.get('subjectIds') as string[]).includes(s.id));
      if (extra.length) {
        update.subjectIds = FieldValue.arrayUnion(...extra.map((s) => s.id));
        update.subjectNames = FieldValue.arrayUnion(...extra.map((s) => s.name));
        for (const s of extra) {
          await db.doc(`subjects/${s.id}`).update({ 'stats.points': FieldValue.increment(1) });
        }
      }
      await ref.update(update);
    } else {
      const ref = db.collection('points').doc();
      addedPointIds.push(ref.id);
      await ref.set({
        text: p.statement,
        subjectIds: pointSubjects.map((s) => s.id),
        subjectNames: pointSubjects.map((s) => s.name),
        supportCount: 1,
        submissionCount: 1,
        rantCount: isRant ? 1 : 0,
        hot: isRant,
        status: 'open',
        statusNote: null,
        seenBy: {},
        respondedBy: {},
        fixClaimedBy: null,
        fixVotes: { yes: 0, no: 0 },
        canonical: { submissionId: submission.id, authorName: displayName, actionability: p.actionability },
        addedBy: 'model',
        firstSubmissionId: submission.id,
        photo: photos[0] ?? null,
        removed: false,
        embedding: AdminFieldValue.vector(vectors[newStatements.indexOf(p.statement)]),
        createdAt: FieldValue.serverTimestamp(),
        lastActivityAt: FieldValue.serverTimestamp(),
      });
      await ref.collection('supports').doc(uid).set({
        at: FieldValue.serverTimestamp(),
        via: 'submission',
        submissionId: submission.id,
      });
      for (const s of pointSubjects) {
        await db.doc(`subjects/${s.id}`).update({ 'stats.points': FieldValue.increment(1) });
      }
    }
  }

  await submission.set({
    authorName: displayName,
    text: finalText,
    language: result.language,
    englishText: result.language.startsWith('en') ? null : useRewrite ? null : result.englishText,
    rewritten: useRewrite,
    subjectIds: subjects.map((s) => s.id),
    subjectNames: subjects.map((s) => s.name),
    matchedPointIds,
    addedPointIds,
    tone: result.tone,
    actionability: result.actionability,
    photos,
    removed: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`users/${uid}/mine/${submission.id}`).set({ at: FieldValue.serverTimestamp() });
  await draftSnap.ref.delete();
  return { submissionId: submission.id, matchedPointIds, addedPointIds };
});
