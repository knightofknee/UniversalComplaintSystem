/**
 * Public names. Everyone gets a random two-word name ("Sincere Puffin") and
 * can swap it for another one: the app shuffles through options from
 * `nameOptions` and only `setName` changes anything. Names are always built
 * from the two lists, never typed, so a name can't be an insult, a real
 * person or an ad, and nobody has to moderate them.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { authorIdOf, CALLABLE, db, ensureUser, NAME_ADJECTIVES, NAME_NOUNS, rateLimit, uidOf } from './common';

const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

/**
 * A new account gets its name the moment the app sees it has none, not on
 * its first post: Me shows the name, and "You" there read like a bug.
 */
export const ensureProfile = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  await rateLimit(req, 'settings');
  const { displayName } = await ensureUser(uid);
  return { displayName };
});

export const nameOptions = onCall(CALLABLE, async (req) => {
  const uid = uidOf(req);
  await rateLimit(req, 'settings');
  const { displayName } = await ensureUser(uid);
  const names = new Set<string>();
  while (names.size < 12) {
    const n = `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`;
    if (n !== displayName) names.add(n);
  }
  return { names: [...names] };
});

export const setName = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async (req) => {
  const uid = uidOf(req);
  const name = typeof req.data?.name === 'string' ? req.data.name : '';
  const [adjective, noun, ...rest] = name.split(' ');
  if (rest.length || !NAME_ADJECTIVES.includes(adjective) || !NAME_NOUNS.includes(noun)) {
    throw new HttpsError('invalid-argument', 'Pick one of the names offered.');
  }
  await rateLimit(req, 'rename');
  const { displayName: old } = await ensureUser(uid);
  if (old === name) return { name };
  await db.doc(`users/${uid}`).update({ displayName: name });
  // The name is copied onto what they posted, so it changes there too.
  const mine = await db.collection(`users/${uid}/mine`).get();
  for (const m of mine.docs) {
    const sub = await db.doc(`submissions/${m.id}`).get();
    if (!sub.exists || sub.get('authorName') !== old) continue;
    await sub.ref.update({ authorName: name });
    for (const pid of [...((sub.get('addedPointIds') as string[]) ?? []), ...((sub.get('matchedPointIds') as string[]) ?? [])]) {
      const point = await db.doc(`points/${pid}`).get();
      if (point.get('canonical.submissionId') === m.id) await point.ref.update({ 'canonical.authorName': name });
    }
  }
  const fixes = await db.collectionGroup('solutions').where('authorId', '==', authorIdOf(uid)).get();
  await Promise.all(fixes.docs.map((d) => d.ref.update({ authorName: name })));
  return { name };
});
