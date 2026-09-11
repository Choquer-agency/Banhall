import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getInternalProjectAccessOrNull } from "./lib/auth";

/**
 * Story 2 (CAP-7, AD-25): the one read of Compliance Notes. The QA rail, the
 * Editor's section-end line and the chat Deviation Inventory all read through
 * here. Rows are written only by the ordered section-chain mutations in
 * convex/generations.ts (completeOrderedSectionRun, insertConsistencyNotes).
 *
 * Without a candidateRunId, a compare generation that has a selected report
 * returns the selected candidate's rows (the report inherits them on
 * selectReportCandidate); otherwise every row of the generation is returned.
 */
export const listForGeneration = query({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.optional(v.id("generationCandidateRuns")),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) {
      return [];
    }
    let candidateRunId: Id<"generationCandidateRuns"> | undefined =
      args.candidateRunId;
    if (
      candidateRunId === undefined &&
      (generation.candidateMode ?? "compare") === "compare"
    ) {
      const selection = await ctx.db
        .query("modelSelections")
        .withIndex("by_projectId_and_generationId", (q) =>
          q.eq("projectId", generation.projectId).eq("generationId", generation._id)
        )
        .first();
      if (selection) {
        const selectedRun = await ctx.db
          .query("generationCandidateRuns")
          .withIndex("by_generationId_and_model", (q) =>
            q.eq("generationId", generation._id).eq("model", selection.model)
          )
          .unique();
        if (selectedRun) candidateRunId = selectedRun._id;
      }
    }
    if (candidateRunId !== undefined) {
      const scoped = candidateRunId;
      return await ctx.db
        .query("complianceNotes")
        .withIndex("by_generationId_and_candidateRunId_and_section", (q) =>
          q.eq("generationId", generation._id).eq("candidateRunId", scoped)
        )
        .take(1000);
    }
    return await ctx.db
      .query("complianceNotes")
      .withIndex("by_generationId_and_section", (q) =>
        q.eq("generationId", generation._id)
      )
      .take(1000);
  },
});
