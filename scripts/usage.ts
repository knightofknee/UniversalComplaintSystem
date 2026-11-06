/**
 * What the AI has cost, day by day, against the daily ceiling.
 *
 *   npm run usage                 the last 7 days
 *   npm run usage -- budget 40    set the daily ceiling (US dollars)
 */
process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

async function main() {
  const { db } = await import('../functions/src/common');
  const { dailyBudget } = await import('../functions/src/budget');
  const [cmd, value] = process.argv.slice(2);
  if (cmd === 'budget') {
    const usd = Number(value);
    if (!Number.isFinite(usd) || usd < 0) throw new Error('Usage: npm run usage -- budget <dollars>');
    await db.doc('config/ai').set({ dailyBudgetUsd: usd }, { merge: true });
    console.log(`Daily AI ceiling is now $${usd}.`);
    return;
  }
  const budget = await dailyBudget();
  console.log(`Daily ceiling: $${budget}\n`);
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 3600_000).toISOString().slice(0, 10);
    const u = (await db.doc(`usage/${day}`).get()).data() ?? {};
    const calls = (u.calls ?? {}) as Record<string, number>;
    console.log(
      `${day}  $${((u.costUsd as number) ?? 0).toFixed(2).padStart(6)}  ` +
        `${String(u.claudeCalls ?? 0).padStart(4)} checks  ` +
        `${String(calls.search ?? 0).padStart(5)} searches  ` +
        `${String(calls.intake ?? 0).padStart(5)} matchings  ` +
        `${String(calls.vision ?? 0).padStart(4)} photos` +
        (u.pausedAt ? '  (hit the ceiling)' : ''),
    );
  }
  const waiting = await db.collection('queue').where('status', '==', 'waiting').count().get();
  if (waiting.data().count) console.log(`\n${waiting.data().count} complaints queued for budget.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
