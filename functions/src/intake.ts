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
  if (keptIdx.length === 0) throw new HttpsError('invalid-argument', 'Keep at least one point.');

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
    } else {
      const ref = db.collection('points').doc();
      addedPointIds.push(ref.id);
      await ref.set({
        text: p.statement,
        ...filing(pointSubjects),
        supportCount: 1,
        weekSupport: countsThisWeek ? 1 : 0,
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
    // "Best rants" ranks by this; only rants have one.
    rantScore: result.tone === 'rant' && !useRewrite ? Math.max(1, Math.min(10, Math.round(result.rantScore ?? 1))) : 0,
    // Peppers. The rewrite is the calm version.
    spice: useRewrite ? 1 : Math.max(1, Math.min(5, Math.round(result.spice ?? 1))),
    actionability: result.actionability,
    photos,
    source: source ?? null,
    removed: false,
    createdAt: source ? source.date : FieldValue.serverTimestamp(),
  });
  // Who wrote it stays server-side: for deleting an account and for
  // suspending an abusive one, never shown.
  await db.doc(`authors/${submission.id}`).set({ uid });
  if (!imported) await db.doc(`users/${uid}/mine/${submission.id}`).set({ at: FieldValue.serverTimestamp() });
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
