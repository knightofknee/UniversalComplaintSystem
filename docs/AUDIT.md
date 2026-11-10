# Pre-launch audit (2026-11-05)

Three passes: an adversarial security and cost review, a product review
against the name, and a UI pass on phone and web. Two fresh reviewers did
the first two without seeing my reasoning; I checked their key claims.

**Verdict.** The intake is strong: two-step review, personal data removed,
private channel, independence rules, App Check, a cost ceiling. But two
things stand between this and a first version worth submitting:

1. **It's a complaint box, not yet a system.** Nothing leaves the app: no
   push, no email, no outreach to organizations, no share links, and the
   record is empty on day one. The copy promises "we'll tell you", and
   nothing does.
2. **Apple will reject it as is.** Guideline 1.2 requires reporting,
   blocking and a terms agreement for user-generated content. None of these
   exist.

---

## Fixed during the audit (deployed)

| | Problem | Fix |
| --- | --- | --- |
| Critical | **Anyone could become a responder for any organization.** `requestAccess` took the claimant's own website, and the daily check approved any email that matched it (`x@evil.co` + website `evil.co` = responder for Delta, with its private inbox). | Approval only against a website the operator verified (`npm run review-claims -- website <subjectId> <url>`). The claimant's site is a hint. The homepage scan is removed: it was beatable with a look-alike domain and fetched URLs the claimant chose. |
| Critical | **The App Check debug token was in release bundles** (`.env.local` is read in production exports). Anyone unzipping the app could pass App Check. | Referenced only under `__DEV__`, so it's compiled out. A fresh release export contains it 0 times. Token rotated on all three apps. |
| High | **Per-address limits were spoofable.** The client controls the first `X-Forwarded-For` entry. | Use the last entry, which Google appends. |
| Medium | **Unlimited uploads that never expire.** | `uploads/` deleted after 1 day (bucket rule). App Check enforced on Storage. |
| Medium | **Anyone could read the whole database with the public key.** | App Check enforced on Firestore. Verified: the app's own query is refused without it, and the app still works. |

---

## Pre-submission build (done, 2026-11-05)

Everything below was built, tested end to end against the emulators (33
checks: terms, fix rules, unsafe block, queueing, private matching, hidden
organizations, blocking, reports, suspension, operator approvals), and
deployed.

| # | Item | What was built |
| --- | --- | --- |
| 1 | Report | Report on every point, complaint, response, page and private message. Reports go to the operator queue (Me > Operator queue, plus a notification), never to the organization, and never hide anything automatically. Remove (logged publicly), Remove + suspend, or Keep. `npm run remove` also covers subjects and responses. |
| 2 | Block | Readers hide an author's complaints (Me > Hidden authors to undo). Either side of a private conversation can block the other. |
| 3 | Terms | Agreement before the first post, message, response or access request, with the zero-tolerance line. Enforced on the server. |
| 4 | Photo safety | Cloud Vision SafeSearch on every photo before the model or anyone else sees it; a failed check leaves the photo off. |
| 5 | Unsafe content | The model returns a hard `unsafe` verdict (threats, hate, sexual content, private people, contact details) that blocks posting with a plain reason. New subject names pass a filter. Subjects are removable. |
| 6 | Icon and splash | UCS's own mark: a speech bubble holding a tally, "every complaint, counted". iOS icon has no transparency; Android adaptive and monochrome icons; light and dark splash. |
| 7 | iPad | `supportsTablet` off. |
| 8 | Push | expo-notifications. Offered right after posting or sending privately (once per phone), or the switch in Me. Responses, statuses, "is it fixed?", private replies, queued complaints ready. **Needs `eas init`** for the project id. |
| 9 | Never lost | Past the daily AI budget, complaints are queued (photos kept) and checked hourly once there's room; the author is notified to review and post. Search and complaints have separate caps. |
| 10 | Fixes | Status per organization. Only people who supported before the fix was claimed can confirm; the threshold counts only them. Responders can't vote. Tags capped (4 organizations, 3 topics, 8 total). |
| 11 | Headlines | Replaced only by wording close in meaning and clearly more actionable; credited "Summarized from X's complaint". |
| 12 | Private text | Private-only points are matched by vector distance after the model runs; their text never goes to the model. |
| 13 | Share | Share on points and pages; links go to waldgrave.com/ucs/app and open the app where installed (universal links / app links). The web export is built into the Waldgrave site. |
| 14 | Day one | `npm run import` seeds from CFPB (grouped by company and issue, one supporter per complaint) and NHTSA (one complaint each), labelled and linked to the source. Production is seeded. |
| 15 | Honest scoreboards | Organizations that haven't joined show points and people, and say they haven't joined, instead of 0% responded. Held private complainers are told when the organization joins. |
| – | Fan-out cap | Point news goes out at most every 6 hours per point (`flushNotices`). |
| – | `restrictedTo` | Moved to server-only `restricted/{id}`. |
| – | Private to a new org | Creates it hidden until someone complains publicly or it joins. |
| – | Batches | Vote resets and deletes are chunked. |
| – | `npm run usage` | Exists; also sets the ceiling. |
| – | Operator | The daily 6:00 check notifies the operator when requests, reports or queued complaints wait. In-app operator queue to verify websites, approve, deny. |

