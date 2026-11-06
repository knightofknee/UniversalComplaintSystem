/**
 * Shared links point at the web version on waldgrave.com, under this base
 * path (/ucs/app/point/abc). When the app is installed and the link opens
 * it, drop the base path and route to the same screen.
 */
const WEB_APP_PATH = '/ucs/app';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const web = path.indexOf(WEB_APP_PATH);
  if (web >= 0) return path.slice(web + WEB_APP_PATH.length) || '/';
  return path;
}
