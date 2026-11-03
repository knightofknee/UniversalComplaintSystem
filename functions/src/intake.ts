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
  kind?: 'topic',
): Promise<Neighbor<T>[]> {
  let q = store.collection(collection).where('removed', '==', false);
  if (kind) q = q.where('kind', '==', kind);
  const snap = await q
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
type SubjectDoc = { kind: string; name: string; description: string; category?: string };
type ResolvedSubject = { id: string; name: string; kind: string; category: string | null };

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
    const [points, nearSubjects, nearTopics, photos, hint] = await Promise.all([
      nearest<PointDoc>(db, 'points', vector, 15),
      nearest<SubjectDoc>(db, 'subjects', vector, 10),
      // Topics get their own search so existing ones are reused, not re-invented.
      nearest<SubjectDoc>(db, 'subjects', vector, 10, 'topic'),
      Promise.all(photoPaths.map((p) => readPhoto(uid, p))),
      hintId ? db.doc(`subjects/${hintId}`).get() : null,
    ]);
    const subjects = [...nearSubjects, ...nearTopics.filter((t) => !nearSubjects.some((s) => s.id === t.id))];
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
      p.subjectIndexes = [...new Set(p.subjectIndexes.filter((i) => i >= 0 && i < result.subjects.length))];
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
        const c = subjects.find((x) => x.id === s.existingId) ?? { ...hint!.data(), id: hint!.id } as SubjectDoc & { id: string };
        return { id: c.id, name: c.name, kind: c.kind, category: c.category ?? null, isNew: false };
      }
      const n = s.newSubject!;
      return { id: null, name: n.name, kind: n.kind, category: n.category, isNew: true };
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

