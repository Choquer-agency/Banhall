import { internalMutation } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { getReportBody, writeReportBody } from "./lib/reportBodies";

// Start with cursor: null after the widened schema and code are deployed.
// A repeated run can safely revisit any page.
export const copyLegacyBodies = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("reports").paginate({
      cursor: args.cursor,
      numItems: 4,
      maximumBytesRead: 4_000_000,
    });
    for (const report of page.page) {
      if (report.content === undefined) continue;
      if (!(await getReportBody(ctx, report._id))) {
        await writeReportBody(ctx, report, {
          content: report.content,
          revisionNumber: report.revisionNumber ?? 0,
          contentHash: report.contentHash,
          updatedAt: report.updatedAt,
          provenanceId: report.provenanceId,
        });
      }
      await ctx.db.patch(report._id, { content: undefined });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("reportBodiesMigration:copyLegacyBodies"), {
        cursor: page.continueCursor,
      });
    }
    return { done: page.isDone, processed: page.page.length, nextCursor: page.continueCursor };
  },
});
