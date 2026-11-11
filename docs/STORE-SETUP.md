# Store setup: App Store Connect and Google Play

Everything you do by hand to get Universal Complaint System into both stores,
in order. Code-side work is listed in [AUDIT.md](AUDIT.md); the store steps
assume those fixes are in. Contact and admin email everywhere:
bricarlis@gmail.com.

Identifiers you'll need:

| What | Value |
| --- | --- |
| App name | Universal Complaint System (26 of 30 characters) |
| Bundle ID / package | `com.waldgrave.ucs` |
| Apple team | R3H7M2M4F5 |
| Firebase project | `universal-complaint-system` |
| Firebase iOS app | `1:331431699365:ios:c78ac8015dde13f6e47e4c` |
| Firebase Android app | `1:331431699365:android:193835af95cc5648e47e4c` |
| Privacy policy | https://www.waldgrave.com/ucs/privacy |
| Terms | https://www.waldgrave.com/ucs/terms |
| Support | https://www.waldgrave.com/ucs/support |
| Account deletion (Play) | https://www.waldgrave.com/ucs/delete-account |

---

## 0. Before either store

### 0a. The website (done, Claude deploys it)

The pages in the table above, the web version at
https://www.waldgrave.com/ucs/app and the universal-link file are live on
waldgrave.com (Waldgrave commit b8c13b64, deployed to Heroku 2026-11-06).
Whenever the app or these pages change, Claude runs `npm run publish-web` here,
commits in ~/Documents/GitHub/the-waldgrave and runs `git push heroku main`.
Nothing for you to do.

### 0b. Link the EAS project (once, about a minute)

Push notifications need an EAS project id in app.json; until it's there the
app never offers them. You're logged in to EAS as **knightofknee**.

```bash
cd ~/repos/UniversalComplaintSystem
```

```bash
eas init
```

What it asks, and what to answer:

1. **"Would you like to create a project for @knightofknee/universal-complaint-system?"**
   Yes (Enter).
2. Only if you belong to more than one Expo account or organization:
   **"Which account should own this project?"** Pick **knightofknee** (the
   same owner as Direct Democracy).
3. If it says **"Project already exists"** and asks to link it: Yes.

That's all. It prints "Project successfully linked" and adds
`"extra": { "eas": { "projectId": "…" } }` (and `"owner"`) to app.json.
Then either tell Claude "eas init done" (Claude commits it), or:

```bash
git add app.json && git commit -m "EAS project id" && git push
```

If it ever asks you to log in instead: `eas login`, username **knightofknee**,
then run `eas init` again.

### 0b2. Make yourself the operator (once)

In the UCS app: Me > Add an email > **bricarlis@gmail.com**, and verify it.
That account then sees **Operator queue** in Me (organization requests to
check, reports, AI spend) and gets the daily "Needs you" notification at
6:00 Chicago time whenever something waits. Apple expects reports to be
acted on within a day.

### 0c. Builds

Your usual process: `eas build --platform ios` / `--platform android` with
the production profile, then `eas submit`. EAS builds from git, so the
gitignored `.env.local` (the App Check debug token) never goes into a store
build. That's what we want: store builds attest for real.

**First iOS build** (`eas build -p ios`) asks, in this order:

1. "Do you want to log in to your Apple account?" **Yes**, your Apple ID,
   then the 2FA code.
2. Team: **R3H7M2M4F5**.
3. "Reuse this distribution certificate?" (the one Direct Democracy uses)
   **Yes**.
