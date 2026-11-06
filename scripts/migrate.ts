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
 * - subjects get `websiteVerified: false` where unset.
 */
process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

async function main() {
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
