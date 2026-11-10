import type { Timestamp } from 'firebase/firestore';

export type PointStatus =
  | 'open'
  | 'acknowledged'
  | 'planned'
  | 'fix_claimed'
  | 'fixed'
  | 'not_fixed'
  | 'wont_fix';

export type Point = {
  id: string;
  text: string;
  subjectIds: string[];
  subjectNames: string[];
  topicIds?: string[];
  categories?: string[];
  supportCount: number;
  /** Support gained in the last 7 days ("Rising this week"). */
  weekSupport?: number;
  /** Supporters with real accounts (no imported records), all time and this week. Lists rank by these first. */
  people?: number;
  weekPeople?: number;
  /** Seeded from a public record rather than raised by a person here. */
  imported?: boolean;
  submissionCount: number;
  rantCount: number;
  hot: boolean;
  /** The latest status change, for lists; per organization in orgStatus. */
  status: PointStatus;
  statusBy?: string | null;
  /** Each organization's own status; fixes are confirmed per organization. */
  orgStatus?: Record<string, OrgStatus>;
  seenBy: Record<string, Timestamp>;
  respondedBy: Record<string, Timestamp>;
  /** When each organization first responded (how long people waited). */
  firstRespondedBy?: Record<string, Timestamp>;
  /** Fixes people proposed on this point. */
  solutionCount?: number;
  /** Private complaint counts, only for organizations that chose to publish them. */
  privateCounts?: Record<string, number>;
  canonical: { submissionId: string; authorName: string; actionability: number };
  addedBy: 'model';
  firstSubmissionId: string;
  photo: string | null;
  createdAt: Timestamp | null;
  lastActivityAt: Timestamp | null;
};

export type OrgStatus = {
  status: PointStatus;
  at: Timestamp | null;
  /** When the organization said it fixed it: only earlier supporters can confirm. */
  fixClaimedAt?: Timestamp | null;
  yes: number;
  no: number;
};

export type Subject = {
  id: string;
  kind: 'organization' | 'topic';
  name: string;
  description: string;
  website: string | null;
  category?: string;
  domains: string[];
  claimed: boolean;
  /** Advanced setting: show this organization's private counts publicly. */
  publishPrivate?: boolean;
  stats: { points: number; seen: number; responded: number; fixed: number; supporters?: number };
};

export type Submission = {
  id: string;
  authorName: string;
  /** Opaque and stable per author: lets a reader hide one author (Block). */
  authorId?: string;
  /** Imported from a public government record. */
  source?: Source | null;
  text: string;
  language: string;
  englishText: string | null;
  rewritten: boolean;
  subjectIds: string[];
  subjectNames: string[];
  matchedPointIds: string[];
  addedPointIds: string[];
  tone: 'constructive' | 'neutral' | 'rant';
  /** The model's 1-10 for rants (how good a read it is), 0 otherwise. */
  rantScore?: number;
  /** One-line details the author added after posting. */
  details?: string[];
  /** Readers' "Best rant" votes. */
  loves?: number;
  /** Sort key of "Best rants": votes, then written by a person, then the model's score. 0 = not listed. */
  rantRank?: number;
  /** 1-5 peppers (the language, not the problem). */
  spice?: number;
  actionability: number;
  photos: string[];
  createdAt: Timestamp | null;
};

/** A fix someone proposed for a point (points/{id}/solutions/{authorId}). */
export type Solution = {
  /** The proposer's opaque author id: one fix per person per point. */
  id: string;
  text: string;
  authorName: string;
  authorId: string;
  /** How the people who have the problem rated it. */
  full: number;
  partial: number;
  none: number;
  createdAt: Timestamp | null;
};

/** Where an imported complaint came from. */
export type Source = {
  name: string;
  shortName: string;
  id: string;
  url: string;
  date: Timestamp | null;
  orgReply: string | null;
  /** The agency's own caveat about its data (e.g. that it doesn't verify reports). */
  note?: string | null;
};

export type Response = {
  id: string;
  subjectId: string;
  subjectName: string;
  domain: string;
  official: boolean;
  text: string | null;
  status: PointStatus | null;
  removed?: boolean;
  createdAt: Timestamp | null;
};

export type Notification = {
  id: string;
  type: string;
  link?: string;
  draftId?: string;
  pointId?: string;
  subjectId?: string;
  threadId?: string;
  text: string;
  read: boolean;
  at: Timestamp | null;
};

/** What the intake model returns for a draft (mirrors functions/src/ai.ts). */
export type IntakeResult = {
  language: string;
  englishText: string | null;
  safety?: { unsafe: boolean; reason: string | null };
  isComplaint: boolean;
  notComplaintReason: string | null;
  supportTicket: { isTicket: boolean; advice: string | null };
  pii: {
    found: string[];
    redactedText: string | null;
    /** Never stored, even privately (card numbers, ID numbers, passwords). */
    sensitive: string[];
    sensitiveRemovedText: string | null;
  };
  subjects: unknown[];
  points: {
    matchedPointId: string | null;
    statement: string;
    actionability: number;
    subjectIndexes: number[];
  }[];
  tone: 'constructive' | 'neutral' | 'rant';
  /** 1-5 peppers: how heated the language is. 5 is over the line (name-calling at people) and can't post. */
  spice?: number;
  spiceReason?: string | null;
  /** For a 5: rewrites that keep the heat but drop the name-calling, at least one funny. */
  alternatives?: string[];
  actionability: number;
  /** Up to three details the complaint doesn't give that would help. Suggestions, never required. */
  missing?: string[];
  suggestedRewrite: string | null;
  photos: { index: number; ok: boolean; containsPersonalData: boolean }[];
};

export type PointHit = {
  id: string;
  text: string;
  subjectNames: string[];
  supportCount: number;
  status: PointStatus;
  /** From search: cosine distance to the query (0 is the same thing). */
  distance?: number;
};

export type Analysis = {
  draftId: string;
  result: IntakeResult;
  subjects: {
    id: string | null;
    name: string;
    kind: 'organization' | 'topic';
    category: string | null;
    isNew: boolean;
  }[];
  matched: Record<string, PointHit>;
  /** Per point: has anyone raised it privately? Never a count. */
  alsoPrivate: boolean[];
};

/** A private complaint: a conversation between its author and one organization. */
export type Thread = {
  id: string;
  uid: string;
  email: string;
  authorName: string;
  orgName?: string;
  text: string;
  language: string;
  englishText: string | null;
  photos: string[];
  /** Who blocked the conversation, if anyone; then nobody can send. */
  blockedBy?: 'user' | 'org' | null;
  points: { privatePointId: string; pointId: string | null; statement: string }[];
  status: 'open' | 'resolved';
  createdAt: Timestamp | null;
  lastMessageAt: Timestamp | null;
  lastFrom: 'user' | 'org';
  unreadByOrg: boolean;
  unreadByUser: boolean;
};

export type Message = {
  id: string;
  from: 'user' | 'org';
  text: string;
  domain?: string;
  authorName?: string;
  removed?: boolean;
  at: Timestamp | null;
};

/** users/{uid}/threads: the author's index of their private complaints. */
export type MyThread = {
  id: string;
  orgId: string;
  orgName: string;
  preview: string;
  status: 'open' | 'resolved';
  lastMessageAt: Timestamp | null;
  unread: boolean;
};

/** The organization's private count for one point (subjects/{id}/privatePoints). */
export type PrivatePoint = {
  id: string;
  pointId: string | null;
  isPrivateOnly: boolean;
  text: string;
  count: number;
  lastAt: Timestamp | null;
};