4. "Generate a new Apple Provisioning Profile?" **Yes**.
5. "Would you like to set up Push Notifications for your project?" **Yes**,
   then "Reuse an existing Apple Push Notifications service key?" **Yes**
   (pick Direct Democracy's key; one key serves every app on the team) or
   generate a new one if it offers none. Without this, iPhones get no push.

**First Android build** (`eas build -p android`) asks "Generate a new
Android Keystore?" **Yes** (EAS keeps it). Then, once, for Android push:

```bash
eas credentials -p android
```

→ production → **Google Service Account** → **Manage your Google Service
Account Key for Push Notifications (FCM V1)** → **Set up** → upload a key
from Firebase console → Project settings → Service accounts → **Generate new
private key** (project `universal-complaint-system`). Delete the downloaded
JSON afterwards; EAS keeps it. Without this, Android phones get no push.

---

## 1. Apple

### 1a. Developer portal: App Attest

developer.apple.com → Certificates, Identifiers & Profiles → Identifiers →
`com.waldgrave.ucs` → turn on **App Attest** → Save. (EAS usually syncs this
from the entitlement in app.json on the first build; checking it yourself
avoids a failed build.)

### 1b. Create the app (App Store Connect)

Apps → **+** → New App:
- Platforms: **iOS**
- Name: `Universal Complaint System`
- Primary language: English (U.S.)
- Bundle ID: `com.waldgrave.ucs`
- SKU: `ucs-1`
- User access: Full Access

**Then, in Firebase:** console → Project settings → General → Your apps →
the iOS app → **App Store ID**: paste the number from the listing URL
(`apps.apple.com/app/id<number>`). Same step as Direct Democracy.

### 1c. App Information

- Subtitle: `Every complaint, counted` (24 characters)
- Category: primary **Social Networking**, secondary **Lifestyle**
- Content rights: **Yes, it contains third-party content** (people's
  complaints), and you have the rights to show it (the terms grant them).
- Age rating questionnaire: answer **Yes** to user-generated content and to
  messaging/chat (private complaints are conversations with organizations);
  No to everything else. Expect a teen-or-older rating; accept whatever it
  computes.
- Privacy Policy URL, Support URL, Marketing URL: from the table above.

### 1d. App Privacy ("nutrition label")

Data used to track you: **None.** Data linked to you:

| Apple category | Type | Purpose |
| --- | --- | --- |
| Contact Info | Email Address | App Functionality |
| User Content | Photos or Videos | App Functionality |
| User Content | Customer Support | App Functionality |
| User Content | Other User Content | App Functionality |
| Identifiers | User ID | App Functionality |

Data not linked to you: **Other Data** → App Functionality (the one-way hash
of the network address used for rate limits). Photos are also screened by
Google Cloud Vision as a service provider (no extra row needed). No usage data, diagnostics,
location, purchases, or advertising data.

### 1e. Version page

- Screenshots: 6.9" iPhone (1320 × 2868), 3 to 10 of them, in
  `store/screenshots/ios/`. No iPad screenshots: the app is iPhone-only
  (`supportsTablet: false`).
- Promotional text, description, keywords: see the listing copy section at
  the end.
- Build: pick the one from `eas submit`.
- Encryption: already answered by `ITSAppUsesNonExemptEncryption: false`.

### 1f. App Review information

- Sign-in required: **No**. Say: "No account is needed to read, complain or
  support. An email account is only needed to send a private complaint or
  to respond for an organization."
- Demo account: done. The email and password are in `.reviewer.local` in
  this repo (gitignored; never commit it). It's a verified account that
  responds for the "Universal Complaint System" organization page, so the
  reviewer can respond, set statuses and see the private inbox.
  `npm run reviewer` prints the same file again.
- Notes (paste): "No account is needed to read, complain, or say 'Same
  here'. Sign in with the demo account (Me > Add an email > sign in) to see
  the organization side: Me > Respond for your organization. User-generated
  content safeguards (guideline 1.2): the terms agreement is shown before a
  first post; every complaint, point, response, page and private message has
  Report; any author can be hidden (Hide this author), and either side of a
  private conversation can block the other; threats, hate, sexual content
  and posts about private people are refused before posting; photos are
  screened; reports reach us immediately and are reviewed within 24 hours,
  and abusive accounts are suspended."

### 1g. TestFlight first

Internal testing with your own devices before submitting: check that
complaining works on a real device (that's App Attest's first real test).

---

### 1h. Sign in with Apple (about ten minutes, once)

The app offers Google sign-in, so Apple requires Sign in with Apple beside
it. The app side is built. Three things are needed in your Apple developer
account, then one paste into Firebase. Do A before the build you submit;
B to D can be done any time before submitting.

**A. Turn the capability on for the app**

1. developer.apple.com → Account → Certificates, Identifiers & Profiles →
   **Identifiers** → `com.waldgrave.ucs`.
2. Tick **Sign In with Apple** (leave "Enable as a primary App ID") → **Save**.
3. Build again (`eas build -p ios`). The build picks the capability up.

**B. Make a Services ID** (this is what the web version and Firebase use)

1. Identifiers → **+** → **Services IDs** → Continue.
2. Description `Universal Complaint System`, Identifier
   `com.waldgrave.ucs.web` → Continue → Register.
3. Open it again → tick **Sign In with Apple** → **Configure**:
   - Primary App ID: `com.waldgrave.ucs`
   - Domains and Subdomains: `universal-complaint-system.firebaseapp.com`
   - Return URLs: `https://universal-complaint-system.firebaseapp.com/__/auth/handler`
4. Next → Done → Continue → **Save**.

**C. Make a key**

1. **Keys** → **+** → Key Name `UCS Sign in with Apple`.
2. Tick **Sign In with Apple** → **Configure** → Primary App ID
   `com.waldgrave.ucs` → Save → Continue → **Register**.
3. **Download** the `.p8` file (Apple lets you download it once) and note
   the **Key ID** shown on that page. Keep the file out of the repo.

**D. Give Firebase the Services ID and key**

1. console.firebase.google.com → universal-complaint-system →
   Authentication → Sign-in method → **Apple** (already enabled).
2. Services ID: `com.waldgrave.ucs.web`
3. Under "OAuth code flow configuration": Apple team ID `R3H7M2M4F5`, the
   Key ID from C, and the whole contents of the `.p8` file as Private key.
4. **Save**.

**E. Tell Claude it is done.** It switches Apple on for the web version
(`APPLE_ON_WEB` in src/lib/sso.ts) and checks the popup.

What D buys: Apple sign-in on the web, and deleting an account revokes its
Apple token (Apple's rule 5.1.1(v); the app already does this, and it needs
the key to work). Without B to D, iPhone sign-in still works.

In App Store Connect itself nothing is switched on for Sign in with Apple.
Two things to state there:

- **App Privacy** (1d): Email Address is collected, linked to the person,
  for App Functionality only. Apple and Google sign-in give the app the
  email and nothing else.
- **App Review notes** (1f): "Sign in with Apple and Google are optional;
  the app works without an account. Delete account is at Me > About >
  Delete account, and deleting revokes the Apple sign-in."

## 2. Google Play

### 2a. Create the app

Play Console → **Create app**: name `Universal Complaint System`, default
language English (United States), **App**, **Free**, accept the declarations.

### 2b. First upload (manual)

The first build of a new app goes up by hand: Test and release → Testing →
**Internal testing** → Create new release → upload the `.aab` from
`eas build -p android`. After that, `eas submit -p android` works (same
service account as Direct Democracy).

If this developer account is a personal account created after November 2023,
Google requires a **closed test with at least 12 testers for 14 days**
before production access. Start that early.

### 2c. App integrity (this is App Check on Android)

1. Test and release → **App integrity** → Play Integrity API → **Link a
   Cloud project** → `universal-complaint-system`.
2. Same page → **App signing** → copy the **App signing key certificate
   SHA-256** (and the upload key's).
3. Firebase console → Project settings → General → the Android app →
   **Add fingerprint** → paste each SHA-256 → Save.

Until both are done, Android store builds can't attest, and every
complaint, search and "Same here" on Android is refused.

4. Android app links (shared links opening the app): send me the SHA-256 and
   I'll add the `com.waldgrave.ucs` entry to the Waldgrave
   `public/.well-known/assetlinks.json`, or add it yourself next to
   bekin's entry.

### 2d. App content

- Privacy policy: URL from the table.
- App access: **All or some functionality is restricted** → add the
  reviewer account (same as Apple) with the note from 1f.
- Ads: **No ads.**
- Content rating (IARC): category **Social**; users interact and share
  content: **Yes**; users can communicate (private conversations with
  organizations): **Yes**; shares location: **No**; digital purchases: **No**.
- Target audience: **18 and over** for the first version (no Families or
  teen policy surface). Revisit later.
- Data safety:
  - Collected: Personal info → Email address (account management,
    communications); App info and performance: none; Photos (app
    functionality); Messages → Other in-app messages (private complaints);
    App activity → Other user-generated content; Device or other IDs →
    yes, the push notification token (app functionality), only if they turn
    notifications on; declare User IDs under Personal info.
  - Shared with third parties: **No** (Anthropic and Google process data on
    our behalf as service providers, which Play doesn't count as sharing).
  - Encrypted in transit: **Yes**.
  - Users can request deletion: **Yes**, in the app (Me → Account → Delete
    account) and at the deletion URL.
- Account deletion URL: from the table.
- News, government, financial, health declarations: **No** to each.

### 2e. Store listing

- Short description (80): see listing copy.
- Full description: see listing copy.
- App icon 512 × 512, feature graphic 1024 × 500, 2 to 8 phone screenshots:
  all in `store/` (`play-icon.png`, `feature-graphic.png`,
  `screenshots/android/`).

---

## 3. Firebase and App Check, for release

Already done: iOS and Android apps registered, App Attest / Play Integrity /
reCAPTCHA Enterprise registered, every function enforcing App Check, the dev
debug token registered.

Still yours:
- Android SHA-256 fingerprints (2c).
- iOS App Store ID (1b).

---

## 4. Listing copy

Name: Universal Complaint System

Subtitle (Apple, 30): Every complaint, counted

Short description (Play, 80): Complain about anything. Join others who agree. See who fixes it.

Description:

Something's wrong? Say it here.

The Universal Complaint System is an independent public record of what's
wrong, about anything: a company, a product, a public service, or something
nobody owns. No organization controls it. They can respond, but they can
never delete or edit what you wrote.

• Complain in seconds, in any language, no account needed.
• See if others already said it, and add your "Same here".
• Starts full: complaints from public government records (CFPB, NHTSA) are
  already on it, labelled by source.
• Your complaint is split into specific points and merged with everyone who
  shares them, so a hundred people saying the same thing count as one loud
  point.
• Organizations respond publicly. Each one's page shows how much it has
  seen, answered and fixed.
• Fixes only count when the people who raised them agree.
• Need help with your own order or account? Send it privately: only that
  organization can read it, and they can reply to you.

Rants welcome. Specifics get things fixed.

Keywords (Apple, 100): complaint,feedback,customer service,review,report,consumer,support,fix,problem,voice
