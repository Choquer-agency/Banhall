import { action, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
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
};

type CopyResult = {
  documentsCopied: number;
  filesCopied: number;
  evidenceCopied: number;
  pdReviewsCopied: number;
  reportCopied: boolean;
};

/**
 * Shared internals of the content copy: destination rows are created
 * atomically by projects.prepareProjectContentCopy, then original file bytes
 * are cloned (never shared storage ids), then the copied rows are patched
 * with their new storage ids. Used by the duplicate-wizard action below and
 * by reviewFromProject.createReviewFromProject (2026-08-11 second amendment).
 */
export async function copyProjectContentBetween(
  ctx: ActionCtx,
  args: {
    fromProjectId: Id<"projects">;
    toProjectId: Id<"projects">;
    targetTranscriptId?: Id<"transcripts">;
  }
): Promise<CopyResult> {
  const plan: CopyPlan = await ctx.runMutation(
    api.projects.prepareProjectContentCopy,
    args
  );
  const storageCopies: Array<{
    documentId: Id<"projectDocuments">;
    storageId: Id<"_storage">;
  }> = [];

  for (const document of plan.documents) {
    if (!document.storageId) continue;
    const blob = await ctx.storage.get(document.storageId);
    if (!blob) continue;
    storageCopies.push({
      documentId: document.documentId,
      storageId: await ctx.storage.store(blob),
    });
  }

  await ctx.runMutation(api.projects.finishProjectContentCopy, {
    toProjectId: args.toProjectId,
    storageCopies,
  });

  return {
    documentsCopied: plan.documents.length,
    filesCopied: storageCopies.length,
    evidenceCopied: plan.evidenceCopied,
    pdReviewsCopied: plan.pdReviewsCopied,
    reportCopied: plan.reportId !== undefined,
  };
}

/**
 * Copies the complete project input package after the duplicate wizard creates
 * its destination project. Original file bytes are cloned rather than sharing
 * storage ids, so deleting a document from either project cannot break the
 * other copy.
 */
export const copyProjectContent = action({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
    targetTranscriptId: v.id("transcripts"),
  },
  handler: async (ctx, args): Promise<CopyResult> => {
    return await copyProjectContentBetween(ctx, args);
  },
});
