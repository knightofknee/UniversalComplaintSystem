import {
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  OAuthProvider,
  signInWithCredential,
  type AuthCredential,
  type AuthProvider,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { mergeAccount } from '@/lib/api';
import { auth } from '@/lib/firebase';

/**
 * Sign in with Google or Apple.
 *
 * Everyone starts with an anonymous account, so signing in is first an
 * attempt to attach the Google/Apple identity to that same account (nothing
 * this device did is lost). If that identity already has a UCS account, it
 * signs in to it instead, and what this device did while signed out is
 * moved into that account (`switchAccount`).
 *
 * Client ids are identifiers, not secrets (they are in the app's config
 * files too). The web client id is the one Firebase verifies tokens against.
 */
const GOOGLE_WEB_CLIENT_ID = '331431699365-ncvmkp2tu0rughge3vsgq1q5vqnn00ks.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = '331431699365-kpe37b62dlo7ij9bes558hogd85l5emo.apps.googleusercontent.com';

/** Apple on the web needs a Services ID and key from the Apple developer account, which isn't set up. */
export const appleAvailable = Platform.OS === 'ios';
export const googleAvailable = true;

/** The person closed the sheet or popup: not an error worth showing. */
export class Cancelled extends Error {}

const TAKEN = ['auth/credential-already-in-use', 'auth/email-already-in-use'];
const CLOSED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];
const codeOf = (e: unknown) => (e as { code?: string })?.code ?? '';

/**
 * Switch from the device's signed-out account to an existing one, bringing
 * over what the signed-out one did (the complaint just posted, say). The
 * server needs proof of the account being left, so its token is taken before
 * the switch. A failed move never undoes the sign-in.
 */
export async function switchAccount(signIn: () => Promise<unknown>) {
  const leaving = auth.currentUser;
  const fromToken = leaving?.isAnonymous ? await leaving.getIdToken().catch(() => null) : null;
  await signIn();
  if (fromToken) await mergeAccount({ fromToken }).catch((e) => console.warn('Could not bring this device\'s activity over', e));
}

async function applyCredential(credential: AuthCredential, fromError: (e: never) => AuthCredential | null) {
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    try {
      await linkWithCredential(user, credential);
      return;
    } catch (e) {
      if (!TAKEN.includes(codeOf(e))) throw e;
      // An Apple token can be used once; the error carries one that still works.
      await switchAccount(() => signInWithCredential(auth, fromError(e as never) ?? credential));
      return;
    }
  }
  await signInWithCredential(auth, credential);
}

async function popup(provider: AuthProvider, fromError: (e: never) => AuthCredential | null) {
  const user = auth.currentUser;
  try {
    if (user?.isAnonymous) {
      try {
        await linkWithPopup(user, provider);
        return;
      } catch (e) {
        if (!TAKEN.includes(codeOf(e))) throw e;
        const existing = fromError(e as never);
        if (!existing) throw e;
        await switchAccount(() => signInWithCredential(auth, existing));
        return;
      }
    }
    const { signInWithPopup } = await import('firebase/auth');
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (CLOSED.includes(codeOf(e))) throw new Cancelled();
    throw e;
  }
}

export async function continueWithGoogle() {
  const fromError = (e: never) => GoogleAuthProvider.credentialFromError(e);
  if (Platform.OS === 'web') return popup(new GoogleAuthProvider(), fromError);
  // The native module is only in builds made after it was added.
  const { GoogleSignin, isSuccessResponse } = await import('@react-native-google-signin/google-signin').catch(() => {
    throw new Error('Update the app to sign in with Google.');
  });
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  if (!isSuccessResponse(result)) throw new Cancelled();
  const idToken = result.data.idToken;
  if (!idToken) throw new Error("Google didn't finish signing you in. Try again.");
  await applyCredential(GoogleAuthProvider.credential(idToken), fromError);
}

export async function continueWithApple() {
  const fromError = (e: never) => OAuthProvider.credentialFromError(e);
  if (Platform.OS === 'web') return popup(new OAuthProvider('apple.com'), fromError);
  const [Apple, Crypto] = await Promise.all([import('expo-apple-authentication'), import('expo-crypto')]).catch(() => {
    throw new Error('Update the app to sign in with Apple.');
  });
  // Apple gets the hash; Firebase gets the original and checks they match.
  const rawNonce = Crypto.randomUUID();
  const nonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let identityToken: string | null;
  try {
    ({ identityToken } = await Apple.signInAsync({
      requestedScopes: [Apple.AppleAuthenticationScope.EMAIL],
      nonce,
    }));
  } catch (e) {
    if (codeOf(e) === 'ERR_REQUEST_CANCELED') throw new Cancelled();
    throw e;
  }
  if (!identityToken) throw new Error("Apple didn't finish signing you in. Try again.");
  await applyCredential(new OAuthProvider('apple.com').credential({ idToken: identityToken, rawNonce }), fromError);
}
