import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * Report chat parity, Phase C (2026-10-20), W3: an admin's "Delete
 * permanently". `chatV2.deleteThread` removes the conversation's row first,
 * so it leaves every menu and refuses every send at once; the scheduled
 * `chatV2.purgeThread` then deletes, in pages, everything keyed by the
 * conversation, and finally the agent component's thread (its messages and
 * streams). `aiUsage` rows stay: they are billing records.
 */

export const PURGE_STEPS = ["feedback", "proposals", "webSearches", "turns"] as const;
export type PurgeStep = (typeof PURGE_STEPS)[number];
export const purgeStepValidator = v.union(
  v.literal("feedback"),
  v.literal("proposals"),
  v.literal("webSearches"),
  v.literal("turns"),
);

/** Deletes per scheduled run, across tables. */
export const PURGE_BUDGET = 400;

/**
 * One run: deletes up to PURGE_BUDGET rows from `step` on. Returns the step
 * to continue from in another run, or null once every keyed table is empty
 * (the caller then deletes the component thread).
 */
export async function purgeThreadRows(
  ctx: MutationCtx,
  agentThreadId: string,
  from: PurgeStep = PURGE_STEPS[0]
): Promise<PurgeStep | null> {
  let budget = PURGE_BUDGET;
  for (let index = PURGE_STEPS.indexOf(from); index < PURGE_STEPS.length; index += 1) {
    const step = PURGE_STEPS[index];
    const result = await purgeStep(ctx, agentThreadId, step, budget);
    budget -= result.deleted;
    if (!result.done) return step;
  }
  return null;
}

async function purgeStep(
  ctx: MutationCtx,
  agentThreadId: string,
  step: PurgeStep,
  budget: number
): Promise<{ deleted: number; done: boolean }> {
  if (budget <= 0) return { deleted: 0, done: false };
  switch (step) {
    case "feedback": {
      const rows = await ctx.db
        .query("chatAnswerFeedback")
        .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
        .take(budget);
      for (const row of rows) await ctx.db.delete(row._id);
      return { deleted: rows.length, done: rows.length < budget };
    }
    case "webSearches": {
      const rows = await ctx.db
        .query("chatWebSearches")
        .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
        .take(budget);
      for (const row of rows) await ctx.db.delete(row._id);
      return { deleted: rows.length, done: rows.length < budget };
    }
    case "turns": {
      const rows = await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", agentThreadId))
        .take(budget);
      for (const row of rows) await ctx.db.delete(row._id);
      return { deleted: rows.length, done: rows.length < budget };
    }
    case "proposals": {
      // A card goes after its checklist items and wording edit events.
      let deleted = 0;
      for (;;) {
        const proposal = await ctx.db
          .query("chatProposals")
          .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
          .first();
        if (!proposal) return { deleted, done: true };
        const itemRoom = budget - deleted;
        const items = await ctx.db
          .query("chatProposalItems")
          .withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id))
          .take(itemRoom);
        for (const item of items) await ctx.db.delete(item._id);
        deleted += items.length;
        if (deleted >= budget) return { deleted, done: false };
        const events = await ctx.db
          .query("proposalWordingEditEvents")
          .withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id))
          .take(budget - deleted);
        for (const event of events) await ctx.db.delete(event._id);
        deleted += events.length;
        if (deleted >= budget) return { deleted, done: false };
        await ctx.db.delete(proposal._id);
        deleted += 1;
        if (deleted >= budget) return { deleted, done: false };
      }
    }
  }
}
