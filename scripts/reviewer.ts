/**
 * The App Store / Play review account: a verified email that responds for
 * the "Universal Complaint System" organization page (UCS itself), so a
 * reviewer can see responding, statuses and the private inbox.
 *
 *   npm run reviewer
 *
 * The credentials are written to .reviewer.local (gitignored), never to the
 * repo. Running it again keeps the account and prints the same file.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

const EMAIL = 'app-review@waldgrave.com';
const FILE = '.reviewer.local';

async function main() {
  const { db, FieldValue } = await import('../functions/src/common');
  // firebase-admin lives only in functions/ (one Firebase SDK copy in the app).
  const { getAuth } = await import('../functions/node_modules/firebase-admin/lib/auth/index.js');
  const auth = getAuth();
  let password: string;
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(EMAIL)).uid;
    password = existsSync(FILE) ? (readFileSync(FILE, 'utf8').match(/password: (\S+)/)?.[1] ?? '') : '';
    if (!password) {
      password = randomBytes(9).toString('base64url');
      await auth.updateUser(uid, { password });
    }
  } catch {
    password = randomBytes(9).toString('base64url');
    uid = (await auth.createUser({ email: EMAIL, password, emailVerified: true })).uid;
  }

  // UCS's own organization page.
  const existing = await db.collection('subjects').where('nameLower', '==', 'universal complaint system').limit(1).get();
  const subject = existing.empty ? db.collection('subjects').doc() : existing.docs[0].ref;
  if (existing.empty) {
    const { embed } = await import('../functions/src/ai');
    const [vector] = await embed(['Universal Complaint System: the app for complaining about anything, and this record itself.']);
    await subject.set({
      kind: 'organization',
      name: 'Universal Complaint System',
      nameLower: 'universal complaint system',
      description: 'This app and the public record it keeps. Complaints about UCS itself go here.',
      website: 'https://www.waldgrave.com/ucs',
      websiteVerified: true,
      category: 'tech',
      domains: ['waldgrave.com'],
      claimed: true,
      createdBy: 'operator',
      stats: { points: 0, seen: 0, responded: 0, fixed: 0, supporters: 0 },
      removed: false,
      pendingPublic: false,
      embedding: FieldValue.vector(vector),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await subject.collection('responders').doc(uid).set({ email: EMAIL, official: true, addedAt: FieldValue.serverTimestamp() });
  await db.doc(`users/${uid}`).set(
    {
      displayName: 'App Reviewer',
      responderFor: FieldValue.arrayUnion(subject.id),
      termsAcceptedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  writeFileSync(
    FILE,
    `App review account (give to Apple / Google; never commit)\nemail: ${EMAIL}\npassword: ${password}\nresponds for: Universal Complaint System (subjects/${subject.id})\n`,
  );
  console.log(`Ready. Credentials are in ${FILE}.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
