import { httpsCallable } from 'firebase/functions';

import { functions } from '@/lib/firebase';
import type { Analysis, PointHit, PointStatus } from '@/lib/types';

function call<In, Out>(name: string) {
  const fn = httpsCallable<In, Out>(functions, name);
  return async (data: In) => (await fn(data)).data;
}

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
  Analysis
>('analyzeComplaint');

export const submitComplaint = call<
  {
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
export const sendMessage = call<ThreadRef & { text: string }, { ok: boolean }>('sendMessage');
export const setThreadStatus = call<ThreadRef & { status: 'open' | 'resolved' }, { status: string }>(
  'setThreadStatus',
);
export const markThreadRead = call<ThreadRef, { ok: boolean }>('markThreadRead');
export const setOrgSettings = call<{ subjectId: string; publishPrivate: boolean }, { publishPrivate: boolean }>(
  'setOrgSettings',
);
export const deleteAccount = call<{ confirm: true }, { deleted: boolean }>('deleteAccount');

export const supportPoint = call<{ pointId: string; support: boolean }, { supported: boolean }>(
  'supportPoint',
);
export const voteFix = call<{ pointId: string; fixed: boolean }, { status: PointStatus }>('voteFix');

export const requestAccess = call<{ subjectId: string; website?: string }, { status: 'approved' | 'pending' }>(
  'requestAccess',
);
export const markSeen = call<{ pointId: string; subjectId: string }, { seen: boolean }>('markSeen');
export const respondToPoint = call<
  { pointId: string; subjectId: string; text?: string; status?: PointStatus | null },
  { ok: boolean }
>('respondToPoint');

/** The message a callable threw, for showing to the person. */
export function errorText(e: unknown): string {
  const m = (e as { message?: string })?.message;
  return m && !m.startsWith('internal') ? m : 'Something went wrong. Try again.';
}
