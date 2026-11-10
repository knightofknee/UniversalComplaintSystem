/**
 * Proposed fixes, names, added details, account merging and duplicate points, tested against the LOCAL EMULATORS only (never
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
  const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInAnonymously } = await import('firebase/auth');
  const { getFunctions, connectFunctionsEmulator, httpsCallable } = await import('firebase/functions');

  let failed = 0;
  const check = (what: string, ok: boolean, got?: unknown) => {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` (got ${JSON.stringify(got)})`}`);
  };
  const person = async (name: string, withEmail = false) => {
    const app = initializeApp({ apiKey: 'x', projectId: 'universal-complaint-system' }, name);
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://localhost:9109', { disableWarnings: true });
    const fns = getFunctions(app, 'us-central1');
    connectFunctionsEmulator(fns, 'localhost', 5011);
    const { user } = withEmail
      ? await createUserWithEmailAndPassword(auth, `${name}-${Date.now()}@example.com`, 'a-test-password')
      : await signInAnonymously(auth);
    const call = (fn: string, data: object) => httpsCallable(fns, fn)(data).then((r) => r.data);
    return { uid: user.uid as string, call, token: () => user.getIdToken() };
  };
  const fails = async (p: Promise<unknown>) => p.then(() => null, (e: { message: string }) => e.message);

  const point = db.collection('points').doc();
  await point.set({ text: 'The elevator is always broken.', subjectIds: [], subjectNames: [], removed: false, status: 'open', supportCount: 3, weekSupport: 0 });
  const [a, b, c, late, proposer] = await Promise.all(['a', 'b', 'c', 'late', 'proposer'].map((name) => person(name)));
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

  // Adding a detail to your own complaint (details.ts).
  const sub = db.collection('submissions').doc();
  await sub.set({
    text: 'My laptop overheats.',
    authorName: 'x',
    removed: false,
    details: [],
    subjectIds: [],
    subjectNames: [],
    addedPointIds: [],
    matchedPointIds: [],
  });
  await db.doc(`authors/${sub.id}`).set({ uid: a.uid });
  const mineRef = db.doc(`users/${a.uid}/mine/${sub.id}`);
  await mineRef.set({ missing: ['the make and model of your laptop', 'when it happened'] });
  check('only the author can add a detail', /Only the author/.test((await fails(b.call('addDetail', { submissionId: sub.id, text: 'Dell XPS 13' }))) ?? ''));
  check('a detail with a link is refused', /links and contact/.test((await fails(a.call('addDetail', { submissionId: sub.id, text: 'see www.example.com' }))) ?? ''));
  // Adding has the model read the complaint again (a real call, like intake in the emulators).
  const added = (await a.call('addDetail', { submissionId: sub.id, item: 'the make and model of your laptop', text: 'Dell XPS 13 9310' })) as { reread: boolean };
  check('the detail is added under the complaint', JSON.stringify((await sub.get()).get('details')) === '["Dell XPS 13 9310"]', (await sub.get()).get('details'));
  check('the complaint was read again with it', added.reread === true, added);
  check('what it answered is no longer listed', !((await mineRef.get()).get('missing') as string[]).some((m) => /make and model/.test(m)), (await mineRef.get()).get('missing'));
  await mineRef.update({ missing: ['when it happened'] });
  await a.call('addDetail', { submissionId: sub.id, item: 'when it happened' });
  check('a suggestion can be dismissed without adding anything', (await mineRef.get()).get('missing').length === 0 && (await sub.get()).get('details').length === 1);
  check('and stays dismissed', JSON.stringify((await mineRef.get()).get('dismissed')) === '["when it happened"]', (await mineRef.get()).get('dismissed'));

  // Signing in to an existing account brings the device's signed-out activity with it (merge.ts).
  const { authorIdOf } = await import('../functions/src/common');
  const guest = await person('guest');
  const member = await person('member', true);
  const [mine1, both] = [db.collection('points').doc(), db.collection('points').doc()];
  const post = db.collection('submissions').doc();
  const other = db.collection('submissions').doc();
  const base = { subjectIds: [], subjectNames: [], removed: false, status: 'open', weekSupport: 0, weekPeople: 0 };
  await mine1.set({ ...base, text: 'Guest point.', supportCount: 1, people: 1, canonical: { submissionId: post.id, authorName: 'Guest', actionability: 50 } });
  await both.set({ ...base, text: 'A point both support.', supportCount: 2, people: 2 });
  await mine1.collection('supports').doc(guest.uid).set({ uid: guest.uid, at: hourAgo, via: 'submission' });
  await both.collection('supports').doc(guest.uid).set({ uid: guest.uid, at: hourAgo, via: 'direct' });
  await both.collection('supports').doc(member.uid).set({ uid: member.uid, at: hourAgo, via: 'direct' });
  await post.set({ text: 'Guest complaint.', authorName: 'Guest', authorId: authorIdOf(guest.uid), removed: false, addedPointIds: [mine1.id], matchedPointIds: [] });
  await db.doc(`authors/${post.id}`).set({ uid: guest.uid });
  await db.doc(`users/${guest.uid}/mine/${post.id}`).set({ at: hourAgo, missing: ['which store'] });
  await other.set({ text: 'Someone else.', authorName: 'x', removed: false, loves: 2, rantScore: 0, rantRank: 2100 });
  await other.collection('loves').doc(guest.uid).set({ uid: guest.uid });
  await other.collection('loves').doc(member.uid).set({ uid: member.uid });
  await guest.call('proposeFix', { pointId: both.id, text: 'Restart it twice, that clears it.', acceptTerms: true });

  check('a signed-out account cannot be merged into', !!(await fails(guest.call('mergeAccount', { fromToken: await guest.token() }))));
  check('a real account cannot be merged away', /Nothing to bring over/.test((await fails(member.call('mergeAccount', { fromToken: await member.token() }))) ?? ''));
  await member.call('mergeAccount', { fromToken: await guest.token() });
  const memberName = (await db.doc(`users/${member.uid}`).get()).get('displayName');
  const moved = (await post.get()).data()!;
  check('the complaint is the signed-in account\'s now', moved.authorId === authorIdOf(member.uid) && moved.authorName === memberName, moved);
  check('it is in their list, with its suggestions', JSON.stringify((await db.doc(`users/${member.uid}/mine/${post.id}`).get()).get('missing')) === '["which store"]');
  check('the headline credit follows', (await mine1.get()).get('canonical.authorName') === memberName);
  check('support moves over', (await mine1.collection('supports').doc(member.uid).get()).exists && (await mine1.get()).get('supportCount') === 1);
  check('support both gave counts once', (await both.get()).get('supportCount') === 1 && (await both.get()).get('people') === 1, (await both.get()).data());
  check('a vote both gave counts once', (await other.get()).get('loves') === 1 && (await other.get()).get('rantRank') === 1100, (await other.get()).data());
  const fixNow = await both.collection('solutions').doc(authorIdOf(member.uid)).get();
  check('the proposed fix moves over', fixNow.exists && fixNow.get('authorName') === memberName && !(await both.collection('solutions').doc(authorIdOf(guest.uid)).get()).exists);
  check('the signed-out account is gone', !(await db.doc(`users/${guest.uid}`).get()).exists && !(await mine1.collection('supports').doc(guest.uid).get()).exists);

  // Two points that say the same thing: nominated at posting, merged by the operator (duplicates.ts).
  const { flagDuplicates, mergePoints } = await import('../functions/src/duplicates');
  const { FieldValue: AdminFV } = await import('../functions/src/common');
  const rnd = (seed: number) => Array.from({ length: 768 }, (_, i) => Math.sin(seed * 1000 + i * 12.9898) * 43758.5453 % 1);
  const baseVec = rnd(1);
  const nearVec = baseVec.map((v, i) => v + (i % 7 === 0 ? 0.02 : 0));
  const topicA = db.collection('subjects').doc();
  const topicB = db.collection('subjects').doc();
  await topicA.set({ name: 'Lost luggage', kind: 'topic', removed: false, stats: { points: 2, supporters: 5 } });
  await topicB.set({ name: 'Baggage claims', kind: 'topic', removed: false, stats: { points: 1, supporters: 2 } });
  const [big, small, unrelated] = [db.collection('points').doc(), db.collection('points').doc(), db.collection('points').doc()];
  const pt = { removed: false, status: 'open', submissionCount: 1, rantCount: 0, imported: false };
  await big.set({ ...pt, text: 'The airline loses bags.', supportCount: 3, people: 3, subjectIds: [topicA.id], subjectNames: ['Lost luggage'], topicIds: [topicA.id], embedding: AdminFV.vector(baseVec) });
  await small.set({ ...pt, text: 'Bags get lost by the airline.', supportCount: 2, people: 2, subjectIds: [topicA.id, topicB.id], subjectNames: ['Lost luggage', 'Baggage claims'], topicIds: [topicA.id, topicB.id], embedding: AdminFV.vector(nearVec) });
  await unrelated.set({ ...pt, text: 'The parking app double charges.', supportCount: 1, people: 1, subjectIds: [], subjectNames: [], embedding: AdminFV.vector(rnd(99)) });
  for (const u of ['u1', 'u2', 'u3']) await big.collection('supports').doc(u).set({ uid: u, at: hourAgo });
  for (const u of ['u3', 'u4']) await small.collection('supports').doc(u).set({ uid: u, at: hourAgo });
  const smallSub = db.collection('submissions').doc();
  await smallSub.set({ text: 'They lost my bag.', removed: false, tone: 'rant', matchedPointIds: [], addedPointIds: [small.id] });
  await small.collection('responses').doc('r1').set({ text: 'We are looking into it.', removed: false });

  await flagDuplicates(db, [small.id, unrelated.id]);
  const [pa, pb] = [big.id, small.id].sort();
  const nominated = await db.doc(`duplicates/${pa}_${pb}`).get();
  check('a near-identical pair is nominated', nominated.exists && nominated.get('status') === 'open', nominated.data());
  const others = await db.collection('duplicates').get();
  check('an unrelated point is not', others.docs.every((d) => d.get('a') !== unrelated.id && d.get('b') !== unrelated.id), others.docs.map((d) => d.id));
  await mergePoints(big.id, small.id);
  const kept = (await big.get()).data()!;
  check('supporters are combined, once each', kept.supportCount === 4 && kept.people === 4, kept);
  check('complaints and the rant count come along', kept.submissionCount === 2 && kept.rantCount === 1 && (await smallSub.get()).get('matchedPointIds').includes(big.id), kept);
  check('it gains the other point\'s topic', kept.subjectIds.includes(topicB.id) && kept.subjectNames.includes('Baggage claims'), kept.subjectNames);
  check('responses move over', (await big.collection('responses').doc('r1').get()).exists);
  check('the merged point leaves the record', (await small.get()).get('removed') === true && (await small.get()).get('mergedInto') === big.id);
  const ta = (await topicA.get()).get('stats');
  const tb = (await topicB.get()).get('stats');
  check('page totals follow', ta.points === 1 && ta.supporters === 4 && tb.points === 1 && tb.supporters === 4, { ta, tb });

  console.log(failed ? `\n${failed} FAILED` : '\nAll checks pass');
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
