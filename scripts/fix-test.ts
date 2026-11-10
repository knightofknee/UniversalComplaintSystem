/**
 * Proposed fixes and names, tested against the LOCAL EMULATORS only (never
 * the live record): who may rate a fix, how the tallies move, and when a
 * point becomes Fixed or stops being so.
 *
 *   npm run emulators      (one terminal)
 *   npm run fix-test       (another)
 */
// These are set before anything loads, so nothing here can reach production.
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8180';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9109';
process.env.GCLOUD_PROJECT = 'universal-complaint-system';
async function main() {
  const { db, Timestamp } = await import('../functions/src/common');
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');
  const { getFunctions, connectFunctionsEmulator, httpsCallable } = await import('firebase/functions');

  let failed = 0;
  const check = (what: string, ok: boolean, got?: unknown) => {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` (got ${JSON.stringify(got)})`}`);
  };
  const person = async (name: string) => {
    const app = initializeApp({ apiKey: 'x', projectId: 'universal-complaint-system' }, name);
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://localhost:9109', { disableWarnings: true });
    const fns = getFunctions(app, 'us-central1');
    connectFunctionsEmulator(fns, 'localhost', 5011);
    const { user } = await signInAnonymously(auth);
    const call = (fn: string, data: object) => httpsCallable(fns, fn)(data).then((r) => r.data);
    return { uid: user.uid as string, call };
  };
  const fails = async (p: Promise<unknown>) => p.then(() => null, (e: { message: string }) => e.message);

  const point = db.collection('points').doc();
  await point.set({ text: 'The elevator is always broken.', subjectIds: [], subjectNames: [], removed: false, status: 'open', supportCount: 3, weekSupport: 0 });
  const [a, b, c, late, proposer] = await Promise.all(['a', 'b', 'c', 'late', 'proposer'].map(person));
  const hourAgo = Timestamp.fromMillis(Date.now() - 3600_000);
  for (const p of [a, b, c]) await point.collection('supports').doc(p.uid).set({ uid: p.uid, at: hourAgo, via: 'direct' });

  check('a fix needs the terms agreed', /terms/i.test((await fails(proposer.call('proposeFix', { pointId: point.id, text: 'Use the stairs on the east side.' }))) ?? ''));
  check('name-calling is sent back', /name-calling/i.test((await fails(proposer.call('proposeFix', { pointId: point.id, text: 'Fire the idiots who run it.', acceptTerms: true }))) ?? ''));
  const made = (await proposer.call('proposeFix', { pointId: point.id, text: 'Call 311 and ask for an inspection.', acceptTerms: true })) as { id: string };
  check('fix posted', !!made.id);
  check('one fix per person per point', /already/i.test((await fails(proposer.call('proposeFix', { pointId: point.id, text: 'Another way around it entirely.' }))) ?? ''));
  const fix = point.collection('solutions').doc(made.id);
  check('the proposer cannot rate their own', !!(await fails(proposer.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'full' }))));
  check('someone without the problem cannot rate', /Support the point/i.test((await fails(late.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'full' }))) ?? ''));

  // A later supporter's rating shows in the tally but decides nothing.
  await point.collection('supports').doc(late.uid).set({ uid: late.uid, at: Timestamp.now(), via: 'direct' });
  await late.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'full' });
  check('late rating is tallied', (await fix.get()).get('full') === 1 && (await fix.get()).get('earlyFull') === 0, (await fix.get()).data());
  check('late rating does not make it Fixed', (await point.get()).get('status') === 'open');

  await a.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'full' });
  await b.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'partial' });
  check('2 of 3 early raters is not enough', (await point.get()).get('status') === 'open', (await point.get()).get('status'));
  await b.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'full' });
  const r = (await c.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'full' })) as { status: string };
  check('3 early "fully" makes it Fixed', r.status === 'fixed' && (await point.get()).get('fixedBy') === made.id, r);
  let f = (await fix.get()).data()!;
  check('tallies are right', f.full === 4 && f.partial === 0 && f.none === 0 && f.earlyFull === 3 && f.earlyOther === 0, f);

  await c.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'none' });
  await b.call('rateFix', { pointId: point.id, fixId: made.id, rating: 'none' });
  check('changing minds un-fixes it', (await point.get()).get('status') === 'open' && (await point.get()).get('fixedBy') === null, (await point.get()).data());
  await b.call('rateFix', { pointId: point.id, fixId: made.id, rating: null });
  f = (await fix.get()).data()!;
  check('taking a rating back', f.full === 2 && f.none === 1 && f.earlyFull === 1 && f.earlyOther === 1, f);

  // Names: only offered ones, and it renames the fix.
  const { names } = (await proposer.call('nameOptions', {})) as { names: string[] };
  check('twelve names offered', names.length === 12);
  check('a typed name is refused', !!(await fails(proposer.call('setName', { name: 'Elon Musk' }))));
  await proposer.call('setName', { name: names[0] });
  check('the fix carries the new name', (await fix.get()).get('authorName') === names[0], (await fix.get()).get('authorName'));

  console.log(failed ? `\n${failed} FAILED` : '\nAll checks pass');
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
