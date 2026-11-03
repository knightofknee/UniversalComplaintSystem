# Universal Complaint System — product spec (draft 1, 2026-11-02)

Private until launch. Do not publish or share.

## Mission

Every complaint about anything gets recorded, merged with everyone else who
has the same complaint, and shown to whoever could fix it, on a record the
party being complained about does not control.

Every existing channel fails that last clause: the company's own support
queue, feedback board, or app-store reply is owned by the company; review
sites are owned by whoever sells reputation services; regulators cover one
industry in one country. UCS is the neutral record.

The promise to users, worded exactly: **your complaint is counted, merged
with everyone who shares it, and visible to the people who can fix it.** We
never promise a response.

## Core model

Everything hangs off three objects.

| Object | What it is |
| --- | --- |
| **Subject** | Anything a complaint is about. Two kinds: an **organization** (has domains, can be claimed: companies, products, government agencies, schools) and a **topic** (no owner: "self-checkout machines", "daylight saving time", "airline seat size"). Subjects nest: product under company, topic under topic. |
| **Point** | One atomic, specific thing that is wrong or could be better. The unit of support, status, and response. A point can attach to several subjects (a topic point like "seats too small" links to every airline). |
| **Submission** | What one person wrote, in their own words, plus photos. A submission is split into points: some matched to existing points (that person now supports them), some new. The original text is always kept and shown, never altered without the author's consent. |

A point shows: its canonical wording, a short AI summary, supporter count,
trend, status, the subject(s), the responses, and the list of submissions
behind it.

## User side

### Intake: as easy as possible to complain, easier to find an existing one

1. User types (or dictates) freely. Photos optional (up to 4).
2. As they type, live search shows matching points: "Is this what you mean?"
   One tap supports a point and they can stop there.
3. On submit, the intake model:
   - identifies the subject(s), creating a topic if none fits (operator queue
     for new organizations);
   - splits the text into points and matches each against existing points;
   - shows the result before posting: **"Matched 2 existing points · Adding 1
     new point"**, with the new one highlighted, so it is visible exactly
     where the model added something;
   - detects a **support ticket** ("my order #4471 never arrived") and offers
     the company's support link, while still recording the pattern ("orders
     arrive late") as a point if the person wants;
   - flags PII (order numbers, phone numbers, names of private people) and
     strips it with the user's OK.
4. User confirms; they get a receipt: the points they now support and a link
   to follow each.

### Productive language (coach, never censor)

- Every submission gets an **actionability** score: is it specific, does it
  say what happened, what was expected, and (optionally) what would fix it.
- Low scores get a one-tap suggested rewrite. The person may keep their own
  words. Rants are allowed and stay findable.
- The incentive: each point's canonical wording is taken from its most
  actionable submission, credited to its author ("Wording by …"). Writing
  well is how your words become the headline.
- Sentiment is used for sorting and for the "rants" leaderboard, not for
  hiding anything.

### Following through

Users who support a point are notified when it moves: seen, acknowledged,
planned, fixed. When a company marks a point fixed, its supporters are asked
**"Is it actually fixed?"** The point only shows Fixed once supporters
confirm. Same model as Direct Democracy's answered / dodged: the company
cannot grade itself.

### Discovery

- Per subject: its points, sorted by supporters, trending, newest, fixed.
- Global: the world's top complaints and top rants this week, across every
  subject.
- Topic subjects show "who could fix this" (organizations the model or users
  link to it). This is how a general complaint finds a fixer.

## Company side

### Claiming

- Anyone with an email at a subject's domain can apply to respond. They prove
  control of the inbox (magic link) on the spot.
- A **daily batch job** checks each pending application: the domain is the
  organization's official domain (found on its website, Wikidata, or its
  app-store listing), not a free-mail or lookalike domain. Clean matches are
  queued for one-tap operator approval; anything doubtful is held.
- Responses from a domain-verified person show **"@acme.com"**. Once an
  organization has an admin, responses from people it designates show
  **"Official response"**; other domain emails show "Employee (unofficial)".
