import { doc, onSnapshot, type DocumentReference, type Query } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { db } from '@/lib/firebase';

/**
 * Live list from a query; `key` must change whenever the query does. Results
 * are tagged with the key they belong to, so a new query reads as loading
 * (not as the previous query's results) until its first snapshot arrives.
 */
export function useCollection<T>(query: Query | null, key: string) {
  const [snap, setSnap] = useState<{ key: string; items: T[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!query) return;
    return onSnapshot(
      query,
      (s) => setSnap({ key, items: s.docs.map((d) => ({ id: d.id, ...d.data() }) as T), error: null }),
      (e) => {
        console.warn(key, e);
        setSnap({ key, items: [], error: e.message });
      },
    );
    // The query object is rebuilt every render; `key` is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !query]);
  const current = query && snap?.key === key ? snap : null;
  return {
    items: current?.items ?? [],
    loading: !!query && !current,
    error: current?.error ?? null,
  };
}

export function useDoc<T>(path: string | null) {
  const [snap, setSnap] = useState<{ path: string; data: T | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    return onSnapshot(
      doc(db, path) as DocumentReference,
      (s) => setSnap({ path, data: s.exists() ? ({ id: s.id, ...s.data() } as T) : null }),
      () => setSnap({ path, data: null }),
    );
  }, [path]);
  const current = path && snap?.path === path ? snap : null;
  return { data: current?.data ?? null, loading: !!path && !current };
}

export function timeAgo(ms: number | undefined | null): string {
  if (!ms) return 'just now';
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** "1 point", "2 points". */
export function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