async function resolveSubject(s: IntakeResult['subjects'][number]): Promise<ResolvedSubject> {
  if (s.existingId) return existingSubject(s.existingId);
  const ns = s.newSubject!;
  const name = ns.name.trim().slice(0, 120);
  const existing = await db
    .collection('subjects')
    .where('nameLower', '==', name.toLowerCase())
    .limit(1)
    .get();
  if (!existing.empty) return existingSubject(existing.docs[0].id);
  const [vector] = await embed([`${name}: ${ns.description}`]);
  const ref = db.collection('subjects').doc();
  await ref.set({
    kind: ns.kind,
    name,
    nameLower: name.toLowerCase(),
    description: ns.description.slice(0, 300),
    website: ns.website,
    category: ns.category,
    domains: [],
    restrictedTo: null,
    claimed: false,
    createdBy: 'model',
    stats: { points: 0, seen: 0, responded: 0, fixed: 0, supporters: 0 },
    removed: false,
    embedding: AdminFieldValue.vector(vector),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, name, kind: ns.kind, category: ns.category };
}

async function existingSubject(id: string): Promise<ResolvedSubject> {
  const snap = await db.doc(`subjects/${id}`).get();
  if (!snap.exists || snap.get('removed')) throw new HttpsError('not-found', 'One of the subjects is gone.');
  return { id, name: snap.get('name'), kind: snap.get('kind'), category: snap.get('category') ?? null };
}

/** The denormalized filing fields every point carries for browsing. */
function filing(subjects: ResolvedSubject[]) {
  return {
    subjectIds: subjects.map((s) => s.id),
    subjectNames: subjects.map((s) => s.name),
    topicIds: subjects.filter((s) => s.kind === 'topic').map((s) => s.id),
    categories: [...new Set(subjects.flatMap((s) => (s.category ? [s.category] : [])))],
  };
}

/** Supporter totals on subjects drive "biggest topics". */
async function addSupporters(subjectIds: string[], n: number) {
  if (n === 0) return;
  await Promise.all(
    subjectIds.map((id) => db.doc(`subjects/${id}`).update({ 'stats.supporters': FieldValue.increment(n) })),
  );
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

  // The author's corrections to "Filed under": tags the model picked that they
  // removed, and existing subjects they added (which apply to every point).
  const removed = new Set<number>(
    Array.isArray(req.data?.removeSubjects) ? req.data.removeSubjects.filter(Number.isInteger) : [],
  );
  const addIds: string[] = Array.isArray(req.data?.addSubjectIds)
    ? [...new Set<string>(req.data.addSubjectIds.filter((x: unknown) => typeof x === 'string'))].slice(0, 5)
    : [];

  const { displayName, responderFor } = await ensureUser(uid);
  const resolved = await Promise.all(
    result.subjects.map((s, i) => (removed.has(i) ? null : resolveSubject(s))),
  );
  const added = await Promise.all(addIds.map(existingSubject));
  const allSubjects = [...resolved.filter((s): s is ResolvedSubject => !!s), ...added];
  const unique = (list: ResolvedSubject[]) => list.filter((s, i) => list.findIndex((x) => x.id === s.id) === i);
  if (allSubjects.length === 0) throw new HttpsError('invalid-argument', 'File it under at least one thing.');
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
    let pointSubjects = unique([
      ...p.subjectIndexes.flatMap((i) => (resolved[i] ? [resolved[i]] : [])),
      ...added,
    ]);
    if (pointSubjects.length === 0) pointSubjects = unique(allSubjects);
    if (p.matchedPointId) {
      const ref = db.doc(`points/${p.matchedPointId}`);
      const pointSnap = await ref.get();
      if (!pointSnap.exists || pointSnap.get('removed')) continue;
      const current = pointSnap.get('subjectIds') as string[];
      if (current.some((s) => responderFor.includes(s))) continue;
      matchedPointIds.push(ref.id);
      const newSupporter = await db
        .doc(`points/${ref.id}/supports/${uid}`)
        .create({ at: FieldValue.serverTimestamp(), via: 'submission', submissionId: submission.id })
        .then(() => true)
        .catch(() => false);
      const subCount = (pointSnap.get('submissionCount') as number) + 1;
      const rantCount = (pointSnap.get('rantCount') as number) + (isRant ? 1 : 0);
      const supportCount = (pointSnap.get('supportCount') as number) + (newSupporter ? 1 : 0);
      const update: Record<string, unknown> = {
        submissionCount: FieldValue.increment(1),
        rantCount: FieldValue.increment(isRant ? 1 : 0),
        hot: rantCount / subCount >= RANT_SHARE,
        lastActivityAt: FieldValue.serverTimestamp(),
        ...(newSupporter
          ? { supportCount: FieldValue.increment(1), weekSupport: FieldValue.increment(1) }
          : {}),
      };
      // The clearest wording leads the point, credited to its author.
      if (p.actionability > (pointSnap.get('canonical.actionability') as number)) {
        update.text = p.statement;
        update.canonical = { submissionId: submission.id, authorName: displayName, actionability: p.actionability };
      }
      // A new subject (another airline with the same problem) joins the point.
      // Tags only ever get added to an existing point: one author can't
      // re-file what others already filed.
      const extra = pointSubjects.filter((s) => !current.includes(s.id));
      if (extra.length) {
        const f = filing(extra);
        update.subjectIds = FieldValue.arrayUnion(...f.subjectIds);
        update.subjectNames = FieldValue.arrayUnion(...f.subjectNames);
        if (f.topicIds.length) update.topicIds = FieldValue.arrayUnion(...f.topicIds);
        if (f.categories.length) update.categories = FieldValue.arrayUnion(...f.categories);
        for (const s of extra) {
          await db.doc(`subjects/${s.id}`).update({ 'stats.points': FieldValue.increment(1) });
        }
        await addSupporters(f.subjectIds, supportCount);
      }
      if (newSupporter) await addSupporters(current, 1);
      await ref.update(update);
    } else {
      const ref = db.collection('points').doc();
      addedPointIds.push(ref.id);
      await ref.set({
        text: p.statement,
        ...filing(pointSubjects),
        supportCount: 1,
        weekSupport: 1,
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
      await addSupporters(pointSubjects.map((s) => s.id), 1);
    }
  }

  await submission.set({
    authorName: displayName,
    text: finalText,
    language: result.language,
    englishText: result.language.startsWith('en') ? null : useRewrite ? null : result.englishText,
    rewritten: useRewrite,
    subjectIds: allSubjects.map((s) => s.id),
    subjectNames: allSubjects.map((s) => s.name),
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
