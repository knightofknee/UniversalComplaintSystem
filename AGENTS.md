# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Universal Complaint System (UCS) - project notes

Open source, public repo. Never commit secrets (see the last bullet).
Product spec: docs/SPEC.md. Same stack and conventions as ../direct-democracy.

- App name is "Universal Complaint System" (no "The"). Bundle ID / Android
  package `com.waldgrave.ucs`. Web export lives at waldgrave.com/ucs/app
  (`npm run export-web`).
- Expo SDK 57 + expo-router (screens in `src/app/`), TypeScript strict,
  Firebase JS SDK. Firebase project `universal-complaint-system` (Blaze).
  `src/lib/firebase.ts` holds the LIVE config; emulators only with
  `EXPO_PUBLIC_USE_EMULATORS=1`. UCS's emulator ports are its own (UI 4010,
  auth 9109, firestore 8180, functions 5011, storage 9209) so they never
  clash with ../direct-democracy's; keep firebase.json and firebase.ts in
  sync.
- No account needed: the app signs in anonymously on first open. SIGNING IN
  (2026-11-10; never "add an email") attaches Apple, Google or
  email+password to that same account (src/lib/sso.ts, src/app/account.tsx:
  a row of two compact buttons, the logo and one word, "Google" | "Apple",
  the same style as the user's other apps and never "Continue with ...";
  then "Sign up" | "I have an account" for email). If that identity already has an account it signs in to it
  instead AND THE DEVICE'S SIGNED-OUT ACTIVITY MOVES INTO IT (`switchAccount`
  in sso.ts, `mergeAccount` in functions/src/merge.ts: complaints, support,
  votes, fixes, ratings; duplicates count once; the anonymous account is
  deleted). Every path that signs in to an existing account must go through
  `switchAccount`, or a just-posted complaint is stranded. Google and Apple are enabled in Firebase Auth; Google client ids
  are in sso.ts and the config files; Apple works on iOS only (the web
  needs an Apple Services ID and key, not set up). The native modules
  (expo-apple-authentication, @react-native-google-signin) need a build
  made after 2026-11-10. A VERIFIED email is what lets someone respond for
  an organization. Me says "Not signed in." plainly. Deleting an account is
  its own screen (Me > Delete account, /delete-account), never on the
  sign-in page.
- Names (functions/src/names.ts): random two-word names from the lists in
  common.ts, never typed. Me shows the name with a shuffle button
  (`NameChanger`): shuffle through `nameOptions`, nothing changes until
  "Use this name" and its confirmation (`setName`, which renames past
  complaints and fixes too). `users.authorId` lets the app mark what is
  the account's own ("Yours").
- Clients never write the public record. Everything goes through callables
  in `functions/src` (intake.ts, points.ts, company.ts); firestore.rules
  allow only reads (plus marking own notifications read).
- Data model: `subjects` (organization | topic), `points` (atomic things
  wrong; the unit of support, status, response), `submissions` (a person's
  words, kept as written; `matchedPointIds` / `addedPointIds` record what
  the model did). Who supports what (`points/{id}/supports/{uid}`) and who
  responds for an org (`subjects/{id}/responders/{uid}`) are private.
- AI: Gemini embeddings (Vertex, 768 dims) on every point and subject for
  vector search; Claude (`CLAUDE_MODEL` in functions/src/ai.ts) does intake
  with structured output. The model may only reference candidates it was
  shown (enforced after the call). Every model-made change is labeled in the
  UI ("New point · added by the model").