- Restricted control: an organization can ask for responding to be limited to
  a list of addresses or roles. We set it after verifying the request comes
  from an admin.

### Tools (what a feedback vendor gives them, for free)

- A sorted list of points: by supporters, trend, actionability, newness, with
  the duplicates already merged.
- A feed of new points and points rising fast.
- Status workflow: seen (automatic when a responder opens it), acknowledged,
  planned, fixed, won't fix (with a reason).
- Private internal notes on a point. Nothing else is private: no private
  boards, no hiding points.
- Weekly email digest.
- CSV export. Later: webhooks to Slack, Jira, Linear, GitHub, where closing the
  linked issue proposes Fixed.
- Import: CSV from Canny, UserVoice, app-store reviews, so their first look is
  their own backlog sorted into points.
- Embed: a link or script tag for their "Give feedback" button that opens UCS
  intake with the subject pre-filled, clearly labeled as a public record.

### Public stats per organization

Total points, % seen, % responded, % fixed (confirmed), median time to first
response. This is the pressure that gets responses. It is a scoreboard; we
are honest that it is one.

## Independence rules (the part competitors can't copy)

1. Organizations can respond, never remove, hide, reorder, or edit.
2. Nothing is sold that changes visibility or ranking. If money is ever
   charged, it is for integrations and analytics only.
3. Removals happen only for illegal content, PII, or complaints about private
   individuals, and every removal is listed in a public log (subject, reason,
   date).
4. Domain-verified employees can't support points on their own organization.
5. Complaints are about organizations, products, and things, never about a
   named private person. Front-line staff names are stripped.

## Seeding the record (cold start)

Pages exist before anyone claims them. To avoid empty pages without
inventing anything, import public-domain government complaint data, labeled
with its source:

- CFPB Consumer Complaint Database (finance, with company responses)
- NHTSA vehicle complaints
- other public datasets as found (FDA, DOT)

When a point on an unclaimed organization passes a threshold, the
organization's public contact address gets one email inviting it to claim
its page.

## Photos

Yes, in v1. Storage is cheap; moderation is the real cost. Rules: max 4 per
submission, resized and EXIF/location stripped on upload, automated
safety + PII screening (receipts, cards, faces of bystanders) before a photo
is public, held private until it passes. No video in v1.

## AI pipeline

- **Embeddings** for every point and submission; vector search (Firestore
  vector search) finds candidates in milliseconds while typing.
- **LLM (Claude)** on submit: subject detection, point splitting, matching
  decisions, actionability, ticket detection, PII flags, suggested rewrite.
  One structured call per submission.
- **Nightly jobs**: merge near-duplicate points (proposals shown to the
  operator at first), refresh point summaries, cluster topics, recompute
  trends and stats, run the domain-verification batch.
- Every model change to the record (new point, merge, canonical wording) is
  shown with a marker so people can see where the model acted.

## Legal questions to settle before launch

- US Section 230 protects hosting what users write. AI-written canonical text
  and summaries may count as our own speech. Keep canonical wording drawn
  from real submissions and attributed; get a lawyer's read.
- Defamation / takedown process, anti-SLAPP posture, EU DSA if EU users.
- Privacy policy, terms, account deletion (pattern from Direct Democracy).

## Stack (matches Direct Democracy)

- Expo SDK 57 + expo-router, TypeScript strict, iOS + Android + web.
- Firebase: Auth (Apple, Google, email link), Firestore, Functions, Storage.
- Web export hosted at waldgrave.com/ucs/app; privacy/terms/landing pages in
  the-waldgrave repo.
- Bundle ID / Android package: `com.waldgrave.ucs` (already registered in
  App Store Connect). Differs from the older `com.briancarlisle.*` apps on
  purpose: it's reverse-DNS of waldgrave.com, which hosts the web app and
  universal links.

## v1 scope

In: user intake with live matching and point splitting, photos, subjects
(organizations + topics), support, follow + notifications, domain claim with
daily batch, responses, status workflow with confirmed-fixed, org stats,
global top lists, removal log, CFPB import.

Later: integrations, embed widget, imports from Canny/UserVoice, restricted
control UI (operator-set in v1), video.
