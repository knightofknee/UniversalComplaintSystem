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

### 0a. Put the website pages live

Both stores link to them, and Play rejects an account-deletion URL that
doesn't load. The pages go in the Waldgrave site repo under `pages/ucs/`
(landing, privacy, terms, support, delete-account). I write them from the
in-app policy and terms as part of the pre-submission work in AUDIT.md;
you deploy.
Commit and deploy only those files, the same way as Basic Autocorrect:

```bash
cd ~/Documents/GitHub/the-waldgrave
```

```bash
git add pages/ucs && git commit -m "Universal Complaint System pages" && git push && git push heroku
```

Then check that each URL in the table above loads.

### 0b. Link the EAS project (once)

UCS has an `eas.json` copied from Direct Democracy, but no EAS project yet.
From this repo:

```bash
eas init
```

It writes `extra.eas.projectId` into app.json; commit that.

### 0c. Builds

Your usual process: `eas build --platform ios` / `--platform android` with
the production profile, then `eas submit`. EAS builds from git, so the
gitignored `.env.local` (the App Check debug token) never goes into a store
build. That's what we want: store builds attest for real.

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
of the network address used for rate limits). No usage data, diagnostics,
location, purchases, or advertising data.

### 1e. Version page

- Screenshots: 6.9" iPhone (1320 × 2868), 3 to 10 of them. iPad screenshots
  are only needed if the app keeps iPad support (see AUDIT.md).
- Promotional text, description, keywords: see the listing copy section at
  the end.
- Build: pick the one from `eas submit`.
- Encryption: already answered by `ITSAppUsesNonExemptEncryption: false`.

### 1f. App Review information

- Sign-in required: **No**. Say: "No account is needed to read, complain or
  support. An email account is only needed to send a private complaint or
  to respond for an organization."
- Demo account: a reviewer account that responds for a demo organization,
  so the reviewer can see responding and private complaints. I create it in
  production before you submit and give you the credentials directly; they
  never go in this public repo.
- Notes: point the reviewer at Report and Block on any complaint, and the
  terms agreement before the first post (guideline 1.2).

### 1g. TestFlight first

Internal testing with your own devices before submitting: check that
complaining works on a real device (that's App Attest's first real test).

---

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
complaint, search and "Me too" on Android is refused.

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
    App activity → Other user-generated content; Device or other IDs → none
    beyond the account ID (declare User IDs under Personal info).
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
- App icon 512 × 512, feature graphic 1024 × 500, 2 to 8 phone screenshots.

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
• See if others already said it, and add your "Me too".
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
