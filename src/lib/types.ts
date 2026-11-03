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
  supportCount: number;
  submissionCount: number;
  rantCount: number;
  hot: boolean;
  status: PointStatus;
  seenBy: Record<string, Timestamp>;
  respondedBy: Record<string, Timestamp>;
  fixClaimedBy: string | null;
  fixVotes: { yes: number; no: number };
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
  domains: string[];
  claimed: boolean;
  restrictedTo: string[] | null;
  stats: { points: number; seen: number; responded: number; fixed: number };
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
  pii: { found: string[]; redactedText: string | null };
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
  subjects: { id: string | null; name: string; kind: 'organization' | 'topic'; isNew: boolean }[];
  matched: Record<string, PointHit>;
};
