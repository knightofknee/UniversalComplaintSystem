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

## Must fix before the first submission

### Store rejection risks
1. **Report** on every point, complaint, response, organization page and
   message → a reports queue → `npm run reports` to act on it (removals stay
   logged publicly). (S)
2. **Block**: a person can block an organization's responder in a private
   conversation, and hide an author's complaints. (S)
3. **Terms agreement** before the first post, with a zero-tolerance line
   for abuse. (S)
4. **Photo safety**: Cloud Vision SafeSearch on every photo before it's
   public, not just the model's "ok". (S)
5. **Unsafe content** in the intake: a hard `unsafe` verdict (threats,
   hate, sexual content, targeting a private person) that blocks posting,
   plus a deterministic filter on new subject names. Subjects become
   removable with `npm run remove`. (S)
6. **App icon and splash** are Direct Democracy's. UCS needs its own. (S)
7. **iPad**: `supportsTablet` is on, which means iPad screenshots and an
   iPad review. Turn it off for v1. (S)

### Breaks the promise in the name
8. **Push notifications** (expo-notifications, like Direct Democracy): an
   organization responds, a status changes, "is it actually fixed?", a reply
   to a private complaint. Without this, "we'll tell you" is false and the
   fixed-confirmation loop never closes. (M)
9. **Never lost.** When the daily AI ceiling is hit, keep the complaint and
   process it later, instead of "try tomorrow". Separate ceilings for
   search and for complaints, so searching can't use up complaining. (S)
10. **Fixes can't be self-graded.** Today an org can confirm its own "fixed"
    with a few phones, and any org tagged onto a point can set its status.
    Fix:
    - Only supporters from *before* the fix was claimed can confirm.
    - Status is per organization.
    - Only organizations on the point when it was created (or approved)
      can set it.
    - Cap tags per point. (S)
11. **Headlines can't be hijacked.** One crafted complaint can replace a
    popular point's headline. Replace only when the new wording is close in
    meaning, and credit it as "summarized from". It's model-condensed text,
    which matters for the defamation and Section 230 question. (S)
12. **Private text never goes to the model next to strangers' input.**
    Prompt injection could echo private statements back. Match private-only
    points by vector distance alone. (S)
13. **Share**: a share button on points and organization pages, and links
    that open the app or the web version (`waldgrave.com/ucs/app/point/…`).
    The web build goes live there. (S–M)
14. **Day one isn't empty.** Import public-domain government complaint data
    (CFPB, with company responses; NHTSA), clearly labelled by source,
    through the same pipeline. (M)
15. **Honest scoreboards.** An unclaimed organization's page says "Not yet
    notified" rather than 0% responded. The private complainer whose
    complaint is held gets told when the organization joins (promised, not
    built). (S)

### Smaller holes from the security review
- Cap notification fan-out (one status notice per point per day, sent from
  a queue) so a busy point can't run up writes. (S)
- `restrictedTo` (responder emails) is publicly readable; move it to a
  server-only document. (S)
- A private complaint to a brand-new organization creates a public
  organization page; it shouldn't. (S)
- Batches that can exceed 500 writes (fix-vote reset, tag-heavy support
  transactions). (S)
- `npm run usage` is documented but doesn't exist. (S)

---

## Right after launch

- **Organization outreach**: one email to an unclaimed organization when its
  points pass a threshold, and a weekly digest for claimed ones. Needs an
  email provider. (M)
- **Merging**: nightly near-duplicate merge for points and subjects;
  operator queue for model-created organizations. (M)
- **Language**: UI translations, and points shown in the reader's language.
  "Universal" needs this. (L)
- **Accounts that survive a reinstall**: Sign in with Apple and Google. (M)
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
- "Me too" is obvious.
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
  - "Me too" bumps with a count tick and a haptic.
  - Posting gets a small "on the record" stamp moment.
  - A confirmed fix gets a green check moment.
- **Voice in empty states.** "Nothing's broken here yet. Suspicious." beats
  "Nothing here yet."
- **Rants** get their own warm color and a little heat, so venting feels
  welcome and the constructive points still lead.

---

## Order of work

1. Store blockers (1–7)
2. The promise (8–15)
3. The smaller security holes

All together this is roughly the size of the tags-and-browse build plus the
private-complaints build combined. Then you build and submit, using
[STORE-SETUP.md](STORE-SETUP.md).
