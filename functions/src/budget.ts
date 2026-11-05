/**
 * The hard ceiling on what the AI can cost in a day, whatever anyone does.
 *
 * Every model call checks today's spend before it runs and adds its real
 * cost (from the response's token counts) after. Past the ceiling, checking
 * complaints pauses until midnight UTC; search, support and everything
 * else keep working. The ceiling lives in `config/ai.dailyBudgetUsd`
 * (default DEFAULT_DAILY_BUDGET_USD); `npm run usage` shows the spend.
 */
import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue } from './common';

export const DEFAULT_DAILY_BUDGET_USD = 25;
/** Embedding calls are fractions of a cent; this only stops a runaway loop. */
const DAILY_EMBEDDING_CALLS = 50_000;

/**
 * Per million tokens. Set at the highest-priced model a request can land on
 * (the refusal fallback can run on a pricier one), so the estimate never
 * runs low.
 */
const PRICE_PER_MTOK = { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 };

const today = () => new Date().toISOString().slice(0, 10);
const usageRef = () => db.doc(`usage/${today()}`);

async function dailyBudget(): Promise<number> {
  const config = await db.doc('config/ai').get();
  const v = config.get('dailyBudgetUsd');
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_DAILY_BUDGET_USD;
}

/** Call before a Claude request; throws once today's ceiling is reached. */
export async function assertBudget() {
  const [usage, budget] = await Promise.all([usageRef().get(), dailyBudget()]);
  const spent = (usage.get('costUsd') as number | undefined) ?? 0;
  if (spent >= budget) {
    if (!usage.get('pausedAt')) {
      await usageRef().set({ pausedAt: FieldValue.serverTimestamp() }, { merge: true });
      console.error(`AI budget reached: $${spent.toFixed(2)} of $${budget} today. Complaint checking is paused.`);
    }
    throw new HttpsError(
      'resource-exhausted',
      'Checking complaints is paused for today. Search and "Me too" still work; try again tomorrow.',
    );
  }
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

export async function countEmbeddingCall() {
  const usage = await usageRef().get();
  if (((usage.get('embeddingCalls') as number | undefined) ?? 0) >= DAILY_EMBEDDING_CALLS) {
    throw new HttpsError('resource-exhausted', 'Search is paused for today. Try again tomorrow.');
  }
  await usageRef().set({ embeddingCalls: FieldValue.increment(1) }, { merge: true });
}
