import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';

import { setPush } from '@/lib/api';

/**
 * Phone notifications: an organization responded, a status changed, "is it
 * actually fixed?", a reply to a private complaint. Nothing asks for
 * permission until it means something: right after posting or sending
 * privately (once per phone), or the switch in Me. The server
 * (functions/src/push.ts, common.ts sendPush) sends through Expo.
 */
export const pushSupported = Platform.OS !== 'web';

const TOKEN_KEY = 'ucs:pushToken';
const OFFERED = (kind: string) => `ucs:pushOffer:${kind}`;

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Universal Complaint System',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Asks (first time only) and returns this phone's token, or why not. */
async function thisPhone(): Promise<{ token: string } | { error: 'unsupported' | 'denied' }> {
  if (!pushSupported || !Device.isDevice || !projectId()) return { error: 'unsupported' };
  await ensureChannel();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return { error: 'denied' };
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
  return { token: data };
}

export async function turnOnPush(): Promise<'ok' | 'denied' | 'unsupported'> {
  const phone = await thisPhone();
  if ('error' in phone) return phone.error;
  await setPush({ on: true, token: phone.token, platform: Platform.OS });
  await AsyncStorage.setItem(TOKEN_KEY, phone.token).catch(() => {});
  return 'ok';
}

export async function turnOffPush() {
  const token = (await AsyncStorage.getItem(TOKEN_KEY).catch(() => null)) ?? undefined;
  await setPush({ on: false, token });
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
}

const OFFERS = {
  posted: {
    title: 'Get told when it moves?',
    body: 'Your phone will tell you when an organization responds, when it says it fixed it, and when to confirm. You can change this in Me.',
  },
  private: {
    title: 'Get told when they reply?',
    body: 'Your phone will tell you when the organization replies to your private complaint. You can change this in Me.',
  },
};

/** Once per phone per kind, right when a notification would mean something. */
export async function offerPush(kind: keyof typeof OFFERS, alreadyOn: boolean) {
  if (!pushSupported || !Device.isDevice || !projectId() || alreadyOn) return;
  try {
    if (await AsyncStorage.getItem(OFFERED(kind))) return;
    await AsyncStorage.setItem(OFFERED(kind), new Date().toISOString());
  } catch {
    return;
  }
  await new Promise((r) => setTimeout(r, 900));
  Alert.alert(OFFERS[kind].title, OFFERS[kind].body, [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Turn on',
      onPress: () => {
        turnOnPush()
          .then((r) => {
            if (r === 'denied') {
              Alert.alert('Notifications are off', 'Turn them on for this app in your phone’s settings.');
            }
          })
          .catch(() => {});
      },
    },
  ]);
}

/**
 * Keeps this phone's token current (the OS can rotate it) and opens what a
 * tapped notification is about, cold start included.
 */
export function usePush(uid: string | undefined, pushOn: boolean | undefined) {
  useEffect(() => {
    if (!pushSupported || !uid || !pushOn || !projectId()) return;
    (async () => {
      if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;
      const stored = await AsyncStorage.getItem(TOKEN_KEY);
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
      if (data !== stored) {
        await setPush({ on: true, token: data, platform: Platform.OS });
        await AsyncStorage.setItem(TOKEN_KEY, data);
      }
    })().catch(() => {});
  }, [uid, pushOn]);

  useEffect(() => {
    if (!pushSupported || !uid) return;
    const open = (n: Notifications.Notification) => {
      const link = n.request.content.data?.link;
      if (typeof link === 'string' && link.startsWith('/')) router.push(link as Href);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      open(last.notification);
      Notifications.clearLastNotificationResponse();
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification));
    return () => sub.remove();
  }, [uid]);
}
