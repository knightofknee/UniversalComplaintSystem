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
  submissionCount: number;
  rantCount: number;
  hot: boolean;
  status: PointStatus;
  seenBy: Record<string, Timestamp>;
  respondedBy: Record<string, Timestamp>;
  fixClaimedBy: string | null;
  fixVotes: { yes: number; no: number };
  /** Private complaint counts, only for organizations that chose to publish them. */
  privateCounts?: Record<string, number>;
  canonical: { submissionId: string; authorName: string; actionability: number };
  addedBy: 'model';
  firstSubmissionId: string;
  photo: string | null;
  createdAt: Timestamp | null;
  lastActivityAt: Timestamp | null;
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
  restrictedTo: string[] | null;
  /** Advanced setting: show this organization's private counts publicly. */
  publishPrivate?: boolean;
  stats: { points: number; seen: number; responded: number; fixed: number; supporters?: number };
};

export type Submission = {
  id: string;
  authorName: string;
  text: string;
  language: string;
  englishText: string | null;
  rewritten: boolean;
  subjectIds: string[];
  subjectNames: string[];
  matchedPointIds: string[];
  addedPointIds: string[];
  tone: 'constructive' | 'neutral' | 'rant';
  actionability: number;
  photos: string[];
  createdAt: Timestamp | null;
};

export type Response = {
  id: string;
  subjectId: string;
  subjectName: string;
  domain: string;
  official: boolean;
  text: string | null;
  status: PointStatus | null;
  createdAt: Timestamp | null;
};

export type Notification = {
  id: string;
  type: string;
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
  actionability: number;
  coaching: string | null;
  suggestedRewrite: string | null;
  photos: { index: number; ok: boolean; containsPersonalData: boolean }[];
};

export type PointHit = {
  id: string;
  text: string;
  subjectNames: string[];
  supportCount: number;
  status: PointStatus;
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
  text: string;
  language: string;
  englishText: string | null;
  photos: string[];
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
