import { Platform, Share } from 'react-native';

import { showToast } from '@/components/toast';

/**
 * Shared links point at the web version on waldgrave.com, so they open for
 * anyone; where the app is installed, the same link opens the app
 * (universal links / app links, see app.json and src/app/+native-intent.ts).
 */
export const WEB_APP = 'https://www.waldgrave.com/ucs/app';

export const webUrl = (path: string) => `${WEB_APP}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Sharing sends the link and nothing else. No message is written for the
 * person: text that arrives in someone's own chat reads as them talking, and
 * they didn't say it. The link's preview card (the complaint as its title,
 * see functions/src/share.ts) carries the content.
 */
export async function shareLink(path: string) {
  const url = webUrl(path);
  if (Platform.OS === 'web') {
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.share) {
      await nav.share({ url }).catch(() => {});
      return;
    }
    await nav?.clipboard?.writeText(url);
    showToast('Link copied', undefined, 'info');
    return;
  }
  // iOS takes a url (and shows it as a link card); Android only takes a message.
  await Share.share(Platform.OS === 'ios' ? { url } : { message: url }).catch(() => {});
}
