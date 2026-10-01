/**
 * The 2026-09-25 batched backfills (phase 4 generation structure).
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { v, type ObjectType } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import { missingSectionRunTypedFields } from "../sectionRunData";
import { internal } from "../../_generated/api";
import { isProjectDeleting } from "../projectDeletion";
import { appendGenerationProgress } from "../generationProgress";
import { moveOutputsToArtifacts, outputsInArtifacts } from "../generationOutputs";

// ─── 2026-09-25 migrations (phase 4 generation structure) ───────────────────
// Batched, self-rescheduling backfills in the repo's pattern (see
// transcripts.backfillTranscriptStructure). Each is idempotent: a second run
// patches nothing. Start each once with `{}`; `dryRun: true` reports one page
// without writing or scheduling.

export const SECTION_RUN_BACKFILL_PAGE_SIZE = 100;

export const SECTION_RUN_BACKFILL_MAX_BYTES_READ = 8 * 1024 * 1024;

/** Argument validators of generations.backfillSectionRunData. */
export const backfillSectionRunDataArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  pageSize: v.optional(v.number()),
  dryRun: v.optional(v.boolean()),
};

/** Handler of generations.backfillSectionRunData. */
export async function backfillSectionRunDataHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof backfillSectionRunDataArgs>
) {
  const pageSize = Math.min(
    Math.max(1, Math.floor(args.pageSize ?? SECTION_RUN_BACKFILL_PAGE_SIZE)),
    SECTION_RUN_BACKFILL_PAGE_SIZE
  );
  const page = await ctx.db.query("generationSectionRuns").paginate({
    cursor: args.cursor ?? null,
    numItems: pageSize,
    maximumBytesRead: SECTION_RUN_BACKFILL_MAX_BYTES_READ,
  });
  let patched = 0;
  for (const row of page.page) {
    const fields = missingSectionRunTypedFields(row);
    if (Object.keys(fields).length === 0) continue;
    if (!args.dryRun) await ctx.db.patch(row._id, fields);
    patched += 1;
  }
  if (!page.isDone && !args.dryRun) {
    await ctx.scheduler.runAfter(0, internal.generations.backfillSectionRunData, {
      cursor: page.continueCursor,
      ...(args.pageSize !== undefined ? { pageSize } : {}),
    });
  }
  return {
    scanned: page.page.length,
    patched,
    isDone: page.isDone,
    continueCursor: page.continueCursor,
  };
}

/** Generations per page of the progress backfill. With at most
 * PROGRESS_BACKFILL_MAX_LINES lines each, one page writes at most 4 000 rows. */
export const PROGRESS_BACKFILL_PAGE_SIZE = 8;

/** Lines copied per generation: the newest ones. Readers return at most
 * PROGRESS_READ_LIMIT (50) lines; the full array stays on the row. */
export const PROGRESS_BACKFILL_MAX_LINES = 500;

/** Each page writes a copy of what it reads (child rows, then a patch of
 * the generation row), so it reads at most 4 MiB, like the repo's other
 * bounded walks, to keep reads plus writes well inside one transaction
 * (phase 4 review P3-4). */
export const PROGRESS_BACKFILL_MAX_BYTES_READ = 4 * 1024 * 1024;

/** Argument validators of generations.backfillGenerationProgress. */
export const backfillGenerationProgressArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  pageSize: v.optional(v.number()),
  dryRun: v.optional(v.boolean()),
};

/** Handler of generations.backfillGenerationProgress. */
export async function backfillGenerationProgressHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof backfillGenerationProgressArgs>
) {
  const pageSize = Math.min(
    Math.max(1, Math.floor(args.pageSize ?? PROGRESS_BACKFILL_PAGE_SIZE)),
    PROGRESS_BACKFILL_PAGE_SIZE
  );
  const page = await ctx.db.query("generations").paginate({
    cursor: args.cursor ?? null,
    numItems: pageSize,
    maximumBytesRead: PROGRESS_BACKFILL_MAX_BYTES_READ,
  });
  const now = Date.now();
  let copiedGenerations = 0;
  let copiedLines = 0;
  for (const generation of page.page) {
    if (generation.progressLogCopiedAt !== undefined) continue;
    const lines = generation.progressLog ?? [];
    if (lines.length === 0) continue;
    if (await isProjectDeleting(ctx, generation.projectId)) continue;
    const copied = lines.slice(-PROGRESS_BACKFILL_MAX_LINES);
    if (!args.dryRun) {
      await appendGenerationProgress(
        ctx,
        generation,
        copied,
        generation.requestedAt ?? generation._creationTime
      );
      await ctx.db.patch(generation._id, { progressLogCopiedAt: now });
    }
    copiedGenerations += 1;
    copiedLines += copied.length;
  }
  if (!page.isDone && !args.dryRun) {
    await ctx.scheduler.runAfter(0, internal.generations.backfillGenerationProgress, {
      cursor: page.continueCursor,
      ...(args.pageSize !== undefined ? { pageSize } : {}),
    });
  }
  return {
    scanned: page.page.length,
    copiedGenerations,
    copiedLines,
    isDone: page.isDone,
    continueCursor: page.continueCursor,
  };
}

/** Generations per page of the outputs backfill: rows can carry large agent
 * outputs, so pages stay small and bounded by bytes read as well. */
const OUTPUTS_BACKFILL_PAGE_SIZE = 10;
// Up to twice this is written per page (the artifact copy, then the patch
// that rewrites the generation row), so 4 MiB, not 8 (phase 4 review P3-4).
const OUTPUTS_BACKFILL_MAX_BYTES_READ = 4 * 1024 * 1024;

/** Argument validators of generations.backfillGenerationOutputs. */
export const backfillGenerationOutputsArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  pageSize: v.optional(v.number()),
  dryRun: v.optional(v.boolean()),
};

/**
 * Handler of generations.backfillGenerationOutputs: move each older
 * generation's agent outputs, Brain provenance and retrieval brief into
 * generationArtifacts rows and stamp outputsInArtifactsAt
 * (moveOutputsToArtifacts). The row fields are kept. Rows already stamped and
 * projects in deletion are skipped, so a second run moves nothing.
 */
export async function backfillGenerationOutputsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof backfillGenerationOutputsArgs>
) {
  const pageSize = Math.min(
    Math.max(1, Math.floor(args.pageSize ?? OUTPUTS_BACKFILL_PAGE_SIZE)),
    OUTPUTS_BACKFILL_PAGE_SIZE
  );
  const page = await ctx.db.query("generations").paginate({
    cursor: args.cursor ?? null,
    numItems: pageSize,
    maximumBytesRead: OUTPUTS_BACKFILL_MAX_BYTES_READ,
  });
  const now = Date.now();
  let moved = 0;
  for (const generation of page.page) {
    if (outputsInArtifacts(generation)) continue;
    if (await isProjectDeleting(ctx, generation.projectId)) continue;
    if (!args.dryRun) await moveOutputsToArtifacts(ctx, generation, now);
    moved += 1;
  }
  if (!page.isDone && !args.dryRun) {
    await ctx.scheduler.runAfter(0, internal.generations.backfillGenerationOutputs, {
      cursor: page.continueCursor,
      ...(args.pageSize !== undefined ? { pageSize } : {}),
    });
  }
  return {
    scanned: page.page.length,
    moved,
    isDone: page.isDone,
    continueCursor: page.continueCursor,
  };
}
