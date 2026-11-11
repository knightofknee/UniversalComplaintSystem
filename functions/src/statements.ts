/**
 * Statements: what each complaint says about each issue it raises.
 *
 * An issue (a `points` document) is one thing wrong that many complaints
 * can share. When a complaint comes in, the model pulls out, for each issue
 * it raises, that complaint's own account of it (`said`: the specifics, in
 * the author's words). Those accounts live under the issue at
 * `points/{pointId}/statements/{submissionId}`, one per complaint, so an
 * issue's page reads as everything people said about it, each line linking
 * back to the complaint it came from.
 *
 * A statement follows its complaint: renamed, moved to another account,
 * deleted or removed, the statements change with it (`syncStatements`), so
 * every path that edits a complaint needs no code of its own here.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';

import { db, FieldValue } from './common';
import { stripSensitive } from './private';

/** Longest statement kept (the model is asked for one to three sentences). */
const MAX_STATEMENT = 600;

export function cleanStatement(text: string | undefined | null): string {
  const t = stripSensitive((text ?? '').replace(/\s+/g, ' ').trim());
  return t.length > MAX_STATEMENT ? `${t.slice(0, MAX_STATEMENT - 1).trimEnd()}…` : t;
}

/** Joins what one complaint says about one issue (the model may list an issue twice). */
export function joinSaid(parts: string[]): string {
  const seen = new Set<string>();
  return cleanStatement(parts.map((p) => p.trim()).filter((p) => p && !seen.has(p) && seen.add(p)).join(' '));
}

export async function writeStatements(args: {
  submissionId: string;
  authorId: string;
  authorName: string;
  imported: boolean;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  said: Map<string, string[]>;
}) {
  await Promise.all(
    [...args.said.entries()].map(([pointId, parts]) => {
      const text = joinSaid(parts);
      if (!text) return null;
      return db.doc(`points/${pointId}/statements/${args.submissionId}`).set({
        text,
        submissionId: args.submissionId,
        authorId: args.authorId,
        authorName: args.authorName,
        imported: args.imported,
        removed: false,
        createdAt: args.createdAt,
      });
    }),
  );
}

/** Statements move with their complaints when two issues are merged (duplicates.ts). */
export async function moveStatements(goneRef: DocumentReference, keepRef: DocumentReference) {
  const docs = await goneRef.collection('statements').get();
  for (const d of docs.docs) {
    const target = keepRef.collection('statements').doc(d.id);
    const existing = await target.get();
    if (existing.exists) {
      // The same complaint said something about both: one statement, both parts.
      const both = joinSaid([existing.get('text') as string, d.get('text') as string]);
      await target.update({ text: both });
    } else {
      await target.set(d.data());
    }
    await d.ref.delete();
  }
}

function pointIdsOf(data: FirebaseFirestore.DocumentData | undefined): string[] {
  return [
    ...new Set([
      ...((data?.addedPointIds as string[] | undefined) ?? []),
      ...((data?.matchedPointIds as string[] | undefined) ?? []),
    ]),
  ];
}

export const syncStatements = onDocumentUpdated('submissions/{id}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const gone = after.removed === true || after.text === '[deleted]';
  const wasGone = before.removed === true || before.text === '[deleted]';
  const update: Record<string, unknown> = {};
  if (gone !== wasGone) update.removed = gone;
  // Deleted by its author (or with their account): the words go too. A
  // moderator's removal only hides them, so it can be undone.
  if (after.text === '[deleted]' && before.text !== '[deleted]') update.text = FieldValue.delete();
  if (after.authorName !== before.authorName) update.authorName = after.authorName;
  if (after.authorId !== before.authorId) update.authorId = after.authorId;
  if (Object.keys(update).length === 0) return;
  // Issues it was dropped from too (a merge), in case a statement is still there.
  const ids = new Set([...pointIdsOf(after), ...pointIdsOf(before)]);
  await Promise.all(
    [...ids].map(async (pid) => {
      const ref = db.doc(`points/${pid}/statements/${event.params.id}`);
      if ((await ref.get()).exists) await ref.update(update);
    }),
  );
});
