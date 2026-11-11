import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { auth, db } from '@/lib/firebase';

export type Profile = {
  displayName: string;
  /** This account's opaque public id: what `submissions.authorId` holds for its own complaints. */
  authorId?: string;
  responderFor: string[];
  /** Set once the terms are agreed (with the first post). */
  termsAcceptedAt?: unknown;
  /** Phone notifications on for this account. */
  pushOn?: boolean;
  banned?: boolean;
};

type AuthState = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** Re-read the token (after verifying an email, say). */
  refresh: () => Promise<void>;
  /** The email was just confirmed (noticed on its own); shown once, then cleared. */
  justVerified: boolean;
  clearJustVerified: () => void;
};

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  refresh: async () => {},
  justVerified: false,
  clearJustVerified: () => {},
});

/**
 * Nobody needs an account to complain: the first open signs in
 * anonymously. Signing in (Me > Sign in) attaches an email, Google or Apple
 * to that same account, keeping everything it already did.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [justVerified, setJustVerified] = useState(false);
  const checking = useRef(false);

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

  // Signed in with an email that isn't confirmed yet: look again every few
  // seconds while the app is open (and the moment it comes back to the
  // front), so clicking the link, in any browser on any device, is noticed
  // without anyone having to say so. Stops once it is confirmed.
  const unconfirmed = !!user && !user.isAnonymous && !!user.email && !user.emailVerified;
  useEffect(() => {
    if (!unconfirmed) return;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (stopped || checking.current) return;
      checking.current = true;
      try {
        if (AppState.currentState === 'active') {
          await auth.currentUser?.reload();
          if (auth.currentUser?.emailVerified) {
            // A fresh token carries the confirmed email to the server.
            await auth.currentUser.getIdToken(true);
            if (!stopped) {
              setUser(auth.currentUser);
              setVersion((v) => v + 1);
              setJustVerified(true);
            }
            return;
          }
        }
      } catch {
        // Offline for a moment: the next look will do.
      } finally {
        checking.current = false;
      }
      if (!stopped) timer = setTimeout(check, Date.now() - started < 15 * 60_000 ? 4000 : 30_000);
    };
    timer = setTimeout(check, 4000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      clearTimeout(timer);
      void check();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      sub.remove();
    };
  }, [unconfirmed, version]);

  const refresh = async () => {
    await auth.currentUser?.reload();
    await auth.currentUser?.getIdToken(true);
    // reload() updates the same User object in place; the version bump
    // re-renders everyone reading it.
    setUser(auth.currentUser);
    setVersion((v) => v + 1);
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, refresh, justVerified, clearJustVerified: () => setJustVerified(false) }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
