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
  `EXPO_PUBLIC_USE_EMULATORS=1`.
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
- Every callable is rate limited (`LIMITS` in functions/src/common.ts).
- Secrets: `ANTHROPIC_API_KEY` via `firebase functions:secrets:set`; for the
  emulator put it in `functions/.secret.local` (gitignored).
