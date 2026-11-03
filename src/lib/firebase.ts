import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getApps, initializeApp } from 'firebase/app';
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

if (usingEmulators) {
  // Physical devices can't reach "localhost" on the dev machine; use the LAN
  // address Expo already knows.
  const host =
    Platform.OS === 'web' ? 'localhost' : (Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost');
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}
