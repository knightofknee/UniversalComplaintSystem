import { Platform, Share } from 'react-native';

import { showAlert } from '@/components/point-card';

/**
 * Shared links point at the web version on waldgrave.com, so they open for
 * anyone; where the app is installed, the same link opens the app
 * (universal links / app links, see app.json and src/app/+native-intent.ts).
 */
export const WEB_APP = 'https://www.waldgrave.com/ucs/app';

export const webUrl = (path: string) => `${WEB_APP}${path.startsWith('/') ? path : `/${path}`}`;

export async function shareLink(message: string, path: string) {
  const url = webUrl(path);
  if (Platform.OS === 'web') {
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.share) {
      await nav.share({ text: message, url }).catch(() => {});
      return;
    }
    await nav?.clipboard?.writeText(`${message} ${url}`);
    showAlert('Link copied', url);
    return;
  }
  // iOS shows the url as a link card; Android only takes the message.
  await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message} ${url}` }).catch(() => {});
}
