import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getInternalProjectAccessOrNull } from "./lib/auth";

/**
 * The one selected-candidate scoping rule for Compliance Notes. A `compare`
 * generation whose candidate has been selected owns exactly that candidate's
 * rows (candidate rows are deleted on selection; the run keeps its
 * `candidateId`), so the QA rail, the Editor's section-end line and the chat
 * Deviation Inventory all scope the same way. Exported because
 * `convex/chatV2.ts:getDeviationInventoryContext` reads the same rows for the
 * chat tools: two copies of this would agree only until one of them changed.
 */
export async function selectedCandidateRunId(
  ctx: QueryCtx,
  generation: Doc<"generations">
): Promise<Id<"generationCandidateRuns"> | undefined> {
  if ((generation.candidateMode ?? "compare") !== "compare") return undefined;
  const selection = await ctx.db
    .query("modelSelections")
    .withIndex("by_projectId_and_generationId", (q) =>
      q.eq("projectId", generation.projectId).eq("generationId", generation._id)
    )
    .first();
  if (!selection) return undefined;
  const runs = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  return runs.find((run) => run.candidateId === selection.candidateId)?._id;
}

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
    if (candidateRunId === undefined) {
      candidateRunId = await selectedCandidateRunId(ctx, generation);
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