**UI** (from the review below): "Same here" bumps with a haptic; posting
lands an ON THE RECORD stamp; a confirmed fix gets a green check; Browse
shows its pitch once, then a compact header with the mark; Search opens on
the biggest organizations and topics; Me has one respond link; rants get a
flame; empty states have some voice.

### Still open

- Android push and App Check need the Play signing SHA-256 (STORE-SETUP 2c).
- `eas init` (project id for push), then a TestFlight build to check App
  Attest and push on a real phone.
- assetlinks.json for Android app links, after the SHA-256 is known.

---

## Right after launch

- **Organization outreach**: one email to an unclaimed organization when its
  points pass a threshold, and a weekly digest for claimed ones. Needs an
  email provider. (M)
- **Merging**: nightly near-duplicate merge for points and subjects;
  operator queue for model-created organizations. (M)
- **Language**: UI translations, and points shown in the reader's language.
  "Universal" needs this. (L)
- **Organization tools from the spec**: median time to first response, CSV
  export, internal notes, embed. (M)
- **Scale**: sharded counters for `usage/{date}` and supporter totals;
  embeddings moved out of public documents. (M)
- **Fake support at scale**: weight or delay support from brand-new
  anonymous accounts. (M)

---

## UI review

**What works:**
- Clean, readable, consistent.
- The two-list browse works on phone and wide screens.
- "Same here" is obvious.
- The review step shows everything the model did.

**Smooth and simple? Mostly.**
- Browse spends half the first screen on the same headline and blurb every
  visit. Show it once, then let the content lead.
- Search is a blank page until you type. Show biggest topics and categories
  there.
- Me has two near-identical links ("Respond for your organization" /
  "...an organization"). Show one.
- The review screen is long (filed under, who sees it, points, personal
  details, rewrite, photos). Collapse what needs no decision.
- Two ways to complain (the tab and the big button) is fine. Keep both.

**Fun looking? Not yet.** It reads as a well-made utility. To give it
personality without clutter:
- **Identity.** A real mark: a megaphone, or a speech bubble with a crack.
  One strong signal color, an icon and splash in it, and the mark in the
  Browse header.
- **Motion and feel.**
  - "Same here" bumps with a count tick and a haptic.
  - Posting gets a small "on the record" stamp moment.
  - A confirmed fix gets a green check moment.
- **Voice in empty states.** "Nothing's broken here yet. Suspicious." beats
  "Nothing here yet."
- **Rants** get their own warm color and a little heat, so venting feels
  welcome and the constructive points still lead.

---

## Complete-product audit (2026-11-10)

Walked every regular-user journey: write, review, post, find, support, vote,
fix, follow up, sign in, leave. Fixed in this pass:

- Delete one of your own complaints (was: only the whole account).
- Lists paged with "Show more" (was: cut off at 40 / 100).
- People on a point are told when others join it, at milestones.
- Photos open full size; unread badge on the Me tab.
- Signing in to an existing account brings the device's complaints with it.
- Sign in with Apple and Google; shuffle your public name.
- Proposed fixes from anyone, rated by the people with the problem.
- "Potentially missing" details, with a re-read when one is added.
- Keyboard hide bar; modal transitions for the complaint box.
- New icon: Rudy the red pepper, who also sits beside the spice meter.
- Likely duplicate points are nominated at posting for the operator to merge.

Still open for regular users, honestly:

- **Language (L)**: complaints in any language are read and translated, but
  the app's own words are English only. The biggest gap against "Universal".
- **Sign in with Apple on the web (S)**: needs a Services ID and key from the
  Apple developer account. iPhone works.
- **Android (S, blocked on the first Play build)**: release SHA-256 for App
  Check, push, app links and Google sign-in.
- **Fake support at scale (M)**: support from brand-new anonymous accounts
  counts in full.
- Not exercised end to end with real accounts: a real Google / Apple sign-in,
  posting a fix on the live record, the account merge.

Organizations: the dashboard gained a summary, response rate and time, topic
breakdown, two more filters and an export. Untested by the owner; outreach
email and weekly digests still need an email provider.

---

## Next

Build and submit with [STORE-SETUP.md](STORE-SETUP.md).
