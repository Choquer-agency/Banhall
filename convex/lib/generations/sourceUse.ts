/**
 * 2026-10-26 (Phase D, step 2; P0 item 5): what each step of a draft sent of
 * each frozen row, so the Inputs band can name what every step used, not
 * only the analyzer. Rows are written once and never patched: Seed Batches
 * of one draft run at once, and a patched row would make them conflict.
 * Recording is telemetry: a row that cannot be written never fails a step.
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
  if (sent <= 0 && total > 0) return "left_out";
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
 * Handler of generations.recordSourceUse, and the one writer of
 * `generationSourceUse`. A row of another draft, or one that is gone, is
 * skipped.
 */
export async function recordSourceUseHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof recordSourceUseArgs>
): Promise<null> {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  for (const unit of ["chars", "bytes"] as const) {
    const mine = [];
    for (const use of args.uses.slice(0, MAX_SOURCE_USE_ENTRIES)) {
      if (use.unit !== unit) continue;
      const row = await ctx.db.get(use.sourceId);
      if (row && row.generationId === args.generationId) mine.push(use);
    }
    await insertSourceUses(ctx, generation, args.step, args.run, mine, unit);
  }
  return null;
}

/** Inserts one step run's rows for rows the caller knows are this draft's. */
export async function insertSourceUses(
  ctx: MutationCtx,
  generation: { _id: Id<"generations">; projectId: Id<"projects"> },
  step: SourceUseStep,
  run: string | undefined,
  uses: ReadonlyArray<{ sourceId: Id<"generationSources">; sent: number; total: number }>,
  unit: "chars" | "bytes"
): Promise<void> {
  const at = Date.now();
  for (const use of uses.slice(0, MAX_SOURCE_USE_ENTRIES)) {
    await ctx.db.insert("generationSourceUse", {
      generationId: generation._id,
      projectId: generation.projectId,
      step,
      ...(run ? { run } : {}),
      sourceId: use.sourceId,
      state: sourceUseState(use.sent, use.total),
      sent: Math.max(0, Math.round(use.sent)),
      total: Math.max(0, Math.round(use.total)),
      unit,
      at,
    });
  }
}

/** Inserts the analyzer's record beside its `contextBudget` (`recordContextBudget`). */
export async function recordAnalyzerUse(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  projectId: Id<"projects">,
  sourceId: Id<"generationSources">,
  entry: { included: boolean; includedLength: number; truncated: boolean },
  total: number
): Promise<void> {
  // Whole by the analyzer's own word (`truncated`), not by comparing lengths
  // its budget may count after a notice or a trim.
  const sent = !entry.included ? 0 : entry.truncated ? Math.min(entry.includedLength, Math.max(0, total - 1)) : total;
  await ctx.db.insert("generationSourceUse", {
    generationId,
    projectId,
    step: "analyzer",
    sourceId,
    state: sourceUseState(sent, total),
    sent,
    total,
    unit: "chars",
    at: Date.now(),
  });
}