- Tags (2026-11-02): every point is filed under its organizations AND at
  least one topic (a kind of problem, never containing an org name, e.g.
  "Checked bag fees"); every subject has one of the fixed `CATEGORIES`
  (functions/src/categories.ts, mirrored in src/lib/categories.ts). Points
  carry denormalized `topicIds` and `categories` for browsing. The model
  tags; the author can untag or add EXISTING subjects at review ("Filed
  under"), never invent one. Tags are only ever added to an existing point.
- Design (2026-11-06, the user's direction): COMPLAINING FIRST. `/` is the
  composer (src/components/composer.tsx, `<Composer home />`), a screen of
  its own with NO tab bar, where the app opens; the tabs sit under it
  (`unstable_settings.initialRouteName = "(tabs)"`) so its menu button
  (top left) always lands on the Complaints tab (2026-11-10; it used to go
  back to whichever tab was open), and the "New" tab
  (far left, a plus) pushes it over the tabs again. THE SCREEN IS THE BOX
  (2026-11-09): two bare icons (menu, "?" to `/help`), then one bordered
  text box that runs down to the keyboard (keyboard open on arrival; to the
  bottom of the screen when it is down; capped at 460pt only in windows
  700pt+ wide). Everything else is INSIDE the box: placeholder "What could
  be better?", photo thumbnails, one live line (peppers + the single nudge
  from src/lib/read.ts; a nudge fires only on a pattern that clearly shows
  something is missing, never on a guess, and says nothing for non-English
  text; `npm run read-audit` types sample complaints word by word and runs
  the regression checks, run it after any change there), a "+" for photos (iOS action sheet: camera or
  library) and the "Next" pill. No bottom bar, no logo, no blurb, no lists
  on this screen: similar complaints show after Next, as the matches in the
  review. The keyboard overlap is measured (`useKeyboard`), not
  KeyboardAvoidingView, so it is right with or without a header. Copy is
  plain and never prompts what the complaint is about. The root Stack
  mounts only after the fonts load (tab labels measured in the fallback
  face truncate). Next runs the model and the review replaces the box on
  the same route; nothing posts until "Post it".
  Spice (2026-11-07): every complaint gets 1-5 peppers for how heated the
  LANGUAGE is (not the problem): on-device guess while typing
  (src/lib/read.ts, name-calling regex = 5), the model's `spice` is final.
  5 = insults/slurs at people (workers included) and never posts
  (`submitComplaint` refuses, even privately); the review shows "Over the
  line" with `spiceReason` and 2-3 `alternatives` (same heat, no
  name-calling, one funny) the author can tap in. Swearing at a company is
  3-4 and fine. `submissions.spice` is stored. The intake output schema
  (functions/src/ai.ts) is near Anthropic's grammar size limit: keep
  `.describe()` strings terse and put guidance in INTAKE_SYSTEM "Fields";
  check with a 2-token parse call before deploying a schema change.
  Copy is fun and pushes toward improvement, not criticism. Errors are
  inline lines or toasts (`showToast`, src/components/toast.tsx), never
  pop-up alerts, never codes (`errorText` in src/lib/api.ts).
- POTENTIALLY MISSING (2026-11-10): recommended, never required, in three
  places. (1) While typing, src/lib/read.ts asks for a product's make and
  model ("Which laptop? The make and model help, if you know them.") only
  for a thing of their own with none on it ("my laptop", never "my phone
  bill" or "the printer"), after the fix question. (2) At Next the model
  returns `missing` (up to three absent details; it REPLACED `coaching`,
  because the output grammar had no room for both) and the review lists
  them with "Go back and add". (3) After posting they are kept on
  `users/{uid}/mine/{id}.missing`, shown only to the author on their own
  complaint, where each can be answered in one line (`addDetail`,
  functions/src/details.ts; `submissions.details`, shown as "Added: ...")
  or dismissed (dismissed ones are never suggested again). EVERY ADDED
  DETAIL HAS THE MODEL RE-READ THE WHOLE COMPLAINT (`rereadWithDetail` in
  intake.ts): the detail is checked and personal data taken out of it; the
  complaint's points gain the subjects it names (tags only added); a point
  that is this complaint's alone is reworded to the sharper statement, while
  a point other people share keeps its headline unless the usual rule
  allows; `missing` is worked out afresh. It never creates a point or moves
  support: the model's "new angle" statement is folded into the closest of
  the complaint's own points (REREAD_SAME_POINT). If the model can't run,
  the detail is still added after plain filters. `npm run fix-test` covers
  the callable; one line, 5 details at most.
- KEYBOARDS (2026-11-10): every text field has an obvious way to put the
  keyboard away: a bar on top of it with a hide button
  (`useKeyboardBar`, src/components/keyboard-bar.tsx; `Field` has it built
  in, any bare TextInput must add it). One bar per field: a shared one only
  attaches to the first field. Scrolling a `Screen` dismisses it too.
- TRANSITIONS (2026-11-10): tabs switch with no animation (peers); going
  deeper slides sideways (the stack default); the complaint box is a task
  that covers the tab bar, so it rises from the bottom and drops back down
  (`slide_from_bottom` on `index`), never sideways. What is typed in the
  main box survives leaving it (`keptDraft` in composer.tsx).
- Pop-ups (name change, report, "Your complaint is live") sit on a 72% dim
  with their own surface and border, so their words never run into the
  page's.
- Lists: flush rows with hairlines (`PointList` + `PointCard`) and a compact
  vote box on the right (`Vote`: arrow over count). The big one
  (`SupportButton`) is only on a point's own page. SUPPORT HAS NO WORDS
  (2026-11-09): the up arrow and a count, nothing else. "Same here" is
  retired, like "Me too" before it; in prose say "support". A point's page
  has no header title (blank beats "Point").
- TWO SEPARATE VOTES (2026-11-09). The arrow on a POINT means "I have this
  problem too" (`supportPoint`). "🤬 Best rant" on a COMPLAINT means "I
  loved reading this" (`loveRant`, functions/src/rants.ts;
  `submissions/{id}/loves/{uid}` private, `submissions.loves` public).
  `BestRantButton` is the wide, enticing button on every complaint card
  (`SubmissionCard`), with report and hide as bare icons pushed right.
  Never on an imported record; authors may vote for their own.
