import { httpsCallable } from 'firebase/functions';

import { functions } from '@/lib/firebase';
import type { Analysis, PointHit, PointStatus } from '@/lib/types';

function call<In, Out>(name: string) {
  const fn = httpsCallable<In, Out>(functions, name);
  return async (data: In) => (await fn(data)).data;
}

export const searchPoints = call<
  { query: string },
  { points: PointHit[]; subjects: { id: string; name: string; kind: string; description: string }[] }
>('searchPoints');

export const analyzeComplaint = call<
  { text: string; photoPaths: string[]; subjectId?: string },
  Analysis
>('analyzeComplaint');

export const submitComplaint = call<
  { draftId: string; useRewrite: boolean; removePII: boolean; keepPoints: number[] },
  { submissionId: string; matchedPointIds: string[]; addedPointIds: string[] }
>('submitComplaint');

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
