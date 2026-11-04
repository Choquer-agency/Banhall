import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * B1, second part (2026-10-27): a company file's stored text versions go
 * once the file has been removed and no draft row refers to them (part 4 of
 * the first 2026-10-26 entry: "until the company file and every draft using
 * it is erased"). A project's versions go with the project
 * (`PROJECT_SCOPED_TABLES`).
 *
 * The check and the delete happen in one transaction, so a draft row written
 * at the same moment either keeps the version or, finding none, stores the
 * text again. Pieces go after, page by page, by the deleted version's id
 * only, so a replacement version's pieces are never touched.
 */

const SWEEP_PAGE = 50;
const PIECE_PAGE = 100;

/** Deletes one company version that no draft row uses; true when it did. */
async function deleteIfUnused(ctx: MutationCtx, version: Doc<"sourceTextVersions">): Promise<boolean> {
  if (!version.companyFileId) return false;
  if (await ctx.db.get(version.companyFileId)) return false;
  const used = await ctx.db
    .query("generationSources")
    .withIndex("by_textVersionId", (q) => q.eq("textVersionId", version._id))
    .first();
  if (used) return false;
  await ctx.db.delete(version._id);
  await ctx.scheduler.runAfter(0, internal.sourceTextSweep.deleteVersionPieces, { versionId: version._id });
  return true;
}

/**
 * Every version of the company files, one page a run, the next scheduled:
 * after a company file is removed (for that file), and daily for all (a draft
 * using a removed file's text may have been erased since).
 */
export const sweepCompanyTextVersions = internalMutation({
  args: { companyFileId: v.optional(v.id("companyFiles")), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const companyFileId = args.companyFileId;
    const page = await (companyFileId
      ? ctx.db
          .query("sourceTextVersions")
          .withIndex("by_companyFileId_and_textHash", (q) => q.eq("companyFileId", companyFileId))
      : ctx.db
          .query("sourceTextVersions")
          // Every version with a company file (ids sort after "").
          .withIndex("by_companyFileId_and_textHash", (q) => q.gt("companyFileId", "" as Id<"companyFiles">))
    ).paginate({ numItems: SWEEP_PAGE, cursor: args.cursor ?? null });
    for (const version of page.page) await deleteIfUnused(ctx, version);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.sourceTextSweep.sweepCompanyTextVersions, {
        ...(companyFileId ? { companyFileId } : {}),
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

/** A deleted version's pieces, one page a run. */
export const deleteVersionPieces = internalMutation({
  args: { versionId: v.id("sourceTextVersions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pieces = await ctx.db
      .query("sourceTextVersionPieces")
      .withIndex("by_versionId_and_start", (q) => q.eq("versionId", args.versionId))
      .take(PIECE_PAGE);
    for (const piece of pieces) await ctx.db.delete(piece._id);
    if (pieces.length === PIECE_PAGE) {
      await ctx.scheduler.runAfter(0, internal.sourceTextSweep.deleteVersionPieces, { versionId: args.versionId });
    }
    return null;
  },
});
