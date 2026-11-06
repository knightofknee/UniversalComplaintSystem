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
- No account needed: the app signs in anonymously on first open. Adding an
  email (Account screen) links email+password to that same account. A
  VERIFIED email is what lets someone respond for an organization.
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
- Browse: "Most supported" (`supportCount`) and "Rising this week"
  (`weekSupport`: +1 on support, recounted from support timestamps every 6h
  by `recountRising`) are shown side by side at >= 760pt wide, one after
  the other on phones (`PairedLists`). Topics rank by `stats.supporters`.
  Topic pages are a conversation (paired lists + "Who could fix this");
  organization pages are a ledger (stats + one sorted list).
- Intake is two calls: `analyzeComplaint` writes a private draft and shows
  the author everything (matches, new points, PII, rewrite); only
  `submitComplaint` touches the record. Personal data is removed by default;
  the rewrite is opt-in. The most actionable wording of a point becomes its
  headline, credited to its author.
- Fixed is never self-declared: a responder's "Fixed" sets `fix_claimed`;
  supporters confirm (`voteFix`, FIX_CONFIRMATIONS) before it shows Fixed and
  counts in the org's stats.
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
    `submissions.authorId`); either side blocks a private thread
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
    per complaint), synthetic supporters `import:<source>:<id>`, labelled
    `submissions.source`. `npm run usage`, `npm run migrate`,
    `npm run reviewer` (credentials only in gitignored .reviewer.local).
  - Shared links are `https://www.waldgrave.com/ucs/app/...` (src/lib/share.ts);
    `+native-intent.ts` strips the prefix; `npm run publish-web` copies the
    web export into ../../Documents/GitHub/the-waldgrave/public/ucs/app.
  - "Same here" (never "Me too") is the support button.
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
