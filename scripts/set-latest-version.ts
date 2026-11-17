/**
 * The update prompt's dials (src/lib/app-update.ts), on config/app. Flip a
 * store's dial only once THAT store serves the build, so Update never opens
 * a page with nothing new to install.
 *
 *   npm run set-latest-version -- 1.0.5                  iOS: older versions are asked to update
 *   npm run set-latest-version -- --android-latest 4     Android: builds before versionCode 4 are asked
 *   npm run set-latest-version -- 1.0.5 --message "..."  this release's line on both cards
 *   npm run set-latest-version -- --message ""           back to the built-in words
 *
 * Floors lock out builds too old to work (no Maybe later), only when a
 * change on the server would break them; never above the latest:
 *
 *   npm run set-latest-version -- --min-version 1.0.5    iOS
 *   npm run set-latest-version -- --android-min 4        Android ("" lifts either floor)
 *
 * Store links, set once at each store's first public release; a platform
 * with no link never prompts:
 *
 *   npm run set-latest-version -- --ios-url https://apps.apple.com/app/id<number>
 *   npm run set-latest-version -- --android-url https://play.google.com/store/apps/details?id=com.waldgrave.ucs
 *
 * With no arguments it prints the doc as it is.
 */
process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';

const argv = process.argv.slice(2);
/** A flag's value: null when the flag is absent, '' when it is given as "". */
function flag(name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? '' : v;
}
const VALUED = new Set(['message', 'min-version', 'android-latest', 'android-min', 'ios-url', 'android-url']);
const version = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.has(argv[i - 1].slice(2))));

const dotted = (v: string) => /^\d+(\.\d+)*$/.test(v);
const build = (v: string) => /^[1-9]\d*$/.test(v);
function compare(a: string, b: string) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
function fail(m: string): never {
  console.error(m);
  process.exit(1);
}

async function main() {
  const { db, FieldValue } = await import('../functions/src/common');
  const ref = db.doc('config/app');
  const current = (await ref.get()).data() ?? {};
  const update: Record<string, unknown> = {};

  if (version) {
    if (!dotted(version)) fail(`Not a version: ${version}`);
    update.latestVersion = version;
  }
  const min = flag('min-version');
  if (min !== null) {
    if (min && !dotted(min)) fail(`Not a version: ${min}`);
    update.minVersion = min || FieldValue.delete();
  }
  const aLatest = flag('android-latest');
  if (aLatest) {
    if (!build(aLatest)) fail(`Not a build number: ${aLatest}`);
    update.androidLatestBuild = Number(aLatest);
  }
  const aMin = flag('android-min');
  if (aMin !== null) {
    if (aMin && !build(aMin)) fail(`Not a build number: ${aMin}`);
    update.androidMinBuild = aMin ? Number(aMin) : FieldValue.delete();
  }
  const message = flag('message');
  if (message !== null) update.updateMessage = message.trim() || FieldValue.delete();
  for (const [f, key] of [['ios-url', 'iosUrl'], ['android-url', 'androidUrl']] as const) {
    const url = flag(f);
    if (url === null) continue;
    if (!/^https:\/\//.test(url)) fail(`Not a link: ${url || '(empty)'}`);
    update[key] = url;
  }

  if (Object.keys(update).length) {
    const floor = min ?? (current.minVersion as string | undefined) ?? '';
    const latest = version ?? (current.latestVersion as string | undefined) ?? '';
    if (floor && (!latest || compare(floor, latest) > 0)) fail(`The floor ${floor} is above the latest ${latest || '(unset)'}.`);
    const aFloor = aMin !== null ? Number(aMin || 0) : Number(current.androidMinBuild ?? 0);
    const aTop = aLatest ? Number(aLatest) : Number(current.androidLatestBuild ?? 0);
    if (aFloor && aFloor > aTop) fail(`The Android floor ${aFloor} is above the latest ${aTop || '(unset)'}.`);
    await ref.set(update, { merge: true });
  }
  console.log('config/app:', (await ref.get()).data() ?? '(empty)');
}

main().then(
  () => process.exit(0),
  (e) => fail(String(e?.stack ?? e)),
);
