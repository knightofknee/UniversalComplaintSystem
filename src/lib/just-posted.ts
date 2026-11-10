import { useSyncExternalStore } from 'react';

/**
 * The complaint this person posted a moment ago, so their profile can bring
 * it into view and mark it. Held in memory, not in the address: a tab that
 * carries a leftover parameter keeps re-marking the same complaint and
 * confuses navigation from it. Stays until the next post or the app closes
 * (so it is still marked after a detour through the sign-in sheet).
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export function setJustPosted(id: string | null) {
  current = id;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useJustPosted() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
