import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getApps, initializeApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  connectAuthEmulator,
  getAuth,
  // @ts-expect-error - getReactNativePersistence is missing from the SDK's public types on some versions
  getReactNativePersistence,
  initializeAuth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

/**
 * Live config for universal-complaint-system. Firebase web API keys are
 * identifiers, not secrets: access control lives in firestore.rules and
 * storage.rules, and every write goes through a Cloud Function.
 *
 * Local development against the Emulator Suite:
 *   npm run emulators                              (one terminal)
 *   EXPO_PUBLIC_USE_EMULATORS=1 npx expo start     (another)
 * A bare `npx expo start` talks to production.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyCpx5Trl_EKVR7J7gqVOOsx6IKF-bnLuc4',
  authDomain: 'universal-complaint-system.firebaseapp.com',
  projectId: 'universal-complaint-system',
  storageBucket: 'universal-complaint-system.firebasestorage.app',
  messagingSenderId: '331431699365',
  appId: '1:331431699365:web:3e6eb03161b3727fe47e4c',
};

export const usingEmulators = process.env.EXPO_PUBLIC_USE_EMULATORS === '1';

const app = getApps()[0] ?? initializeApp(firebaseConfig);

export const auth =
  Platform.OS === 'web'
    ? getAuth(app)
    : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
export const db = getFirestore(app);
export const functions = getFunctions(app, 'us-central1');
export const storage = getStorage(app);

/**
 * App Check: proves calls come from the real app, so a script holding the
 * public config above can't run up AI costs. Every Cloud Function enforces
 * it (functions/src/common.ts CALLABLE); the emulators don't.
 *
 * Release builds attest for real: reCAPTCHA Enterprise on the web, App
 * Attest on iOS, Play Integrity on Android. Development builds, simulators
 * and localhost present a debug token instead
 * (EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN in the gitignored .env.local), registered
 * in Firebase console > App Check > Manage debug tokens.
 *
 * Registration is synchronous, at module load, before anything can call a
 * function; only the token getter is async.
 */
const RECAPTCHA_ENTERPRISE_SITE_KEY = '6LdL-BEuAAAAADlSKkadF-C2d9rMBP8UTDTgywZl';
// Development only: in release bundles __DEV__ is false, so this whole
// expression (and the token string) is compiled out. Never reference the
// variable outside a __DEV__ check, or it ships inside the app.
const debugToken = __DEV__ ? process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN : undefined;

// The `document` check skips static rendering, where reCAPTCHA can't load.
if (!usingEmulators && Platform.OS === 'web' && typeof document !== 'undefined') {
  if (__DEV__) {
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken ?? true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

// Native attestation comes from the native module; a CustomProvider hands
// its tokens to this web SDK so every call carries one.
if (!usingEmulators && Platform.OS !== 'web') {
  const native = (async () => {
    const rnfbApp = await import('@react-native-firebase/app');
    const rnfbAppCheck = await import('@react-native-firebase/app-check');
    const provider = new rnfbAppCheck.ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      apple: { provider: __DEV__ ? 'debug' : 'appAttest', ...(debugToken ? { debugToken } : {}) },
      android: { provider: __DEV__ ? 'debug' : 'playIntegrity', ...(debugToken ? { debugToken } : {}) },
    });
    const instance = await rnfbAppCheck.initializeAppCheck(rnfbApp.getApp(), {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
    return { rnfbAppCheck, instance };
  })();
  native.catch((e) => console.warn('App Check attestation is not active:', e));
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => {
        const { rnfbAppCheck, instance } = await native;
        const { token } = await rnfbAppCheck.getToken(instance, false);
        return { token, expireTimeMillis: Date.now() + 30 * 60 * 1000 };
      },
    }),
    isTokenAutoRefreshEnabled: true,
  });
}

// Emulator ports (firebase.json) are UCS's own, so they never clash with
// ../direct-democracy's emulators running at the same time.
if (usingEmulators) {
  // Physical devices can't reach "localhost" on the dev machine; use the LAN
  // address Expo already knows.
  const host =
    Platform.OS === 'web' ? 'localhost' : (Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost');
  connectAuthEmulator(auth, `http://${host}:9109`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8180);
  connectFunctionsEmulator(functions, host, 5011);
  connectStorageEmulator(storage, host, 9209);
}
