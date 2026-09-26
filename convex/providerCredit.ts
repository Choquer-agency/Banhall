import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import {
  ANTHROPIC_CREDIT_NOTICE,
  ANTHROPIC_CREDIT_NOTICE_SOURCE,
  creditRoute,
} from "../shared/anthropicCreditFallback";

// Owner decision 64 (2026-09-26): the "direct Anthropic is out of credit"
// latch (schema.ts anthropicCreditLatch). Read and written only by the
// credit fallback in convex/ai/anthropicCredit.ts; the policy itself lives
// in shared/anthropicCreditFallback.ts.

async function latchRow(ctx: Pick<QueryCtx, "db">) {
  return await ctx.db
    .query("anthropicCreditLatch")
    .withIndex("by_key", (q) => q.eq("key", "direct"))
    .unique();
}

/** The latch, or null when calls go direct. */
export const latchState = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ latchedAt: v.number(), probeStartedAt: v.optional(v.number()) })
  ),
  handler: async (ctx) => {
    const row = await latchRow(ctx);
    if (!row) return null;
    return {
      latchedAt: row.latchedAt,
      ...(row.probeStartedAt !== undefined ? { probeStartedAt: row.probeStartedAt } : {}),
    };
  },
});

/**
 * Claims the one direct try after the cool-down. Returns "probe" to the one
 * caller that got it, "direct" when the latch is already gone, and
 * "openrouter" to everyone else.
 */
export const claimProbe = internalMutation({
  args: {},
  returns: v.union(v.literal("direct"), v.literal("openrouter"), v.literal("probe")),
  handler: async (ctx) => {
    const row = await latchRow(ctx);
    const now = Date.now();
    const route = creditRoute(row, now);
    if (route === "probe" && row) await ctx.db.patch("anthropicCreditLatch", row._id, { probeStartedAt: now });
    return route;
  },
});

/**
 * A direct call was refused for lack of credit. The first refusal sets the
 * latch and raises the Alerts board notice; a failed probe restarts the
 * cool-down; any other refusal while latched changes nothing (a call that
 * read the state before another call latched it). Returns whether this call
 * set the latch.
 */
export const latchDirectCredit = internalMutation({
  args: { probe: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await latchRow(ctx);
    const now = Date.now();
    if (row) {
      if (args.probe) await ctx.db.patch("anthropicCreditLatch", row._id, { latchedAt: now, probeStartedAt: undefined });
      return false;
    }
    const noticeId = await ctx.db.insert("errorReports", {
      kind: "auto",
      reportType: "bug",
      message: ANTHROPIC_CREDIT_NOTICE,
      source: ANTHROPIC_CREDIT_NOTICE_SOURCE,
      url: "/alerts",
      breadcrumbs: [],
      status: "open",
      createdAt: now,
    });
    await ctx.db.insert("anthropicCreditLatch", { key: "direct", latchedAt: now, noticeId });
    return true;
  },
});

/**
 * The probe failed for a reason other than credit (a rate limit, say): the
 * latch stays, and the next call may try direct again.
 */
export const releaseProbe = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await latchRow(ctx);
    if (row?.probeStartedAt !== undefined) {
      await ctx.db.patch("anthropicCreditLatch", row._id, { probeStartedAt: undefined });
    }
    return null;
  },
});

/**
 * The probe went through on direct: the account has credit again. Clears
 * the latch and resolves its notice, which no longer holds.
 */
export const clearDirectCreditLatch = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await latchRow(ctx);
    if (!row) return null;
    if (row.noticeId) {
      const notice = await ctx.db.get("errorReports", row.noticeId);
      if (notice?.status === "open") await ctx.db.patch("errorReports", notice._id, { status: "resolved" });
    }
    await ctx.db.delete("anthropicCreditLatch", row._id);
    return null;
  },
});
