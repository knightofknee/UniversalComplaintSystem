import { collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useMemo } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/hooks';

/**
 * Block: hide one author's public complaints from yourself. Authors are
 * known only by an opaque id, so blocking reveals nothing about them. The
 * list is the reader's own (users/{uid}/blocks).
 */
export function useBlockedAuthors() {
  const { user } = useAuth();
  const { items } = useCollection<{ id: string; name: string }>(
    user ? collection(db, `users/${user.uid}/blocks`) : null,
    `blocks:${user?.uid}`,
  );
  return useMemo(() => ({ ids: new Set(items.map((b) => b.id)), list: items }), [items]);
}

export async function blockAuthor(uid: string, authorId: string, name: string) {
  await setDoc(doc(db, `users/${uid}/blocks/${authorId}`), { name: name.slice(0, 80), at: serverTimestamp() });
}

export async function unblockAuthor(uid: string, authorId: string) {
  await deleteDoc(doc(db, `users/${uid}/blocks/${authorId}`));
}
