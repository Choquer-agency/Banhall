import { getConvexSize, v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, TableNames } from "../_generated/dataModel";

/**
 * Report chat parity, Phase C (2026-10-20), W3: an admin's "Delete
 * permanently". `chatV2.deleteThread` marks the conversation's row
 * (`deletingAt`), which hides it from every read and send at once; the
 * scheduled `chatV2.purgeThread` then deletes, one bounded page per run,
 * everything keyed by the conversation, and last the agent component's
 * thread and the row itself. `aiUsage` rows stay: they are billing records.
 *
 * Review R2 P2-1: a run deletes at most PURGE_PAGE_ROWS rows and reads
 * about PURGE_MAX_BYTES_READ bytes (one row past it at most) (applied cards carry `appliedChange` of up to
 * 600 KB), the budget project erasure uses. Every run is idempotent: it
 * starts from whatever rows are left. While the row stands, a failed run is
 * resumed by `chatV2.resumeStalledThreadPurges`, and project erasure still
 * reaches every child through it.
 */

export const PURGE_STEPS = ["feedback", "proposals", "webSearches", "turns"] as const;
export type PurgeStep = (typeof PURGE_STEPS)[number];
export const purgeStepValidator = v.union(
  v.literal("feedback"),
  v.literal("proposals"),
  v.literal("webSearches"),
  v.literal("turns"),
);

/** Rows one run deletes, across tables (project erasure's page size). */
export const PURGE_PAGE_ROWS = 100;
/** Bytes one run reads (project erasure's page budget). */
export const PURGE_MAX_BYTES_READ = 4 * 1024 * 1024;
/** A deleting conversation whose purge made no progress this long is resumed. */
export const PURGE_STALL_MS = 10 * 60 * 1000;

type Budget = { rows: number; bytes: number };

function spent(budget: Budget): boolean {
  return budget.rows <= 0 || budget.bytes <= 0;
}

/**
 * One run: deletes rows from `from` on until the budget is spent. Returns
 * the step to continue from in another run, or null once every keyed table
 * is empty (the caller then deletes the component thread and the row).
 */
export async function purgeThreadRows(
  ctx: MutationCtx,
  agentThreadId: string,
  from: PurgeStep = PURGE_STEPS[0]
): Promise<PurgeStep | null> {
  const budget: Budget = { rows: PURGE_PAGE_ROWS, bytes: PURGE_MAX_BYTES_READ };
  for (let index = PURGE_STEPS.indexOf(from); index < PURGE_STEPS.length; index += 1) {
    const step = PURGE_STEPS[index];
    const done = await purgeStep(ctx, agentThreadId, step, budget);
    if (!done) return step;
    if (spent(budget)) return PURGE_STEPS[index + 1] ?? null;
  }
  return null;
}

/**
 * Deletes rows from `rows` until the budget is spent, charging each row's
 * size. True when `rows` ran out (the table holds no more of them). Read
 * one by one, not with `paginate`: a function may paginate only once.
 */
async function deleteRows<Row extends Doc<TableNames>>(
  ctx: MutationCtx,
  rows: AsyncIterable<Row>,
  budget: Budget
): Promise<boolean> {
  for await (const row of rows) {
    if (spent(budget)) return false;
    budget.rows -= 1;
    budget.bytes -= getConvexSize(row);
    await ctx.db.delete(row._id);
  }
  return true;
}

/** True when `step`'s rows are all gone. */
async function purgeStep(
  ctx: MutationCtx,
  agentThreadId: string,
  step: PurgeStep,
  budget: Budget
): Promise<boolean> {
  if (spent(budget)) return false;
  switch (step) {
    case "feedback":
      return await deleteRows(ctx, ctx.db
        .query("chatAnswerFeedback")
        .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId)), budget);
    case "webSearches":
      return await deleteRows(ctx, ctx.db
        .query("chatWebSearches")
        .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId)), budget);
    case "turns":
      return await deleteRows(ctx, ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", agentThreadId)), budget);
    case "proposals": {
      // A card goes after its checklist items and wording edit events.
      while (!spent(budget)) {
        const proposal = await ctx.db
          .query("chatProposals")
          .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
          .first();
        if (!proposal) return true;
        budget.bytes -= getConvexSize(proposal);
        const items = ctx.db
          .query("chatProposalItems")
          .withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id));
        if (!(await deleteRows(ctx, items, budget))) return false;
        const events = ctx.db
          .query("proposalWordingEditEvents")
          .withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id));
        if (!(await deleteRows(ctx, events, budget))) return false;
        if (spent(budget)) return false;
        await ctx.db.delete(proposal._id);
        budget.rows -= 1;
      }
      return false;
    }
  }
}
