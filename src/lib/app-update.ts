// Version check for the update prompt (src/components/update-modal.tsx).
// Same design as Brian's other apps (direct-democracy, bekin, Escape from
// Hades IRL).
//
// SOURCE OF TRUTH: our own config/app doc, NOT the store's lookup API. It is
// flipped by hand (npm run set-latest-version) once a release is confirmed
// live in the store, so the Update button never leads to a store page with
// nothing new to install yet.
//
// iOS compares the binary's version (app.json "version", which every iOS
// build bumps). ANDROID compares the build number (versionCode): Android
// builds only bump versionCode, so several Play releases share one version
// name. Each store has its own dials and is flipped when IT serves the build.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { doc, getDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { db } from '@/lib/firebase';

export type AppUpdateInfo = {
  /** The release this build is behind ("1.0.5", or "android build 4"). Keys the snooze. */
  latestVersion: string;
  /** This platform's store listing. */
  storeUrl: string;
  /** Below the floor (minVersion / androidMinBuild): no Maybe later, no snooze. */
  required: boolean;
  /** This release's own words (config/app.updateMessage), for both cards. */
  message?: string;
};

/** True when dotted `latest` is newer than `installed`; garbage on either side is false. */
export function isNewerVersion(latest: string, installed: string): boolean {
  const a = latest.split('.');
  const b = installed.split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] === undefined ? 0 : Number(a[i]);
    const y = b[i] === undefined ? 0 : Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

/** True when whole-number build `target` is above the running one; garbage is false. */
export function isOlderBuild(target: unknown, installed: string | null | undefined): boolean {
  const have = Number(installed);
  if (typeof target !== 'number' || !Number.isInteger(target) || target <= 0) return false;
  if (!installed || !Number.isInteger(have) || have <= 0) return false;
  return have < target;
}

/** The release this build is behind on one dial ('latest' warns, 'min' blocks), or null. */
function behindDial(data: Record<string, unknown>, dial: 'latest' | 'min'): string | null {
  if (Platform.OS === 'android') {
    const target = data[dial === 'latest' ? 'androidLatestBuild' : 'androidMinBuild'];
    return isOlderBuild(target, Application.nativeBuildVersion) ? `android build ${target}` : null;
  }
  const raw = data[dial === 'latest' ? 'latestVersion' : 'minVersion'];
  const target = typeof raw === 'string' ? raw.trim() : '';
  const installed = Application.nativeApplicationVersion;
  return target && installed && isNewerVersion(target, installed) ? target : null;
}

/** Maybe later (or a trip to the store) buys a day of quiet; a newer release asks again at once. */
const SNOOZE_MS = 24 * 3600_000;
const SNOOZE_KEY = 'appUpdate.dismissed';

export async function isSnoozed(version: string): Promise<boolean> {
  try {
    const r = JSON.parse((await AsyncStorage.getItem(SNOOZE_KEY)) ?? 'null');
    return r?.version === version && typeof r.at === 'number' && Date.now() - r.at < SNOOZE_MS;
  } catch {
    return false;
  }
}

export async function snooze(version: string) {
  await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify({ version, at: Date.now() })).catch(() => {});
}

/**
 * Whether a newer release is out for this platform. Null when current, in
 * development, on the web (it deploys with the site and is always current),
 * when this platform has no store link on config/app, or on any failure: an
 * update prompt is never worth an error. config/app is world-readable, so
 * this works before sign-in. Fields:
 *   latestVersion / minVersion            iOS: warn / block, dotted versions
 *   androidLatestBuild / androidMinBuild  Android: warn / block, versionCodes
 *   updateMessage                         this release's line for both cards
 *   iosUrl / androidUrl                   store listings (absent = off)
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  if (__DEV__ || Platform.OS === 'web') return null;
  try {
    const snap = await getDoc(doc(db, 'config', 'app'));
    const data = snap.data();
    if (!data) return null;
    const storeUrl = Platform.OS === 'ios' ? data.iosUrl : data.androidUrl;
    if (typeof storeUrl !== 'string' || !storeUrl) return null;
    const latestVersion = behindDial(data, 'latest');
    if (!latestVersion) return null;
    const message = typeof data.updateMessage === 'string' ? data.updateMessage.trim() : '';
    return { latestVersion, storeUrl, required: !!behindDial(data, 'min'), ...(message ? { message } : {}) };
  } catch {
    return null;
  }
}
