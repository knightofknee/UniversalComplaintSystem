/**
 * Complaint intake: search while typing, analyze a draft, submit it.
 *
 * A submission is never posted until its author has seen what the model did
 * with it: which existing points it matched, which points are new, and any
 * personal data or rewrite suggestions. Only `submitComplaint` writes to the
 * public record.
 *
 * Never lost: when the day's AI budget is used up, a complaint is queued
 * (`queue`) and checked as soon as there's room (`processQueue`); its author
 * is notified to review and post it.
 *
 * Private text never reaches the model next to anyone else's words: points
 * raised only privately are matched by vector distance alone, after the
 * model has run.
 */
import { FieldValue as AdminFieldValue, type Firestore } from 'firebase-admin/firestore';

type VectorValue = { toArray(): number[] };
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { ANTHROPIC_API_KEY, embed, runIntake, type IntakeResult } from './ai';
import { BudgetPaused, budgetLeft } from './budget';
import {
  authorIdOf,
  CALLABLE,
  bucket,
  cleanText,
  db,
  ensureUser,
  FieldValue,
  notify,
  rateLimit,
  requireTerms,
  Timestamp,
  uidOf,
} from './common';
import { badSubjectName, photoIsSafe } from './moderation';
import { promotePrivatePoint, submitPrivate } from './private';
import { flagDuplicates } from './duplicates';
import { announceJoin } from './points';
import { rantRank } from './rants';
import { joinSaid, writeStatements } from './statements';

const MAX_TEXT = 4000;
const MAX_PHOTOS = 4;
const RANT_SHARE = 0.5;
const WEEK_MS = 7 * 24 * 3600_000;
/** Cosine distance under which a new point is the same as one raised only privately. */
const PRIVATE_MATCH_DISTANCE = 0.2;
/** A new wording replaces a point's headline only if it says the same thing... */
const HEADLINE_MAX_DISTANCE = 0.15;
/** ...and is clearly more actionable. */
const HEADLINE_MIN_GAIN = 10;
/** Filing caps per point, so one author can't scatter a point everywhere. */
const MAX_ORGS = 4;
const MAX_TOPICS = 3;
const MAX_SUBJECTS_PER_POINT = 8;

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
export type ResolvedSubject = { id: string; name: string; kind: string; category: string | null };

/** The closest point raised only privately (never shown; used for matching and a yes/no hint). */
async function nearestPrivateOnly(vector: number[]) {
  const snap = await db
    .collectionGroup('privatePoints')
    .where('isPrivateOnly', '==', true)
    .findNearest({
      vectorField: 'embedding',
      queryVector: AdminFieldValue.vector(vector),
      limit: 1,
      distanceMeasure: 'COSINE',
      distanceResultField: 'distance',
    })
    .get();
  const d = snap.docs[0];
  return d ? { path: d.ref.path, distance: d.get('distance') as number } : null;
}

/** Does any organization hold private complaints on this public point? */
async function raisedPrivately(pointId: string) {
  const snap = await db.collectionGroup('privatePoints').where('pointId', '==', pointId).limit(1).get();
  return !snap.empty;
}

