/**
 * The hard ceiling on what the AI can cost in a day, whatever anyone does.
 *
 * Every model call checks today's spend before it runs and adds its real
 * cost (from the response's token counts) after. Past the ceiling, checking
 * complaints pauses until midnight UTC, and complaints written meanwhile are
 * queued, never lost (`queue`, processed by `processQueue`). Search, support
 * and everything else keep working. The ceiling lives in
 * `config/ai.dailyBudgetUsd` (default DEFAULT_DAILY_BUDGET_USD);
 * `npm run usage` shows the spend.
 *
 * Embeddings (search, matching) and photo screening are fractions of a cent;
 * their daily caps only stop a runaway loop. Search and complaints have
 * separate caps, so heavy searching can never use up complaining.
 */
import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue } from './common';

export const DEFAULT_DAILY_BUDGET_USD = 25;
const DAILY_CALLS = { search: 40_000, intake: 20_000, vision: 5_000 } as const;
export type CallKind = keyof typeof DAILY_CALLS;

/**
 * Per million tokens. Set at the highest-priced model a request can land on
 * (the refusal fallback can run on a pricier one), so the estimate never
 * runs low.
 */
const PRICE_PER_MTOK = { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 };
/** Cloud Vision SafeSearch, per image. */
const VISION_USD = 0.0015;

export const today = () => new Date().toISOString().slice(0, 10);
const usageRef = () => db.doc(`usage/${today()}`);

export async function dailyBudget(): Promise<number> {
  const config = await db.doc('config/ai').get();
  const v = config.get('dailyBudgetUsd');
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_DAILY_BUDGET_USD;
}

/** The error a paused intake throws; `analyzeComplaint` turns it into a queued complaint. */
export class BudgetPaused extends HttpsError {
  constructor() {
    super('resource-exhausted', 'Checking complaints is paused for today. Search and supporting still work.');
  }
}

/** Is there room for another Claude call today? */
export async function budgetLeft(): Promise<boolean> {
  const [usage, budget] = await Promise.all([usageRef().get(), dailyBudget()]);
  return ((usage.get('costUsd') as number | undefined) ?? 0) < budget;
}

/** Call before a Claude request; throws BudgetPaused once today's ceiling is reached. */
export async function assertBudget() {
  if (await budgetLeft()) return;
  const usage = await usageRef().get();
  if (!usage.get('pausedAt')) {
    await usageRef().set({ pausedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.error('AI budget reached. Complaint checking is paused until midnight UTC; new complaints are queued.');
  }
  throw new BudgetPaused();
}

export async function recordClaudeUsage(u: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}) {
  const written = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const cost =
    (u.input_tokens * PRICE_PER_MTOK.input +
      written * PRICE_PER_MTOK.cacheWrite +
      read * PRICE_PER_MTOK.cacheRead +
      u.output_tokens * PRICE_PER_MTOK.output) /
    1_000_000;
  await usageRef().set(
    {
      claudeCalls: FieldValue.increment(1),
      inputTokens: FieldValue.increment(u.input_tokens + written + read),
      outputTokens: FieldValue.increment(u.output_tokens),
      costUsd: FieldValue.increment(cost),
    },
    { merge: true },
  );
}

/** Counts one cheap call against its own daily cap (and photo screening against the dollar total). */
export async function countCall(kind: CallKind) {
  const field = `calls.${kind}`;
  const usage = await usageRef().get();
  if (((usage.get(field) as number | undefined) ?? 0) >= DAILY_CALLS[kind]) {
    throw new HttpsError(
      'resource-exhausted',
      kind === 'search' ? 'Search is paused for today. Try again tomorrow.' : 'This is paused for today. Try again tomorrow.',
    );
  }
  await usageRef().set(
    { calls: { [kind]: FieldValue.increment(1) }, ...(kind === 'vision' ? { costUsd: FieldValue.increment(VISION_USD) } : {}) },
    { merge: true },
  );
}
