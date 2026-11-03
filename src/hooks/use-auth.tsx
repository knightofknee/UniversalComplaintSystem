import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { auth, db } from '@/lib/firebase';

export type Profile = { displayName: string; responderFor: string[] };

type AuthState = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** Re-read the token (after verifying an email, say). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  refresh: async () => {},
});

/**
 * Nobody needs an account to complain: the first open signs in
 * anonymously. Adding an email (Me > Account) upgrades that same account,
 * keeping everything it already did.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        if (!u) {
          signInAnonymously(auth).catch((e) => {
            console.warn('Anonymous sign-in failed', e);
            setLoading(false);
          });
          return;
        }
        setUser(u);
        setLoading(false);
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => setProfile(snap.exists() ? (snap.data() as Profile) : null),
      () => setProfile(null),
    );
  }, [user, version]);

  const refresh = async () => {
    await auth.currentUser?.reload();
    await auth.currentUser?.getIdToken(true);
    // reload() updates the same User object in place; the version bump
    // re-renders everyone reading it.
    setUser(auth.currentUser);
    setVersion((v) => v + 1);
  };

  return <AuthContext.Provider value={{ user, profile, loading, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
