import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

type CopyPlan = {
  documents: Array<{
    sourceId: Id<"projectDocuments">;
    documentId: Id<"projectDocuments">;
    storageId?: Id<"_storage">;
  }>;
  evidenceCopied: number;
  pdReviewsCopied: number;
  reportId?: Id<"reports">;
  previousYearReportId?: Id<"projectDocuments">;
};

type CopyResult = {
  documentsCopied: number;
  filesCopied: number;
  transcriptOriginalsCopied: number;
  evidenceCopied: number;
  pdReviewsCopied: number;
  reportCopied: boolean;
  previousYearReportCopied: boolean;
};

/**
 * Shared internals of the content copy: destination rows are created
 * atomically by projects.prepareProjectContentCopy, the copied transcripts'
 * original files are found by projects.planTranscriptOriginalCopies, then
 * original file bytes are cloned (never shared storage ids), then the copied
 * rows are patched with their new storage ids. Used by the duplicate-wizard action below and
 * by reviewFromProject.createReviewFromProject (2026-08-11 second amendment).
 *
 * Both mutations are internal (owner decision 35, 2026-09-25): every storage
 * id they attach was made here by `ctx.storage.store`.
 */
export async function copyProjectContentBetween(
  ctx: ActionCtx,
  args: {
    fromProjectId: Id<"projects">;
    toProjectId: Id<"projects">;
    targetTranscriptId?: Id<"transcripts">;
    /** Defaults to true; see projects.prepareProjectContentCopy. */
    includeReport?: boolean;
    /** Defaults to true; see projects.prepareProjectContentCopy. */
    includeReviews?: boolean;
    excludeDocumentIds?: Id<"projectDocuments">[];
    previousYearReport?: boolean;
    requireFreshTarget?: boolean;
  }
): Promise<CopyResult> {
  const plan: CopyPlan = await ctx.runMutation(
    internal.projects.prepareProjectContentCopy,
    args
  );
  const transcriptOriginals: Array<{
    transcriptId: Id<"transcripts">;
    storageId: Id<"_storage">;
  }> = await ctx.runQuery(internal.projects.planTranscriptOriginalCopies, {
    fromProjectId: args.fromProjectId,
    toProjectId: args.toProjectId,
  });
  const storageCopies: Array<{
    documentId: Id<"projectDocuments">;
    storageId: Id<"_storage">;
  }> = [];
  const transcriptCopies: Array<{
    transcriptId: Id<"transcripts">;
    storageId: Id<"_storage">;
  }> = [];

  try {
    for (const document of plan.documents) {
      if (!document.storageId) continue;
      const blob = await ctx.storage.get(document.storageId);
      if (!blob) continue;
      storageCopies.push({
        documentId: document.documentId,
        storageId: await ctx.storage.store(blob),
      });
    }
    // Transcript originals (.docx, .vtt, .srt) come along too.
    for (const original of transcriptOriginals) {
      const blob = await ctx.storage.get(original.storageId);
      if (!blob) continue;
      transcriptCopies.push({
        transcriptId: original.transcriptId,
        storageId: await ctx.storage.store(blob),
      });
    }

    await ctx.runMutation(internal.projects.finishProjectContentCopy, {
      toProjectId: args.toProjectId,
      storageCopies,
      transcriptCopies,
    });
  } catch (error) {
    // Nothing points at a clone until finish commits, so release them rather
    // than leave them for the storage sweep.
    for (const copy of [...storageCopies, ...transcriptCopies]) {
      await ctx.storage.delete(copy.storageId).catch(() => undefined);
    }
    throw error;
  }

  return {
    documentsCopied: plan.documents.length,
    filesCopied: storageCopies.length,
    transcriptOriginalsCopied: transcriptCopies.length,
    evidenceCopied: plan.evidenceCopied,
    pdReviewsCopied: plan.pdReviewsCopied,
    reportCopied: plan.reportId !== undefined,
    previousYearReportCopied: plan.previousYearReportId !== undefined,
  };
}

/**
 * Copies the project input package after the duplicate wizard creates its
 * destination project. Original file bytes are cloned rather than sharing
 * storage ids, so deleting a document from either project cannot break the
 * other copy.
 *
 * The plain duplicate is a full clone. A duplicate made to draft again (the
 * card Duplicate, 2026-09-25) passes `includeReport: false`, and
 * `includeReviews: false` unless it is a Review PD project, so the new
 * project holds only the inputs its own generation will read.
 *
 * Owner decision 35 (2026-09-25): the writer can untick files
 * (`excludeDocumentIds`), a year-over-year duplicate can bring the old report
 * in as last year's report (`previousYearReport`), and the copy only ever
 * writes into a project the caller has just created.
 */
export const copyProjectContent = action({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
    // Absent when the duplicate carries no transcript at all: the report copy
    // simply has no source transcript to cite.
    targetTranscriptId: v.optional(v.id("transcripts")),
    includeReport: v.optional(v.boolean()),
    includeReviews: v.optional(v.boolean()),
    excludeDocumentIds: v.optional(v.array(v.id("projectDocuments"))),
    previousYearReport: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CopyResult> => {
    return await copyProjectContentBetween(ctx, { ...args, requireFreshTarget: true });
  },
});
