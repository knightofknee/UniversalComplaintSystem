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
 * One piece of text with the link on its own last line, on every platform:
 * whatever the person does with it (send, post, Copy then paste somewhere)
 * carries the words and the link together. A separate `url` gets dropped or
 * pasted alone by half the places it can go.
 */
export async function shareLink(message: string, path: string) {
  const url = webUrl(path);
  const text = `${message}\n${url}`;
  if (Platform.OS === 'web') {
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.share) {
      await nav.share({ text }).catch(() => {});
      return;
    }
    await nav?.clipboard?.writeText(text);
    showToast('Copied', 'The words and the link are on your clipboard.', 'info');
    return;
  }
  await Share.share({ message: text }).catch(() => {});
}

const APP_NAME = 'Universal Complaint System';

/** What a shared point reads as wherever it is pasted. */
export function pointShareText(point: { text: string; supportCount: number }) {
  const n = point.supportCount;
  return `“${point.text}”\n${n.toLocaleString()} ${n === 1 ? 'person has' : 'people have'} this problem · ${APP_NAME}`;
}
