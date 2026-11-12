import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { ensureProfile } from '@/lib/api';
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

/**
 * What screens read about who is signed in: a plain copy, made fresh each
 * time anything changes. Firebase changes its User object IN PLACE (linking
 * Google, Apple or an email to the signed-out account, confirming an email),
 * so handing that object to React hid every change: the React Compiler
 * memoizes on identity, and Me kept saying "Not signed in" after a sign-in.
 * For a Firebase call that needs the real user, use `auth.currentUser`.
 */
export type AuthUser = Pick<User, 'uid' | 'isAnonymous' | 'email' | 'emailVerified'> & {
  providerData: { providerId: string }[];
};

function snapshot(u: User | null): AuthUser | null {
  if (!u) return null;
  return {
    uid: u.uid,
    isAnonymous: u.isAnonymous,
    email: u.email,
    emailVerified: u.emailVerified,
    providerData: u.providerData.map((p) => ({ providerId: p.providerId })),
  };
}

type AuthState = {
  user: AuthUser | null;
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [justVerified, setJustVerified] = useState(false);
  const checking = useRef(false);
  /** The account a profile was last asked for, so it is asked for once. */
  const asked = useRef<string | null>(null);

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
        setUser(snapshot(u));
        setLoading(false);
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        setProfile(snap.exists() ? (snap.data() as Profile) : null);
        // No profile yet: a brand-new account. Have the server make it (and
        // its name) now; this listener then hears the new document.
        if (!snap.exists() && !snap.metadata.fromCache && asked.current !== user.uid) {
          asked.current = user.uid;
          ensureProfile({}).catch((e) => console.warn('Could not set up the profile', e));
        }
      },
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
              setUser(snapshot(auth.currentUser));
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
    setUser(snapshot(auth.currentUser));
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
