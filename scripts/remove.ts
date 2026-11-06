/**
 * Removing something from the record. Only for illegal content, personal
 * data, abuse, or complaints about private individuals - and every removal
 * is logged publicly in `removals` (the in-app Removal log). The operator
 * queue in the app (Me > Operator) does the same from a report.
 *
 *   npm run remove -- point <id> "reason"
 *   npm run remove -- submission <id> "reason"
 *   npm run remove -- subject <id> "reason"
 *   npm run remove -- response <pointId>/<responseId> "reason"
 *
 * Removed items are hidden (removed: true), not deleted, so a mistake can
 * be undone by setting it back.
 */
process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

async function main() {
  const { removeTarget } = await import('../functions/src/moderation');
  const [kind, id, ...rest] = process.argv.slice(2);
  const reason = rest.join(' ');
  const paths: Record<string, (id: string) => string> = {
    point: (x) => `points/${x}`,
    submission: (x) => `submissions/${x}`,
    subject: (x) => `subjects/${x}`,
    response: (x) => `points/${x.split('/')[0]}/responses/${x.split('/')[1]}`,
  };
  if (!paths[kind] || !id || !reason) {
    throw new Error('Usage: npm run remove -- point|submission|subject|response <id> "reason"');
  }
  await removeTarget(paths[kind](id), reason);
  console.log(`Removed ${kind} ${id} and logged it.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
