import { query } from "./_generated/server";
import { v } from "convex/values";
import { getInternalProjectAccessOrNull } from "./lib/auth";

export const getTranscript = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;

    return await ctx.db
      .query("transcripts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first();
  },
});