function cosineDistance(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Live "is this what you mean?" while someone types, or the search box. */
export const searchPoints = onCall(CALLABLE, async (req) => {
  uidOf(req);
  const query = cleanText(req.data?.query, 1000, 'Search');
  await rateLimit(req, 'search');
  const [vector] = await embed([query], 'search');
  const [points, subjects, privateOnly] = await Promise.all([
    nearest<PointDoc>(db, 'points', vector, 10),
    nearest<SubjectDoc>(db, 'subjects', vector, 5),
    nearestPrivateOnly(vector),
  ]);
  // Cosine distance: 0 is identical. Past ~0.45 results stop being related.
  const close = points.filter((p) => p.distance < 0.45);
  return {
    // The distance lets the complaint box show only close matches ("Sounds familiar").
    points: close.map((p) => ({ ...publicPoint(p), distance: Math.round(p.distance * 1000) / 1000 })),
    // Private complaints are never shown or counted publicly, but someone
    // about to say the same thing is told they aren't the first.
    raisedPrivately: (privateOnly?.distance ?? 1) < 0.3,
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
  if (
    typeof path !== 'string' ||
    !(path.startsWith(`uploads/${uid}/`) || path.startsWith(`queued/${uid}/`)) ||
    path.includes('..')
  ) {
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

/** Junk ("aaaaaaaa", "!!!!!!!!") never reaches the model. */
function assertNotJunk(text: string) {
  if (text.length < 8 || new Set(text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).size < 5) {
    throw new HttpsError('invalid-argument', 'Say a little more.');
  }
}

/**
 * The model reads a complaint next to its nearest public points and
 * subjects; the result is checked against what it was shown, private-only
 * points are matched by vector, and everything is saved as a private draft.
 * Nothing public is written. Used by `analyzeComplaint`, the queue, and the
 * public-record import.
 */
export async function analyzeText(input: {
  uid: string;
  text: string;
  photoPaths: string[];
  hintId: string | null;
  queued?: boolean;
}) {
  const { uid, text } = input;
  const [vector] = await embed([text]);
  const [points, nearSubjects, nearTopics, photos, hint] = await Promise.all([
    nearest<PointDoc>(db, 'points', vector, 15),
    nearest<SubjectDoc>(db, 'subjects', vector, 10),
    // Topics get their own search so existing ones are reused, not re-invented.
    nearest<SubjectDoc>(db, 'subjects', vector, 10, 'topic'),
    Promise.all(input.photoPaths.map((p) => readPhoto(uid, p))),
    input.hintId ? db.doc(`subjects/${input.hintId}`).get() : null,
  ]);
  // Unsafe photos never reach the model, let alone the record.
  const safe = await Promise.all(photos.map((p) => photoIsSafe(p.base64)));
  const shownPhotos = photos.flatMap((p, i) => (safe[i] ? [{ ...p, original: i }] : []));

  const subjects = [...nearSubjects, ...nearTopics.filter((t) => !nearSubjects.some((s) => s.id === t.id))];
  const candidateSubjects = subjects.map((s) => ({ id: s.id, kind: s.kind, name: s.name, description: s.description }));
  const hintOk = !!hint?.exists && hint.get('removed') === false;
  if (hintOk && !candidateSubjects.some((s) => s.id === hint!.id)) {
    const h = hint!.data() as SubjectDoc;
    candidateSubjects.unshift({ id: hint!.id, kind: h.kind, name: h.name, description: h.description });
  }
  const result = await runIntake({
    text: hintOk ? `(Written on the page for ${hint!.get('name')})\n${text}` : text,
    candidateSubjects,
    candidatePoints: points.map((p) => ({ id: p.id, text: p.text, subjects: p.subjectNames, supportCount: p.supportCount })),
    photos: shownPhotos,
  });

  // The model may only point at candidates it was shown, and new subject
  // names must pass the filter. Indexes are remapped after dropping any.
  const subjectIds = new Set(candidateSubjects.map((s) => s.id));
  const pointIds = new Set(points.map((p) => p.id));
  const keepSubject = result.subjects.map(
    (s) =>
      (!!s.existingId && subjectIds.has(s.existingId)) ||
      (!s.existingId && !!s.newSubject && !badSubjectName(s.newSubject.name)),
  );
  const newIndex = new Map<number, number>();
  result.subjects = result.subjects.filter((_, i) => {
    if (!keepSubject[i]) return false;
    newIndex.set(i, newIndex.size);
    return true;
  });
  const kindOf = (i: number) => {
    const s = result.subjects[i];
    return s.existingId ? candidateSubjects.find((c) => c.id === s.existingId)!.kind : s.newSubject!.kind;
  };
  for (const p of result.points) {
    if (p.matchedPointId && !pointIds.has(p.matchedPointId)) p.matchedPointId = null;
    const mapped = [...new Set(p.subjectIndexes.flatMap((i) => (newIndex.has(i) ? [newIndex.get(i)!] : [])))];
    const orgs = mapped.filter((i) => kindOf(i) === 'organization').slice(0, MAX_ORGS);
    const topics = mapped.filter((i) => kindOf(i) === 'topic').slice(0, MAX_TOPICS);
    p.subjectIndexes = [...orgs, ...topics];
    if (p.subjectIndexes.length === 0 && result.subjects.length > 0) p.subjectIndexes = [0];
  }
  // Photo verdicts, back in the author's order; screened-out photos are never ok.
  result.photos = photos.map((_, original) => {
    const shown = shownPhotos.findIndex((s) => s.original === original);
    const v = shown >= 0 ? result.photos.find((x) => x.index === shown) : null;
    return { index: original, ok: !!v?.ok, containsPersonalData: v?.containsPersonalData ?? false };
  });

  // New points: their vectors (kept for submitting) and any private-only match.
  const newIdx = result.points.flatMap((p, i) => (p.matchedPointId ? [] : [i]));
  const vectors = await embed(newIdx.map((i) => result.points[i].statement));
  const vectorByPoint: Record<string, number[]> = {};
  const privateMatches: (string | null)[] = result.points.map(() => null);
  await Promise.all(
    newIdx.map(async (i, j) => {
      vectorByPoint[String(i)] = vectors[j];
      const m = await nearestPrivateOnly(vectors[j]);
      if (m && m.distance < PRIVATE_MATCH_DISTANCE) privateMatches[i] = m.path;
    }),
  );
  // Per point: has anyone raised it privately? A yes/no only, never a count.
  const alsoPrivate = await Promise.all(
    result.points.map((p, i) => (p.matchedPointId ? raisedPrivately(p.matchedPointId) : privateMatches[i] !== null)),
  );

  const byId = new Map(points.map((p) => [p.id, p]));
  const subjectInfo = (s: IntakeResult['subjects'][number]) => {
    if (s.existingId) {
      const c = subjects.find((x) => x.id === s.existingId) ?? ({ ...hint!.data(), id: hint!.id } as SubjectDoc & { id: string });
      return { id: c.id, name: c.name, kind: c.kind, category: c.category ?? null, isNew: false };
    }
    const n = s.newSubject!;
    return { id: null, name: n.name, kind: n.kind, category: n.category, isNew: true };
  };
  const response = {
    result,
    subjects: result.subjects.map(subjectInfo),
    alsoPrivate,
    matched: Object.fromEntries(
      result.points
        .filter((p) => p.matchedPointId && byId.has(p.matchedPointId))
        .map((p) => [p.matchedPointId!, publicPoint(byId.get(p.matchedPointId!)!)]),
    ),
  };
  const draft = db.collection('drafts').doc();
  await draft.set({
    uid,
    text,
    photoPaths: photos.map((p) => p.path),
    result,
    vectors: vectorByPoint,
    privateMatches,
    response,
    queued: !!input.queued,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + (input.queued ? 7 : 1) * 24 * 3600_000),
  });
  return { draftId: draft.id, ...response };
}

/** Step 1: the model reads the draft. Nothing public is written. */
export const analyzeComplaint = onCall(
  { ...CALLABLE, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const uid = uidOf(req);
    await ensureUser(uid);
    const text = cleanText(req.data?.text, MAX_TEXT, 'Your complaint');
    assertNotJunk(text);
    const photoPaths: unknown[] = Array.isArray(req.data?.photoPaths) ? req.data.photoPaths : [];
    if (photoPaths.length > MAX_PHOTOS) throw new HttpsError('invalid-argument', `At most ${MAX_PHOTOS} photos.`);
    if (photoPaths.some((p) => typeof p !== 'string' || !p.startsWith(`uploads/${uid}/`) || p.includes('..'))) {
      throw new HttpsError('invalid-argument', 'Bad photo.');
    }
    const hintId = typeof req.data?.subjectId === 'string' ? req.data.subjectId : null;
    await rateLimit(req, 'analyze');
    const input = { uid, text, photoPaths: photoPaths as string[], hintId };
    if (!(await budgetLeft())) return queueComplaint(input);
    try {
      return { queued: false, ...(await analyzeText(input)) };
    } catch (e) {
      if (e instanceof BudgetPaused) return queueComplaint(input);
      throw e;
    }
  },
);

/** Out of budget for today: keep it (photos too) and check it when there's room. */
async function queueComplaint(input: { uid: string; text: string; photoPaths: string[]; hintId: string | null }) {
  const ref = db.collection('queue').doc();
  const kept: string[] = [];
  for (const [i, p] of input.photoPaths.entries()) {
    // uploads/ expire after a day; the queue can take longer.
    const dest = `queued/${input.uid}/${ref.id}-${i}.jpg`;
    await bucket().file(p).copy(bucket().file(dest));
    kept.push(dest);
  }
  await ref.set({
    uid: input.uid,
    text: input.text,
    photoPaths: kept,
    hintId: input.hintId,
    status: 'waiting',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { queued: true as const, queueId: ref.id };
}

/** Hourly: queued complaints are checked, oldest first, while there's budget. */
export const processQueue = onSchedule(
  { schedule: 'every 60 minutes', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const waiting = await db.collection('queue').where('status', '==', 'waiting').orderBy('createdAt').limit(25).get();
    for (const q of waiting.docs) {
      if (!(await budgetLeft())) return;
      const { uid, text, photoPaths, hintId } = q.data() as { uid: string; text: string; photoPaths: string[]; hintId: string | null };
      try {
        const { draftId } = await analyzeText({ uid, text, photoPaths, hintId, queued: true });
        await q.ref.update({ status: 'ready', draftId, checkedAt: FieldValue.serverTimestamp() });
        await notify([uid], {
          type: 'draft',
          draftId,
          text: `Your complaint has been checked: "${text.slice(0, 80)}". Review it and post it.`,
        });
      } catch (e) {
        if (e instanceof BudgetPaused) return;
        await q.ref.update({ status: 'failed', error: (e as Error).message ?? 'failed' });
        await notify([uid], {
          type: 'draft',
          text: `We couldn't check your complaint "${text.slice(0, 80)}". Open Complain to try again.`,
        });
      }
    }
  },
);

/** A saved draft (a queued complaint that's been checked), for its author to review. */
export const getDraft = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  const draftId = typeof req.data?.draftId === 'string' ? req.data.draftId : '';
  const snap = draftId ? await db.doc(`drafts/${draftId}`).get() : null;
  if (!snap?.exists || snap.get('uid') !== uid) {
    throw new HttpsError('not-found', 'That draft has expired. Write it again and we\'ll check it.');
  }
  return { draftId: snap.id, text: snap.get('text') as string, ...(snap.get('response') as object) };
});

/**
 * A subject by id. Hidden subjects (made by a private complaint, so nothing
 * public exists yet) are found only when the caller allows it; a public
 * complaint about one makes it public.
 */
export async function existingSubject(id: string, opts: { allowHidden?: boolean; publish?: boolean } = {}): Promise<ResolvedSubject> {
  const snap = await db.doc(`subjects/${id}`).get();
  const hidden = snap.get('pendingPublic') === true;
  if (!snap.exists || (snap.get('removed') && !(hidden && (opts.allowHidden || opts.publish)))) {
    throw new HttpsError('not-found', 'One of the subjects is gone.');
  }
  if (hidden && opts.publish) await snap.ref.update({ removed: false, pendingPublic: false });
  return { id, name: snap.get('name'), kind: snap.get('kind'), category: snap.get('category') ?? null };
}

/**
 * The subject a model's tag stands for, creating it if it's new. A private
 * complaint creates it hidden (`hidden`), so no public page appears until
 * someone complains about it publicly.
 */
export async function resolveSubject(s: IntakeResult['subjects'][number], opts: { hidden?: boolean } = {}): Promise<ResolvedSubject> {
  if (s.existingId) return existingSubject(s.existingId, opts.hidden ? { allowHidden: true } : { publish: true });
  const ns = s.newSubject!;
  const name = ns.name.trim().slice(0, 120);
  if (badSubjectName(name)) throw new HttpsError('invalid-argument', 'One of the subject names isn\'t allowed.');
  const existing = await db.collection('subjects').where('nameLower', '==', name.toLowerCase()).limit(1).get();
  if (!existing.empty) {
    return existingSubject(existing.docs[0].id, opts.hidden ? { allowHidden: true } : { publish: true });
  }
  const [vector] = await embed([`${name}: ${ns.description}`]);
  const ref = db.collection('subjects').doc();
  await ref.set({
    kind: ns.kind,
    name,
    nameLower: name.toLowerCase(),
    description: ns.description.slice(0, 300),
    website: ns.website,
    websiteVerified: false,
    category: ns.category,
    domains: [],
    claimed: false,
    createdBy: 'model',
    stats: { points: 0, seen: 0, responded: 0, fixed: 0, supporters: 0 },
    removed: !!opts.hidden,
    pendingPublic: !!opts.hidden,
    embedding: AdminFieldValue.vector(vector),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, name, kind: ns.kind, category: ns.category };
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

/** At most MAX_ORGS organizations and MAX_TOPICS topics, organizations first. */
function capFiling(list: ResolvedSubject[]) {
  const unique = list.filter((s, i) => list.findIndex((x) => x.id === s.id) === i);
  return [
    ...unique.filter((s) => s.kind === 'organization').slice(0, MAX_ORGS),
    ...unique.filter((s) => s.kind === 'topic').slice(0, MAX_TOPICS),
  ];
}

/** Supporter totals on subjects drive "biggest topics". */
async function addSupporters(subjectIds: string[], n: number) {
  if (n === 0) return;
  await Promise.all(
    subjectIds.map((id) => db.doc(`subjects/${id}`).update({ 'stats.supporters': FieldValue.increment(n) })),
  );
}

/**
 * On a re-read, a statement this close to one of the complaint's own points
 * is that point said again (measured: the same complaint reworded sits at
 * 0.07-0.15, unrelated ones at 0.19 and up; a version with a make and model
 * added lands a little further out than a plain rewording).
 */
const REREAD_SAME_POINT = 0.25;

/** What marks the detail being added in the text the model re-reads (so its cleaned-up copy can be picked back out). */
const ADDING = 'Added now: ';

/**
 * The model reads a posted complaint again, with a detail its author is
 * adding ("Dell XPS 13 9310" on a complaint about "my laptop"). A complaint
 * that is now more specific should be filed and worded that way:
 *
 * - the detail itself is checked like the complaint was: refused if it
 *   crosses the line, and personal data is taken out of it;
 * - the points this complaint raised gain the subjects the model now sees
 *   (the maker, the product). Tags are only ever added;
 * - a point that is this complaint's alone is reworded freely. A point other
 *   people share changes its headline only under the usual rule: same
 *   meaning, clearly more actionable;
 * - what is still missing is worked out afresh.
 *
 * It never moves support between points and never creates a new point: the
 * candidates the model is shown are this complaint's own points, and a
 * statement it writes fresh is folded into the closest of them.
 */
export async function rereadWithDetail(args: { displayName: string; submissionId: string; detail: string }) {
  const { submissionId, displayName } = args;
  const subRef = db.doc(`submissions/${submissionId}`);
  const sub = await subRef.get();
  if (!sub.exists || sub.get('removed')) throw new HttpsError('not-found', 'That complaint is gone.');
  const earlier = (sub.get('details') as string[] | undefined) ?? [];
  const text = [sub.get('text') as string, ...earlier.map((d) => `Added later: ${d}`), `${ADDING}${args.detail}`].join('\n');

  const ownIds = [
    ...new Set([
      ...((sub.get('addedPointIds') as string[] | undefined) ?? []),
      ...((sub.get('matchedPointIds') as string[] | undefined) ?? []),
    ]),
  ];
  const [vector] = await embed([text]);
  const [nearSubjects, nearTopics, pointSnaps, currentSubjects] = await Promise.all([
    nearest<SubjectDoc>(db, 'subjects', vector, 10),
    nearest<SubjectDoc>(db, 'subjects', vector, 10, 'topic'),
    Promise.all(ownIds.map((id) => db.doc(`points/${id}`).get())),
    Promise.all(((sub.get('subjectIds') as string[]) ?? []).map((id) => db.doc(`subjects/${id}`).get())),
  ]);
  const points = pointSnaps.filter((p) => p.exists && !p.get('removed'));
  const candidateSubjects = new Map<string, { id: string; kind: string; name: string; description: string }>();
  for (const c of currentSubjects) {
    if (c.exists && !c.get('removed')) {
      candidateSubjects.set(c.id, { id: c.id, kind: c.get('kind'), name: c.get('name'), description: c.get('description') ?? '' });
    }
  }
  for (const n of [...nearSubjects, ...nearTopics]) {
    if (!candidateSubjects.has(n.id)) candidateSubjects.set(n.id, { id: n.id, kind: n.kind, name: n.name, description: n.description });
  }

  const result = await runIntake({
    text,
    candidateSubjects: [...candidateSubjects.values()],
    candidatePoints: points.map((p) => ({
      id: p.id,
      text: p.get('text') as string,
      subjects: p.get('subjectNames') as string[],
      supportCount: p.get('supportCount') as number,
    })),
    photos: [],
  });
  if (result.safety?.unsafe) {
    throw new HttpsError('failed-precondition', result.safety.reason ?? 'That breaks the terms of use and can\'t be added.');
  }
  if ((result.spice ?? 1) >= 5) {
    throw new HttpsError('failed-precondition', result.spiceReason ?? 'Leave the name-calling out and add it again.');
  }
  // The detail as the model cleaned it: personal data out, the rest untouched.
  const cleaned = (result.pii.redactedText ?? result.pii.sensitiveRemovedText ?? '').split(ADDING)[1]?.trim();
  const detail = cleaned && cleaned.length <= 200 ? cleaned : args.detail;

  // Subjects the model may use: ones it was shown, or new ones with a clean name.
  const usable = (i: number) => {
    const t = result.subjects[i];
    if (!t) return false;
    return t.existingId ? candidateSubjects.has(t.existingId) : !!t.newSubject && !badSubjectName(t.newSubject.name);
  };
  const resolved = new Map<number, ResolvedSubject>();
  const subjectAt = async (i: number) => {
    if (!resolved.has(i)) resolved.set(i, await resolveSubject(result.subjects[i]));
    return resolved.get(i)!;
  };

  // Which of this complaint's points each statement belongs to. The model
  // matches a point it recognizes and then, as it does at intake, writes the
  // now more specific version as a separate "new angle" statement. Here that
  // is the same complaint said better, so it goes with the closest of this
  // complaint's own points instead of becoming a point of its own.
  const statementVectors = await embed(result.points.map((p) => p.statement));
  const vectorOfPoint = (p: FirebaseFirestore.DocumentSnapshot) => (p.get('embedding') as VectorValue | undefined)?.toArray();
  const belongsTo = result.points.map((p, i) => {
    if (p.matchedPointId && points.some((x) => x.id === p.matchedPointId)) return p.matchedPointId;
    let best: { id: string; distance: number } | null = null;
    for (const x of points) {
      const v = vectorOfPoint(x);
      if (!v) continue;
      const distance = cosineDistance(v, statementVectors[i]);
      if (!best || distance < best.distance) best = { id: x.id, distance };
    }
    return best && best.distance < REREAD_SAME_POINT ? best.id : null;
  });

  const gained: ResolvedSubject[] = [];
  for (const point of points) {
    // A point other people share is theirs too: only what the model itself
    // matched to it counts there. The folded-in, more specific wording (and
    // the tags that came with it) applies only to a point that is this
    // complaint's alone, or one person could narrow what twelve people said.
    const alone = point.get('submissionCount') === 1 && point.get('canonical.submissionId') === submissionId;
    const mine = result.points
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => belongsTo[i] === point.id && (alone || p.matchedPointId === point.id));
    if (mine.length === 0) continue;
    const update: Record<string, unknown> = {};

    const current = point.get('subjectIds') as string[];
    const indexes = [...new Set(mine.flatMap(({ p }) => p.subjectIndexes))].filter(usable);
    const wanted = capFiling(await Promise.all(indexes.map(subjectAt)));
    const extra = wanted.filter((x) => !current.includes(x.id)).slice(0, Math.max(0, MAX_SUBJECTS_PER_POINT - current.length));
    if (extra.length) {
      const f = filing(extra);
      update.subjectIds = FieldValue.arrayUnion(...f.subjectIds);
      update.subjectNames = FieldValue.arrayUnion(...f.subjectNames);
      if (f.topicIds.length) update.topicIds = FieldValue.arrayUnion(...f.topicIds);
      if (f.categories.length) update.categories = FieldValue.arrayUnion(...f.categories);
      for (const x of extra) await db.doc(`subjects/${x.id}`).update({ 'stats.points': FieldValue.increment(1) });
      await addSupporters(f.subjectIds, point.get('supportCount') as number);
      gained.push(...extra);
    }

    // The most actionable way this point is now said.
    const best = mine.reduce((a, b) => (b.p.actionability > a.p.actionability ? b : a));
    if (best.p.statement !== point.get('text')) {
      const pointVector = vectorOfPoint(point);
      const better =
        best.p.actionability >= (point.get('canonical.actionability') as number) + HEADLINE_MIN_GAIN &&
        !!pointVector &&
        cosineDistance(pointVector, statementVectors[best.i]) < HEADLINE_MAX_DISTANCE;
      if (alone || better) {
        update.text = best.p.statement;
        update.canonical = { submissionId, authorName: displayName, actionability: best.p.actionability };
        update.embedding = AdminFieldValue.vector(statementVectors[best.i]);
      }
    }
    if (Object.keys(update).length) await point.ref.update({ ...update, lastActivityAt: FieldValue.serverTimestamp() });
  }

  // This complaint's own account of each of its issues, now with the detail.
  // Unlike the headline it is only ever this author's words, so it is
  // rewritten whether or not others share the issue.
  for (const point of points) {
    const parts = result.points.filter((_, i) => belongsTo[i] === point.id).map((p) => p.said || p.statement);
    const text = joinSaid(parts);
    if (!text) continue;
    const ref = point.ref.collection('statements').doc(submissionId);
    const existing = await ref.get();
    if (existing.exists) await ref.update({ text });
    else {
      await ref.set({
        text,
        submissionId,
        authorId: sub.get('authorId') as string,
        authorName: sub.get('authorName') as string,
        imported: !!sub.get('source'),
        removed: false,
        createdAt: sub.get('createdAt') ?? FieldValue.serverTimestamp(),
      });
    }
  }

  const unique = gained.filter((x, i) => gained.findIndex((y) => y.id === x.id) === i);
  await subRef.update({
    details: FieldValue.arrayUnion(detail),
    actionability: result.actionability,
    ...(unique.length
      ? {
          subjectIds: FieldValue.arrayUnion(...unique.map((x) => x.id)),
          subjectNames: FieldValue.arrayUnion(...unique.map((x) => x.name)),
        }
      : {}),
  });
  return { detail, missing: result.missing ?? [], filedUnder: unique.map((x) => x.name) };
}

export type DraftData = {
  text: string;
  photoPaths: string[];
  result: IntakeResult;
  vectors?: Record<string, number[]>;
  privateMatches?: (string | null)[];
};

/** Where an imported complaint came from (a public government record). */
export type Source = {
  name: string;
  shortName: string;
  id: string;
  url: string;
  date: Timestamp;
  /** What the organization told that agency, when the record has it. */
  orgReply: string | null;
  /** The agency's own caveat about its data (e.g. that it doesn't verify reports). */
  note?: string | null;
};

export type PublicOptions = {
  useRewrite: boolean;
  removePII: boolean;
  keep: number[];
  removeSubjects: Set<number>;
  addSubjectIds: string[];
};

/**
 * Puts a checked complaint on the public record: matched points gain a
 * supporter, new points are created, the author's words are kept as the
 * submission. Shared by `submitComplaint` and the public-record import
 * (`source`, with a synthetic author like "import:cfpb:123").
 */
export async function recordPublic(args: {
  uid: string;
  displayName: string;
  responderFor: string[];
  draft: DraftData;
  options: PublicOptions;
  source?: Source;
}) {
  const { uid, displayName, responderFor, draft, options, source } = args;
  const { text, photoPaths, result } = draft;
  const imported = uid.includes(':');
  const supportAt = source ? source.date : FieldValue.serverTimestamp();
  const countsThisWeek = !source || Date.now() - source.date.toMillis() < WEEK_MS;
  const useRewrite = options.useRewrite && !!result.suggestedRewrite;
  const removePII = options.removePII && !!result.pii.redactedText;
  // Card numbers, ID numbers and passwords go whatever the author chose.
  const finalText = useRewrite
    ? result.suggestedRewrite!
    : removePII
      ? result.pii.redactedText!
      : (result.pii.sensitiveRemovedText ?? text);
  const keptIdx = result.points.map((_, i) => i).filter((i) => options.keep.includes(i));
  if (keptIdx.length === 0) throw new HttpsError('invalid-argument', 'Keep at least one issue.');

  const resolved = await Promise.all(
    result.subjects.map((s, i) => (options.removeSubjects.has(i) ? null : resolveSubject(s))),
  );
  const added = await Promise.all(options.addSubjectIds.slice(0, 5).map((id) => existingSubject(id, { publish: true })));
  const allSubjects = capFiling([...resolved.filter((s): s is ResolvedSubject => !!s), ...added]);
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

  // Wording of matched points, to compare against their headlines.
  const matchedIdx = keptIdx.filter((i) => result.points[i].matchedPointId);
  const matchedVectors = await embed(matchedIdx.map((i) => result.points[i].statement));
  const missing = keptIdx.filter((i) => !result.points[i].matchedPointId && !draft.vectors?.[String(i)]);
  const missingVectors = await embed(missing.map((i) => result.points[i].statement));
  const vectorOf = (i: number) => draft.vectors?.[String(i)] ?? missingVectors[missing.indexOf(i)];

  const matchedPointIds: string[] = [];
  const addedPointIds: string[] = [];
  // What this complaint says about each issue, kept under the issue (statements.ts).
  const said = new Map<string, string[]>();
  const say = (pointId: string, p: IntakeResult['points'][number]) =>
    said.set(pointId, [...(said.get(pointId) ?? []), p.said || p.statement]);

  for (const i of keptIdx) {
    const p = result.points[i];
    let pointSubjects = capFiling([...p.subjectIndexes.flatMap((j) => (resolved[j] ? [resolved[j]!] : [])), ...added]);
    if (pointSubjects.length === 0) pointSubjects = allSubjects;
    if (p.matchedPointId) {
      const ref = db.doc(`points/${p.matchedPointId}`);
      const pointSnap = await ref.get();
      if (!pointSnap.exists || pointSnap.get('removed')) continue;
      const current = pointSnap.get('subjectIds') as string[];
      if (current.some((s) => responderFor.includes(s))) continue;
      say(ref.id, p);
      if (matchedPointIds.includes(ref.id)) continue;
      matchedPointIds.push(ref.id);
      const newSupporter = await db
        .doc(`points/${ref.id}/supports/${uid}`)
        .create({ uid, at: supportAt, via: imported ? 'import' : 'submission', submissionId: submission.id })
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
          ? { supportCount: FieldValue.increment(1), ...(countsThisWeek ? { weekSupport: FieldValue.increment(1) } : {}) }
          : {}),
        // Real accounts only; lists rank by these first (see supportPoint).
        ...(newSupporter && !imported ? { people: FieldValue.increment(1), weekPeople: FieldValue.increment(1) } : {}),
      };
      // A clearer wording can lead the point, credited as "summarized from"
      // its author's complaint, but only when it says the same thing: one
      // crafted complaint can't rewrite what everyone else supported.
      const pointVector = (pointSnap.get('embedding') as VectorValue | undefined)?.toArray();
      const statementVector = matchedVectors[matchedIdx.indexOf(i)];
      if (
        p.actionability >= (pointSnap.get('canonical.actionability') as number) + HEADLINE_MIN_GAIN &&
        pointVector &&
        statementVector &&
        cosineDistance(pointVector, statementVector) < HEADLINE_MAX_DISTANCE
      ) {
        update.text = p.statement;
        update.canonical = { submissionId: submission.id, authorName: displayName, actionability: p.actionability };
        update.embedding = AdminFieldValue.vector(statementVector);
      }
      // A new subject (another airline with the same problem) joins the
      // point, up to the cap. Tags only ever get added to an existing
      // point: one author can't re-file what others already filed.
      const room = MAX_SUBJECTS_PER_POINT - current.length;
      const extra = pointSubjects.filter((s) => !current.includes(s.id)).slice(0, Math.max(0, room));
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
      // The people already on this point hear that someone joined them.
      if (newSupporter && !imported) {
        await announceJoin(ref.id, (pointSnap.get('people') as number | undefined) ?? 0, pointSnap.get('text') as string).catch(() => {});
      }
    } else {
      const ref = db.collection('points').doc();
      addedPointIds.push(ref.id);
      say(ref.id, p);
      await ref.set({
        text: p.statement,
        ...filing(pointSubjects),
        supportCount: 1,
        weekSupport: countsThisWeek ? 1 : 0,
        people: imported ? 0 : 1,
        weekPeople: imported ? 0 : 1,
        // Raised by a person, or seeded from a public record: at equal real
        // support, what a person raised comes first in every list.
        imported,
        submissionCount: 1,
        rantCount: isRant ? 1 : 0,
        hot: isRant,
        status: 'open',
        statusBy: null,
        orgStatus: {},
        seenBy: {},
        respondedBy: {},
        canonical: { submissionId: submission.id, authorName: displayName, actionability: p.actionability },
        addedBy: 'model',
        firstSubmissionId: submission.id,
        photo: photos[0] ?? null,
        removed: false,
        embedding: AdminFieldValue.vector(vectorOf(i)),
        createdAt: FieldValue.serverTimestamp(),
        lastActivityAt: FieldValue.serverTimestamp(),
      });
      await ref.collection('supports').doc(uid).set({
        uid,
        at: supportAt,
        via: imported ? 'import' : 'submission',
        submissionId: submission.id,
      });
      for (const s of pointSubjects) {
        await db.doc(`subjects/${s.id}`).update({ 'stats.points': FieldValue.increment(1) });
      }
      await addSupporters(pointSubjects.map((s) => s.id), 1);
      const privatePath = draft.privateMatches?.[i];
      if (privatePath) await promotePrivatePoint(privatePath, ref.id);
    }
  }

  const rantScore =
    result.tone === 'rant' && !useRewrite ? Math.max(1, Math.min(10, Math.round(result.rantScore ?? 1))) : 0;
  await submission.set({
    authorName: displayName,
    authorId: authorIdOf(uid),
    text: finalText,
    language: result.language,
    englishText: result.language.startsWith('en') ? null : useRewrite ? null : result.englishText,
    rewritten: useRewrite,
    subjectIds: allSubjects.map((s) => s.id),
    subjectNames: allSubjects.map((s) => s.name),
    matchedPointIds,
    addedPointIds,
    tone: result.tone,
    // The model's read of a rant, 1-10; only rants have one.
    rantScore,
    // Readers' "Best rant" votes, and the list's sort key (rants.ts).
    loves: 0,
    rantRank: rantRank({ loves: 0, rantScore, imported }),
    // Peppers. The rewrite is the calm version.
    spice: useRewrite ? 1 : Math.max(1, Math.min(5, Math.round(result.spice ?? 1))),
    actionability: result.actionability,
    photos,
    // Details the author adds after posting (details.ts).
    details: [],
    source: source ?? null,
    removed: false,
    createdAt: source ? source.date : FieldValue.serverTimestamp(),
  });
  // Who wrote it stays server-side: for deleting an account and for
  // suspending an abusive one, never shown.
  await db.doc(`authors/${submission.id}`).set({ uid });
  await writeStatements({
    submissionId: submission.id,
    authorId: authorIdOf(uid),
    authorName: displayName,
    imported,
    createdAt: source ? source.date : FieldValue.serverTimestamp(),
    said,
  });
  // The author's own index of what they posted, with what the model thought
  // was missing: shown only to them, as suggestions (details.ts).
  // Two points saying the same thing: nominated for the operator to merge (duplicates.ts).
  if (!imported) await flagDuplicates(db, [...addedPointIds, ...matchedPointIds]);
  if (!imported) {
    await db.doc(`users/${uid}/mine/${submission.id}`).set({
      at: FieldValue.serverTimestamp(),
      missing: useRewrite ? [] : (result.missing ?? []).slice(0, 3),
    });
  }
  return { submissionId: submission.id, matchedPointIds, addedPointIds };
}

function publicOptions(data: Record<string, unknown> | undefined, result: IntakeResult): PublicOptions {
  const ints = (v: unknown) => (Array.isArray(v) ? v.filter((i): i is number => Number.isInteger(i)) : null);
  return {
    useRewrite: data?.useRewrite === true,
    removePII: data?.removePII !== false,
    keep: ints(data?.keepPoints) ?? result.points.map((_, i) => i),
    removeSubjects: new Set(ints(data?.removeSubjects) ?? []),
    addSubjectIds: Array.isArray(data?.addSubjectIds)
      ? [...new Set(data!.addSubjectIds.filter((x): x is string => typeof x === 'string'))].slice(0, 5)
      : [],
  };
}

/** Step 2: the author confirms, publicly or privately to one organization. */
export const submitComplaint = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async (req) => {
  const uid = uidOf(req);
  const draftId = typeof req.data?.draftId === 'string' ? req.data.draftId : '';
  const draftSnap = draftId ? await db.doc(`drafts/${draftId}`).get() : null;
  if (!draftSnap?.exists || draftSnap.get('uid') !== uid) {
    throw new HttpsError('not-found', 'That draft has expired. Check your complaint again.');
  }
  const user = await ensureUser(uid);
  await requireTerms(req, user);
  await rateLimit(req, 'submit');
  const draft = draftSnap.data() as DraftData;
  if (draft.result.safety?.unsafe) {
    throw new HttpsError('failed-precondition', draft.result.safety.reason ?? 'This breaks the terms of use and can\'t be recorded.');
  }
  if (!draft.result.isComplaint) throw new HttpsError('failed-precondition', 'There is nothing to record in this one.');
  // Five peppers is over the line: name-calling at people. Never posted, not even privately.
  if ((draft.result.spice ?? 1) >= 5) {
    throw new HttpsError('failed-precondition', draft.result.spiceReason ?? 'Too spicy: the name-calling has to go.');
  }
  if (req.data?.visibility === 'private') {
    return submitPrivate(req, { draftRef: draftSnap.ref, ...draft, displayName: user.displayName });
  }
  const res = await recordPublic({
    uid,
    displayName: user.displayName,
    responderFor: user.responderFor,
    draft,
    options: publicOptions(req.data, draft.result),
  });
  await draftSnap.ref.delete();
  return res;
});
