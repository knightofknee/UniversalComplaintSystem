/**
 * Removing something from the record. Only for illegal content, personal
 * data, or complaints about private individuals - and every removal is
 * logged publicly in `removals` (the in-app Removal log).
 *
 *   npm run remove -- point <id> "reason"
 *   npm run remove -- submission <id> "reason"
 *
 * Removed items are hidden (removed: true), not deleted, so a mistake can
 * be undone by setting it back.
 */
process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

async function main() {
  const { db, FieldValue } = await import('../functions/src/common');
  const [kind, id, ...rest] = process.argv.slice(2);
  const reason = rest.join(' ');
  if ((kind !== 'point' && kind !== 'submission') || !id || !reason) {
    throw new Error('Usage: npm run remove -- point|submission <id> "reason"');
  }
  const ref = db.doc(`${kind === 'point' ? 'points' : 'submissions'}/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Not found.');
  await ref.update({ removed: true });
  await db.collection('removals').add({
    kind,
    subjectNames: snap.get('subjectNames') ?? [],
    reason,
    at: FieldValue.serverTimestamp(),
  });
  console.log(`Removed ${kind} ${id} and logged it.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
