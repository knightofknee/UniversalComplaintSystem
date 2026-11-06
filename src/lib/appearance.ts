/**
 * Light or dark, chosen by the app, not the phone: UCS is dark unless the
 * person picks Light or "Match phone" (Me > Appearance). Saved per device.
 *
 * On iOS and Android the choice also goes to `Appearance.setColorScheme`,
 * so native parts (tab bar, alerts, keyboard, pickers) follow it too. On the
 * web there's no such override, so `useScheme` resolves it here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

export type AppearancePref = 'dark' | 'light' | 'system';
export const DEFAULT_APPEARANCE: AppearancePref = 'dark';

const KEY = 'ucs:appearance';
let pref: AppearancePref = DEFAULT_APPEARANCE;
const listeners = new Set<() => void>();

function apply(next: AppearancePref) {
  pref = next;
  if (Platform.OS !== 'web') Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  listeners.forEach((l) => l());
}

/** Called once at startup (the splash covers the read). */
export async function loadAppearance() {
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  apply(saved === 'light' || saved === 'system' || saved === 'dark' ? saved : DEFAULT_APPEARANCE);
}

export function setAppearance(next: AppearancePref) {
  apply(next);
  void AsyncStorage.setItem(KEY, next).catch(() => {});
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppearancePref(): AppearancePref {
  return useSyncExternalStore(subscribe, () => pref, () => DEFAULT_APPEARANCE);
}

/** The scheme actually shown. */
export function useScheme(): 'dark' | 'light' {
  const choice = useAppearancePref();
  const phone = useColorScheme();
  if (choice === 'system') return phone === 'dark' ? 'dark' : 'light';
  return choice;
}

// Before the first render, so nothing flashes light while the saved choice loads.
if (Platform.OS !== 'web') Appearance.setColorScheme(DEFAULT_APPEARANCE);
