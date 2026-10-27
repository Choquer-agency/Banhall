/**
 * 2026-10-26 (Phase D, step 2; P0 item 5): what each step of a draft sent of
 * each frozen row, so the Inputs band can name what every step used, not
 * only the analyzer. Rows are written once and never patched: Seed Batches
 * of one draft run at once, and a patched row would make them conflict.
 * Recording is telemetry: a row that cannot be written never fails a step.
 * A step records only what it actually sent, once its request has answered
 * (review): a step that never ran or failed records nothing.
 */
import { v, type Infer, type ObjectType } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

export const sourceUseStepValidator = v.union(
  v.literal("analyzer"),
  v.literal("brief"),
  v.literal("seeds"),
  v.literal("facts_check")
);
export type SourceUseStep = Infer<typeof sourceUseStepValidator>;

export const sourceUseEntryValidator = v.object({
  sourceId: v.id("generationSources"),
  /** The source's content fingerprint, when the caller has it. */
  contentHash: v.optional(v.string()),
  /** How much of the source was sent, and its size, in `unit`. */
  sent: v.number(),
  total: v.number(),
  unit: v.union(v.literal("chars"), v.literal("bytes")),
});
export type SourceUseEntry = Infer<typeof sourceUseEntryValidator>;

/** At most this many rows one call records: a draft freezes at most 123. */
export const MAX_SOURCE_USE_ENTRIES = 200;

/** Whole, in part or left out, from what was sent of how much. */
export function sourceUseState(sent: number, total: number): "whole" | "part" | "left_out" {
  if (sent <= 0) return "left_out";
  return sent >= total ? "whole" : "part";
}

/** Argument validators of generations.recordSourceUse. */
export const recordSourceUseArgs = {
  generationId: v.id("generations"),
  step: sourceUseStepValidator,
  run: v.optional(v.string()),
  uses: v.array(sourceUseEntryValidator),
};

/**
 * Handler of generations.recordSourceUse, and the writer of
 * `generationSourceUse` for the actions. Its callers pass their own draft's
 * frozen rows, so the rows are not read again (review: reading every row's
 * text per Seed Batch). An empty row is nothing read and gets no record.
 */
export async function recordSourceUseHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof recordSourceUseArgs>
): Promise<null> {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  await insertSourceUses(ctx, generation, args.step, args.run, args.uses);
  return null;
}

/** Inserts one step run's rows for rows the caller knows are this draft's. Empty rows are skipped. */
export async function insertSourceUses(
  ctx: MutationCtx,
  generation: { _id: Id<"generations">; projectId: Id<"projects"> },
  step: SourceUseStep,
  run: string | undefined,
  uses: ReadonlyArray<{
    sourceId: Id<"generationSources">;
    contentHash?: string;
    sent: number;
    total: number;
    unit: "chars" | "bytes";
  }>
): Promise<void> {
  const at = Date.now();
  for (const use of uses.slice(0, MAX_SOURCE_USE_ENTRIES)) {
    if (use.total <= 0) continue;
    await ctx.db.insert("generationSourceUse", {
      generationId: generation._id,
      projectId: generation.projectId,
      step,
      ...(run ? { run } : {}),
      sourceId: use.sourceId,
      ...(use.contentHash ? { contentHash: use.contentHash } : {}),
      state: sourceUseState(use.sent, use.total),
      sent: Math.max(0, Math.round(use.sent)),
      total: Math.max(0, Math.round(use.total)),
      unit: use.unit,
      at,
    });
  }
}

/** Argument validators of generations.copyBriefSourceUse. */
export const copyBriefSourceUseArgs = {
  generationId: v.id("generations"),
  briefId: v.id("generationBriefs"),
  /** This draft's rows the reused Brief may have read, with their fingerprints. */
  sources: v.array(v.object({ sourceId: v.id("generationSources"), contentHash: v.string() })),
};

/**
 * A reused Brief's record (review): what the run that derived it recorded,
 * copied onto this draft's rows with the same text, never recomputed from
 * this draft's rows (their order or digests may differ). A Brief whose run
 * recorded nothing gets nothing.
 */
export async function copyBriefSourceUseHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof copyBriefSourceUseArgs>
): Promise<null> {
  const generation = await ctx.db.get(args.generationId);
  const brief = await ctx.db.get(args.briefId);
  if (!generation || !brief || brief.generationId === args.generationId) return null;
  const byHash = new Map(args.sources.map((source) => [source.contentHash, source.sourceId] as const));
  const original = await ctx.db
    .query("generationSourceUse")
    .withIndex("by_generationId_and_step", (q) => q.eq("generationId", brief.generationId).eq("step", "brief"))
    .take(MAX_SOURCE_USE_ENTRIES);
  const copies = original.flatMap((use) => {
    const sourceId = use.contentHash ? byHash.get(use.contentHash) : undefined;
    return sourceId ? [{ sourceId, contentHash: use.contentHash, sent: use.sent, total: use.total, unit: use.unit }] : [];
  });
  await insertSourceUses(ctx, generation, "brief", "reused", copies);
  return null;
}

/** At most this many rows a Summary recovery copies per step. */
export const RECOVERY_SOURCE_USE_ROWS_PER_STEP = 2500;

/**
 * Summary recovery (review): the recovery drafts from the failed draft's
 * analysis, Brief and Seeds, so it copies what those steps recorded onto its
 * own copies of the rows. The facts check is not copied: the recovery runs
 * its own. A row with no copy keeps no record.
 */
export async function copyRecoverySourceUses(
  ctx: MutationCtx,
  fromGenerationId: Id<"generations">,
  to: { _id: Id<"generations">; projectId: Id<"projects"> },
  copyOf: ReadonlyMap<Id<"generationSources">, Id<"generationSources">>
): Promise<void> {
  for (const step of ["analyzer", "brief", "seeds"] as const) {
    const rows = await ctx.db
      .query("generationSourceUse")
      .withIndex("by_generationId_and_step", (q) => q.eq("generationId", fromGenerationId).eq("step", step))
      .take(RECOVERY_SOURCE_USE_ROWS_PER_STEP);
    for (const row of rows) {
      const sourceId = copyOf.get(row.sourceId);
      if (!sourceId) continue;
      await ctx.db.insert("generationSourceUse", {
        generationId: to._id,
        projectId: to.projectId,
        step: row.step,
        ...(row.run ? { run: row.run } : {}),
        sourceId,
        ...(row.contentHash ? { contentHash: row.contentHash } : {}),
        state: row.state,
        sent: row.sent,
        total: row.total,
        unit: row.unit,
        at: row.at,
      });
    }
  }
}
