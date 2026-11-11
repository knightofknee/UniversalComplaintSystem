/**
 * A test account that can respond for a test company, so the organization
 * side of the app can be tried end to end.
 *
 *   npm run tester -- someone@tester.com          once
 *   npm run tester -- someone@tester.com --wait   keep checking until that
 *                                                 account has signed up
 *
 * Makes sure the "Tester Company" organization exists, then marks the
 * account's email verified (no inbox needed) and lets it respond for that
 * company. The account itself is made in the app, with Sign up: this never
 * creates one or touches a password. Safe to run again.
 */
process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

const NAME = 'Tester Company';

async function main() {
  const email = (process.argv[2] ?? '').toLowerCase();
  const wait = process.argv.includes('--wait');
  if (!email.includes('@')) throw new Error('Usage: npm run tester -- someone@tester.com [--wait]');
  const { db, FieldValue } = await import('../functions/src/common');
  // firebase-admin lives only in functions/ (one Firebase SDK copy in the app).
  const { getAuth } = await import('../functions/node_modules/firebase-admin/lib/auth/index.js');
  const auth = getAuth();

  const existing = await db.collection('subjects').where('nameLower', '==', NAME.toLowerCase()).limit(1).get();
  const subject = existing.empty ? db.collection('subjects').doc() : existing.docs[0].ref;
  if (existing.empty) {
    const { embed } = await import('../functions/src/ai');
    const [vector] = await embed([`${NAME}: a made-up company for trying out complaints and responses.`]);
    await subject.set({
      kind: 'organization',
      name: NAME,
      nameLower: NAME.toLowerCase(),
      description: 'A made-up company for trying out complaints and responses.',
      website: null,
      websiteVerified: false,
      category: 'other',
      domains: [],
      claimed: false,
      createdBy: 'operator',
      stats: { points: 0, seen: 0, responded: 0, fixed: 0, supporters: 0 },
      removed: false,
      pendingPublic: false,
      embedding: FieldValue.vector(vector),
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`Created "${NAME}" (subjects/${subject.id}).`);
  }

  const until = Date.now() + 3 * 3600_000;
  for (;;) {
    const user = await auth.getUserByEmail(email).catch(() => null);
    if (user) {
      if (!user.emailVerified) await auth.updateUser(user.uid, { emailVerified: true });
      await subject.update({ domains: FieldValue.arrayUnion(email.split('@')[1]), claimed: true });
      await subject.collection('responders').doc(user.uid).set({ email, official: false, addedAt: FieldValue.serverTimestamp() });
      await db.doc(`users/${user.uid}`).set({ responderFor: FieldValue.arrayUnion(subject.id) }, { merge: true });
      console.log(`${email}: email verified, responds for "${NAME}" (subjects/${subject.id}).`);
      return;
    }
    if (!wait || Date.now() > until) {
      console.log(`${email} has not signed up yet. Sign up in the app with that email, then run this again.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
