/**
 * One-time data changes for the pre-submission build (2026-11-05). Safe to
 * run more than once.
 *
 *   npm run migrate
 *
 * - submissions get `authorId` (for Block) and a server-only `authors` link;
 * - points get per-organization status (`orgStatus`) from the old single
 *   `fixClaimedBy` / `fixVotes` fields;
 * - `restrictedTo` moves off the public subject to `restricted/{id}`;
 * - subjects get `websiteVerified: false` where unset;
 * - CFPB public-record submissions read with the company's usual name, and
 *   "on <date>" when every complaint came the same day (2026-11-06).
 */
import { readableCompany } from './cfpb-names';

process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

/**
 * 2026-11-09: what lists rank by. `npm run migrate ranks` runs only this.
 * - points get `people` / `weekPeople`: support from real accounts only
 *   (imported supporters have ids like "import:cfpb:123"), and `imported`
 *   (seeded from a public record), so a complaint a person made sorts above
 *   the public-record seed;
 * - submissions get `loves` (readers' "Best rant" votes) and `rantRank`.
 */
async function ranks() {
  const { db } = await import('../functions/src/common');
  const { rantRank } = await import('../functions/src/rants');
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  const people = new Map<string, { all: number; week: number }>();
  const supports = await db.collectionGroup('supports').select('at').get();
  for (const d of supports.docs) {
    if (d.id.includes(':')) continue;
    const pointId = d.ref.parent.parent!.id;
    const c = people.get(pointId) ?? { all: 0, week: 0 };
    c.all++;
    if ((d.get('at')?.toMillis?.() ?? 0) >= weekAgo) c.week++;
    people.set(pointId, c);
  }
  const subs = await db
    .collection('submissions')
    .select('loves', 'rantScore', 'rantRank', 'source', 'text', 'addedPointIds')
    .get();
  // A point is imported when the complaint that created it came from a public record.
  const seeded = new Set<string>();
  for (const s of subs.docs) {
    if (s.get('source')) for (const id of (s.get('addedPointIds') as string[] | undefined) ?? []) seeded.add(id);
  }
  const writer = db.bulkWriter();
  const points = await db.collection('points').select('people', 'weekPeople', 'imported').get();
  let n = 0;
  for (const p of points.docs) {
    const c = people.get(p.id) ?? { all: 0, week: 0 };
    const imported = seeded.has(p.id);
    if (p.get('people') === c.all && p.get('weekPeople') === c.week && p.get('imported') === imported) continue;
    void writer.update(p.ref, { people: c.all, weekPeople: c.week, imported });
    n++;
  }
  console.log(
    `${n} of ${points.size} points given their real-people counts (${people.size} have any; ${seeded.size} are imported).`,
  );

  n = 0;
  for (const s of subs.docs) {
    const loves = (s.get('loves') as number | undefined) ?? 0;
    const gone = s.get('text') === '[deleted]';
    const rank = gone ? 0 : rantRank({ loves, rantScore: (s.get('rantScore') as number | undefined) ?? 0, imported: !!s.get('source') });
    if (s.get('loves') === loves && s.get('rantRank') === rank) continue;
    void writer.update(s.ref, { loves, rantRank: rank });
    n++;
  }
  await writer.close();
  console.log(`${n} of ${subs.size} complaints given their best-rant rank.`);
}

async function main() {
  if (process.argv[2] === 'ranks') return ranks();
  await ranks();
  const { authorIdOf, db, FieldValue } = await import('../functions/src/common');

  const mine = await db.collectionGroup('mine').get();
  let n = 0;
  for (const m of mine.docs) {
    const uid = m.ref.parent.parent!.id;
    const sub = db.doc(`submissions/${m.id}`);
    if (!(await sub.get()).exists) continue;
    await sub.update({ authorId: authorIdOf(uid) });
    await db.doc(`authors/${m.id}`).set({ uid });
    n++;
  }
  console.log(`${n} submissions linked to their authors.`);

  const cfpb = await db.collection('submissions').where('source.shortName', '==', 'CFPB').get();
  n = 0;
  for (const d of cfpb.docs) {
    const text = d.get('text') as string;
    const next = text
      .replace(/about (.+?) (between|on) /, (_, c: string, w: string) => `about ${readableCompany(c)} ${w} `)
      .replace(/between (\w{3} \d{1,2}, \d{4}) and \1\./, 'on $1.');
    if (next !== text) {
      await d.ref.update({ text: next });
      n++;
    }
  }
  console.log(`${n} public-record complaints reworded.`);

  const points = await db.collection('points').get();
  n = 0;
  for (const p of points.docs) {
    if (p.get('orgStatus')) continue;
    const by = p.get('fixClaimedBy') as string | null;
    const status = p.get('status') as string;
    const orgStatus =
      by && status !== 'open'
        ? { [by]: { status, at: p.get('lastActivityAt'), fixClaimedAt: p.get('lastActivityAt'), ...(p.get('fixVotes') ?? { yes: 0, no: 0 }) } }
        : {};
    await p.ref.update({
      orgStatus,
      statusBy: by ?? p.get('statusBy') ?? null,
      fixClaimedBy: FieldValue.delete(),
      fixVotes: FieldValue.delete(),
    });
    n++;
  }
  console.log(`${n} points moved to per-organization status.`);

  const votes = await db.collectionGroup('fixVotes').get();
  for (const v of votes.docs) {
    if (v.get('orgId')) continue;
    const by = (await v.ref.parent.parent!.get()).get('statusBy') as string | null;
    if (!by) {
      await v.ref.delete();
      continue;
    }
    await v.ref.parent.doc(`${by}_${v.id}`).set({ ...v.data(), orgId: by });
    await v.ref.delete();
  }

  const subjects = await db.collection('subjects').get();
  n = 0;
  for (const s of subjects.docs) {
    const update: Record<string, unknown> = {};
    const restricted = s.get('restrictedTo') as string[] | null | undefined;
    if (restricted !== undefined) {
      if (restricted?.length) await db.doc(`restricted/${s.id}`).set({ emails: restricted });
      update.restrictedTo = FieldValue.delete();
    }
    if (s.get('websiteVerified') === undefined) update.websiteVerified = false;
    if (Object.keys(update).length) {
      await s.ref.update(update);
      n++;
    }
  }
  console.log(`${n} subjects updated.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