- PEOPLE OVER IMPORTS (2026-11-09, the user's direction): the imported
  public records are seed data that will eventually stop being shown, so a
  complaint a person made always outranks them. Points carry `people` /
  `weekPeople` (support from real accounts only; imported supporter ids
  contain ":") and `imported` (seeded from a public record). Every list
  sorts by real people first, then person-raised before imported, then the
  old count. `rantRank` on submissions does the same for Best rants
  (votes x1000, +100 if a person wrote it, + the model's `rantScore`; 0 =
  not listed). Best rants shows voted rants; until 10 have a vote it is
  topped up with rants the model scored 7+ (`rantScore`, 1-10, only rants
  get one), labeled "Model's pick". New fields on old data:
  `npm run migrate ranks`.
- Complaints (`/browse`, tabs: New → `/`, Complaints, Search, Me) sorts by
  🔥 Hot (`weekPeople`, `imported`, `weekSupport`; recounted every 6h by
  `recountRising`), 🤬 Best rants (submissions by `rantRank`), 🏆 Top
  (`people`, `imported`, `supportCount`; never "Most shared"), ✅ Fixed,
  🆕 New (`imported`, `createdAt`). A sort is its name and nothing else: no
  line of description under it. Empty lists say "Nothing here yet." with
  no joke and no finger pointed at anyone (2026-11-10).
- AFTER POSTING (2026-11-10) there is no "Posted" screen: the box clears
  and they land on Me, where that complaint is scrolled
  to and marked "Just posted" (a mark only; the row works as any other;
  the id is held in src/lib/just-posted.ts, never in the address).
  Signed out, a prompt says the complaint is live without an account and
  that signing in keeps the history (once per post). Private and queued
  complaints keep their own after-screens.
- Me lists "Your complaints" as ONE list, public and private in the same
  row form (a globe or lock label), newest activity first; there is no
  separate private-complaints screen. No category browsing and no
  "biggest topics" grid: topics are tags on points, reachable from them.
  Topic and organization pages use the same sorts. Search opens on "Most
  complained about" (subjects by supporters). The small Companies / Topics
  / Both pick sits under the search box and is ALWAYS visible, with or
  without results; it filters the list and the pages in search results.
- Type: Bricolage Grotesque (`Fonts` in src/constants/theme.ts) for titles,
  the complaint box and counts; the system face for reading.
- Intake is two calls: `analyzeComplaint` writes a private draft and shows
  the author everything (matches, new points, PII, rewrite); only
  `submitComplaint` touches the record. Personal data is removed by default;
  the rewrite is opt-in. The most actionable wording of a point becomes its
  headline, credited to its author.
- Fixed is never self-declared: a responder's "Fixed" sets `fix_claimed`;
  supporters confirm (`voteFix`, FIX_CONFIRMATIONS) before it shows Fixed and
  counts in the org's stats.
- Proposed fixes (2026-11-10, functions/src/solutions.ts,
  src/components/solutions.tsx): ANYONE can propose a fix on a point
  (`proposeFix`; `points/{id}/solutions/{authorId}`, one per person per
  point), not only an organization. Supporters are notified and each rates
  it fully / partly / not at all (`rateFix`, private `ratings/{uid}`,
  public tallies). The point shows Fixed (`fixedBy`) only when enough people
  who supported it BEFORE the fix was proposed say "fully" and outnumber
  the rest (`settleFix`); it never touches an org's stats. No model reads a
  fix: `nameCalling` and `stripSensitive` filter it, it needs the terms,
  and it can be reported and removed like anything else.
- Org access: `requestAccess` approves at once if the email domain is
  already on the subject; otherwise `checkClaims` (daily) matches the domain
  to the org website, and anything unconfirmed is held for
  `npm run review-claims`. `restrictedTo` on a subject limits responders to
  listed emails (their responses read "Official").
- Independence rules (docs/SPEC.md): orgs respond, never remove or edit;
  removals only via `npm run remove`, which logs to the public `removals`.
- Private complaints (2026-11-05, functions/src/private.ts): only to an
  ORGANIZATION (topics are public by definition), only from a verified
  email. They are support conversations: `subjects/{org}/inbox/{thread}`
  (+ `messages`), readable only by the author and the org's responders;
  the author's index is `users/{uid}/threads`. Personal details stay in
  them; card numbers, ID numbers and passwords are removed everywhere
  (model's `pii.sensitive` on intake, `stripSensitive` on messages). Each
  point a private complaint raises adds to the org's
  `subjects/{org}/privatePoints` (linked to a public point via `pointId`,
  or `isPrivateOnly` with its own embedding). NOTHING public moves:
  support, weekSupport, topic supporters and org stats count public
  complaints only. A public complaint matching a private-only point
  promotes it (`promotePrivatePoint`); public authors get a yes/no "raised
  privately" hint (search + analysis), never a count, and never a private
  id (the analysis copy sent to the app is scrubbed). Private complaints
  never create public topics. An org can publish its private COUNTS
  (`publishPrivate`, Settings > Advanced): points then carry
  `privateCounts.{org}` and private followers may confirm fixes. Private
  TEXT is never published. Unclaimed orgs: the thread is held.
- AI cost guardrails: every callable is rate limited per account AND per
  hashed network address (`LIMITS` / `IP_LIMITS` in functions/src/common.ts,
  since anonymous accounts are free to make); every Claude call checks and
  records a daily dollar ceiling (functions/src/budget.ts,
  `config/ai.dailyBudgetUsd`, default $25; spend in `usage/{date}`), with
  `max_tokens` 6000 and junk text rejected before the model. Past the
  ceiling only complaint checking pauses.
- App Check (2026-11-05) is ENFORCED on every callable (`CALLABLE` in
  functions/src/common.ts; skipped in the emulators). Web: reCAPTCHA
  Enterprise (site key in src/lib/firebase.ts). iOS: App Attest (team
  R3H7M2M4F5, entitlement in app.json). Android: Play Integrity, which still
  needs the release SHA-256 on the Firebase Android app and the Play Console
  app linked to the Cloud project. Development (localhost, simulators)
  sends the debug token in the gitignored `.env.local`
  (EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN), registered for all three apps.
- Exactly ONE copy of the Firebase web SDK, or App Check sends tokens the
  server can't decode and static web rendering fails ("Component auth has
  not been registered"): package.json `overrides` gives
  @react-native-firebase/app the app's own `firebase`, and the app has no
  firebase-admin dependency (scripts use functions/'s). Check with
  `npm ls @firebase/app` (one version).
- React Native Firebase is pinned to 26 (CocoaPods). 27 requires Swift
  Package Manager and dynamic frameworks. iOS uses static frameworks
  (expo-build-properties); plugins/with-rnfirebase-no-spm.js is shared with
  ../direct-democracy. `pod install` needs a UTF-8 locale
  (`LANG=en_US.UTF-8`) under Ruby 3.4.
- Testing native builds: use a simulator of our own, never one already
  booted (that's the developer's), and Metro on port 8095. EAS builds are
  the developer's.
- Pre-submission build (2026-11-05), see docs/AUDIT.md:
  - **Moderation** (functions/src/moderation.ts): Report on everything
    (`report` → `reports`, never auto-hides), operator queue in the app
    (`/operator`, only OPERATOR_EMAIL verified; mirrored in firestore.rules
    and src/lib/operator.ts), Remove / Remove + suspend (`users.banned`,
    enforced in `ensureUser`), public `removals` log. Cloud Vision SafeSearch
    on every photo; `safety.unsafe` from the model blocks posting;
    `badSubjectName` filters new subject names.
  - **Terms**: first post/message/response/claim needs `acceptTerms`
    (`requireTerms`; `users.termsAcceptedAt`), shown by `TermsCheck`.
  - **Block**: readers hide authors (`users/{uid}/blocks`, opaque
    `submissions.authorId`). Hidden means FOLDED SHUT, never gone
    (2026-11-09): a one-line row reading "Hidden by you" and "Show", with
    NO author name until it is opened, so you can see someone you hid
    weighed in and open it if you want. Either side blocks a private thread
    (`blockedBy`). Who wrote what is server-only in `authors/{id}`.
  - **Fixes are per organization** (`points.orgStatus.{orgId}`); only
    supporters from before `fixClaimedAt` confirm; `fixVotes/{orgId}_{uid}`.
    Point `status`/`statusBy` mirror the latest change.
  - **Never lost**: past the AI budget, complaints go to `queue`
    (`processQueue` hourly, then a `draft` notification → `/complain?draft=`).
    Search and intake embeddings have separate daily caps (`countCall`).
  - **Private-only points are matched by vector only**, after the model runs
    (`privateMatches` in the draft); private text never goes to the model.
  - **Headlines** change only if the new wording is close in meaning
    (cosine < 0.15) and clearly more actionable; credited "Summarized from".
  - **Push**: expo-notifications, `setPush` (push.ts), `notify` sends to
    `users.pushTokens` when `pushOn`. Point news fans out at most every 6h
    (`notifyPointFollowers`, `flushNotices`). Needs `extra.eas.projectId`
    (from `eas init`) or the app silently offers nothing.
  - **Hidden organizations**: a private complaint to a new org creates it
    `removed: true, pendingPublic: true`; a public complaint or an approved
    claim makes it public. `restrictedTo` lives in `restricted/{id}`.
  - **Public-record seed**: `npm run import` (CFPB grouped by issue, NHTSA
    per complaint, FCC grouped by issue as topic-only points; CPSC needs an
    API key we don't have, never scrape it), each agency's caveat in
    `source.note`, synthetic supporters `import:<source>:<id>`, labelled
    `submissions.source`. `npm run usage`, `npm run migrate`,
    `npm run reviewer` (credentials only in gitignored .reviewer.local).
  - Shared links are `https://www.waldgrave.com/ucs/app/...` (src/lib/share.ts);
    `+native-intent.ts` strips the prefix; `npm run publish-web` copies the
    web export into ../../Documents/GitHub/the-waldgrave/public/ucs/app.
  - Sharing (`shareLink`) sends THE LINK AND NOTHING ELSE (2026-11-09, the
    user's direction): never write a message for the person, because pasted
    text reads as them talking. The preview card carries the content. Link previews: the site sends /ucs/app/point|subject|
    submission/<id> through the-waldgrave/pages/api/ucs/share.js, which asks
    the public `linkPreview` function (functions/src/share.ts, no App Check)
    for a title and description and writes them into the page for preview
    fetchers only; people get the plain page with no wait. iOS universal
    links are live (AASA on the site + `associatedDomains`); Android needs
    UCS added to the site's assetlinks.json once the release SHA-256 exists.
  - The suggested rewrite is posted as written, so it can never contain a
    blank to fill in: the prompt forbids it and `hasPlaceholder`
    (functions/src/ai.ts) drops any that slips through. Never call it
    "sharper"; the option reads "Post this wording instead" / "Edit it first".
- Appearance (2026-11-06): DARK is the default, chosen by the app, not the
  phone (src/lib/appearance.ts; Me > Appearance: Dark / Light / Match phone,
  saved per device). Native: `Appearance.setColorScheme`, so the tab bar,
  alerts and keyboard follow. Every color comes from src/constants/theme.ts;
  never hardcode one. `primary` is for text/icons/outlines, `primaryFill`
  for solid buttons (in dark they differ so both stay readable). The splash
  is dark in both phone modes.
- Account deletion (`deleteAccount`, functions/src/account.ts) does exactly
  what src/app/privacy.tsx promises; change both together. The privacy
  policy and terms (src/app/privacy.tsx, terms.tsx) are ours to keep
  accurate whenever behavior changes.
- Secrets: `ANTHROPIC_API_KEY` via `firebase functions:secrets:set`; for the
  emulator put it in `functions/.secret.local` (gitignored).
