import { httpsCallable } from 'firebase/functions';

import { functions } from '@/lib/firebase';
import type { Analysis, PointHit, PointStatus } from '@/lib/types';

function call<In, Out>(name: string) {
  const fn = httpsCallable<In, Out>(functions, name);
  return async (data: In) => (await fn(data)).data;
}

/** Sent with a person's first post: they ticked the terms agreement. */
type Terms = { acceptTerms?: boolean };

export const searchPoints = call<
  { query: string },
  {
    points: PointHit[];
    subjects: { id: string; name: string; kind: string; description: string }[];
    /** Something like this was raised privately (never how many times). */
    raisedPrivately: boolean;
  }
>('searchPoints');

export const analyzeComplaint = call<
  { text: string; photoPaths: string[]; subjectId?: string },
  | ({ queued: false } & Analysis)
  /** The day's AI budget is used up: it's saved and checked as soon as there's room. */
  | { queued: true; queueId: string }
>('analyzeComplaint');

/** A queued complaint that has since been checked. */
export const getDraft = call<{ draftId: string }, Analysis & { text: string }>('getDraft');

export const submitComplaint = call<
  Terms & {
    draftId: string;
    useRewrite: boolean;
    removePII: boolean;
    keepPoints: number[];
    /** Indexes into the analysis's subjects the author untagged. */
    removeSubjects: number[];
    /** Existing subjects the author added; they apply to every point. */
    addSubjectIds: string[];
    visibility: 'public' | 'private';
    /** For private: index into the analysis's subjects of the organization it goes to. */
    privateTo?: number;
  },
  | { visibility?: undefined; submissionId: string; matchedPointIds: string[]; addedPointIds: string[] }
  | {
      visibility: 'private';
      threadId: string;
      orgId: string;
      orgName: string;
      claimed: boolean;
      website: string | null;
      pointCount: number;
    }
>('submitComplaint');

type ThreadRef = { orgId: string; threadId: string };
export const sendMessage = call<ThreadRef & Terms & { text: string }, { ok: boolean }>('sendMessage');
export const setThreadStatus = call<ThreadRef & { status: 'open' | 'resolved' }, { status: string }>(
  'setThreadStatus',
);
export const markThreadRead = call<ThreadRef, { ok: boolean }>('markThreadRead');
export const blockThread = call<ThreadRef & { blocked: boolean }, { blockedBy: 'user' | 'org' | null }>('blockThread');
export const setOrgSettings = call<{ subjectId: string; publishPrivate: boolean }, { publishPrivate: boolean }>(
  'setOrgSettings',
);
/**
 * After signing in to an account that already existed: bring over what the
 * device's signed-out account did. `fromToken` is that account's ID token,
 * taken just before switching.
 */
export const mergeAccount = call<{ fromToken: string }, { moved: number }>('mergeAccount');
/** Delete one of your own public complaints; what it added to the record is undone. */
export const deleteComplaint = call<{ submissionId: string }, { deleted: boolean }>('deleteComplaint');
export const deleteAccount = call<{ confirm: true }, { deleted: boolean }>('deleteAccount');

export const supportPoint = call<{ pointId: string; support: boolean }, { supported: boolean }>(
  'supportPoint',
);
/** Propose a fix for a point; its supporters are told and say if it worked. */
export const proposeFix = call<Terms & { pointId: string; text: string }, { id: string }>('proposeFix');
export type FixRating = 'full' | 'partial' | 'none';
/** `rating: null` takes yours back. */
export const rateFix = call<
  { pointId: string; fixId: string; rating: FixRating | null },
  { rating: FixRating | null; status: PointStatus }
>('rateFix');

/**
 * Add a one-line detail to your own complaint (the model then re-reads the
 * whole complaint), or dismiss one of its "potentially missing" suggestions
 * (`item`, as listed, with no text).
 */
export const addDetail = call<
  { submissionId: string; item?: string; text?: string },
  /** `reread`: the model read the complaint again with the detail; `filedUnder`: pages its points gained. */
  { ok: boolean; reread: boolean; filedUnder: string[] }
>('addDetail');

/** Random public names to shuffle through; only `setName` changes anything. */
export const nameOptions = call<Record<string, never>, { names: string[] }>('nameOptions');
export const setName = call<{ name: string }, { name: string }>('setName');

/** A reader's "Best rant" vote for one complaint. */
export const loveRant = call<{ submissionId: string; love: boolean }, { loved: boolean; loves: number }>('loveRant');
export const voteFix = call<{ pointId: string; orgId: string; fixed: boolean }, { status: PointStatus }>('voteFix');

export const requestAccess = call<Terms & { subjectId: string; website?: string }, { status: 'approved' | 'pending' }>(
  'requestAccess',
);
export const markSeen = call<{ pointId: string; subjectId: string }, { seen: boolean }>('markSeen');
export const respondToPoint = call<
  Terms & { pointId: string; subjectId: string; text?: string; status?: PointStatus | null },
  { ok: boolean }
>('respondToPoint');

export type ReportKind = 'point' | 'submission' | 'response' | 'solution' | 'subject' | 'message' | 'thread';
export type ReportReason = 'abuse' | 'private_person' | 'personal_data' | 'spam' | 'illegal' | 'other';
export const report = call<
  { kind: ReportKind; id: string; pointId?: string; orgId?: string; threadId?: string; reason: ReportReason; note?: string },
  { ok: boolean }
>('report');

export const setPush = call<{ on: boolean; token?: string; platform?: string }, { on: boolean }>('setPush');

// Operator queue.
export const operatorClaim = call<
  { claimId: string; action: 'approve' | 'deny' | 'website'; reason?: string; website?: string },
  { status: string }
>('operatorClaim');
export const resolveReport = call<
  { reportId: string; action: 'remove' | 'dismiss' | 'suspend'; reason?: string },
  { ok: boolean }
>('resolveReport');

/** The message a callable threw, for showing to the person. */
/**
 * What to tell a person when a call fails: the server's own sentence when it
 * wrote one for people, otherwise a plain one. Never a code.
 */
export function errorText(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const code = (err?.code ?? '').replace(/^functions\//, '');
  const m = (err?.message ?? '').replace(/\s*\[\d+\]\s*$/, '').trim();
  if (code === 'unavailable' || /network|fetch|offline/i.test(m)) return "Can't reach UCS right now. Check your connection and try again.";
  if (code === 'resource-exhausted') return m || 'Easy there. Too many tries in a row; give it a minute.';
  if (code === 'deadline-exceeded') return 'That took too long. Try once more.';
  if (code === 'unauthenticated') return 'Still signing you in. Try again in a second.';
  if (!m || m.startsWith('internal') || /^[A-Z_\-]+$/.test(m)) return 'Something broke on our side. Try again.';
  return m;
}
