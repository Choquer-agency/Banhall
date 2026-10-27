/**
 * 2026-10-26 (Phase D, step 2; P0 item 5): what each step of a draft sent of
 * each frozen row, so the Inputs band can name what every step used, not
 * only the analyzer. Rows are written once and never patched: Seed Batches
 * of one draft run at once, and a patched row would make them conflict.
 * Recording is telemetry: a row that cannot be written never fails a step.
 * A step records only what it actually sent, once its request has answered
 * (review): a step that never ran or failed records nothing.
 */
import { getDocumentSize, v, type Infer, type ObjectType, type Value } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

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

const STATE_RANK = { left_out: 0, part: 1, whole: 2 } as const;

/**
 * Inserts one step run's rows for rows the caller knows are this draft's.
 * Empty rows are skipped, and so is a row that reads no more of its source
 * than this run's earlier record of it (re-check: a retried or repeated
 * Batch of one step adds no rows, so a step's records stay within the
 * band's read).
 */
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
  const earlier = await ctx.db
    .query("generationSourceUse")
    .withIndex("by_generationId_and_step_and_run", (q) =>
      q.eq("generationId", generation._id).eq("step", step).eq("run", run)
    )
    .take(MAX_SOURCE_USE_ENTRIES * 4);
  const best = new Map<Id<"generationSources">, number>();
  for (const row of earlier) best.set(row.sourceId, Math.max(best.get(row.sourceId) ?? -1, STATE_RANK[row.state]));
  const at = Date.now();
  for (const use of uses.slice(0, MAX_SOURCE_USE_ENTRIES)) {
    if (use.total <= 0) continue;
    const state = sourceUseState(use.sent, use.total);
    if ((best.get(use.sourceId) ?? -1) >= STATE_RANK[state]) continue;
    best.set(use.sourceId, STATE_RANK[state]);
    await ctx.db.insert("generationSourceUse", {
      generationId: generation._id,
      projectId: generation.projectId,
      step,
      ...(run ? { run } : {}),
      sourceId: use.sourceId,
      ...(use.contentHash ? { contentHash: use.contentHash } : {}),
      state,
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
    .withIndex("by_generationId_and_step_and_run", (q) => q.eq("generationId", brief.generationId).eq("step", "brief"))
    .take(MAX_SOURCE_USE_ENTRIES);
  const copies = original.flatMap((use) => {
    const sourceId = use.contentHash ? byHash.get(use.contentHash) : undefined;
    return sourceId ? [{ sourceId, contentHash: use.contentHash, sent: use.sent, total: use.total, unit: use.unit }] : [];
  });
  await insertSourceUses(ctx, generation, "brief", "reused", copies);
  return null;
}

/** At most this many records a Summary recovery reads per step: the Inputs band's own read. */
export const RECOVERY_SOURCE_USE_ROWS_PER_STEP = 2500;
/** At most this many records one Summary recovery writes, within a mutation's write limit. */
export const RECOVERY_SOURCE_USE_COPIES = 4000;
/** At least the size of one source-use record read, with its index entries. */
const SOURCE_USE_ROW_BYTES = 1024;
/** Records read, or written, between two checks of the room left. */
const SOURCE_USE_PAGE = 100;
/** A written record's index entries, on top of its own size. */
const SOURCE_USE_INDEX_BYTES = 256;

/**
 * Summary recovery (review): the recovery drafts from the failed draft's
 * analysis, Brief and Seeds, so it copies what those steps recorded onto its
 * own copies of the rows: one record per step, run and row, its best read
 * (re-check: the band shows nothing more). The facts check is not copied:
 * the recovery runs its own. A row with no copy keeps no record. Returns
 * whether some records could not be read or copied, so the band can say so.
 */
export async function copyRecoverySourceUses(
  ctx: MutationCtx,
  fromGenerationId: Id<"generations">,
  to: { _id: Id<"generations">; projectId: Id<"projects"> },
  copyOf: ReadonlyMap<Id<"generationSources">, Id<"generationSources">>,
  /**
   * The recovery's transaction guard (B1 review, rounds 5 to 7): records
   * are read and written a page at a time, asking first, so at most a page
   * more than needed is left out, and the copy then says it is incomplete,
   * instead of failing the recovery; it says so only when a record was
   * really left out. `read` counts each record read, for runtimes that
   * cannot report their usage.
   */
  limits?: {
    hasRoom(kind: "read" | "write", bytes: number, writtenBytes?: number): Promise<boolean>;
    read(doc: object): void;
  }
): Promise<{ truncated: boolean }> {
  let truncated = false;
  const copies: Doc<"generationSourceUse">[] = [];
  for (const step of ["analyzer", "brief", "seeds"] as const) {
    const rows: Doc<"generationSourceUse">[] = [];
    // The first record not kept, when the step was cut.
    let firstLeft: Doc<"generationSourceUse"> | undefined;
    const iterator = ctx.db
      .query("generationSourceUse")
      .withIndex("by_generationId_and_step_and_run", (q) => q.eq("generationId", fromGenerationId).eq("step", step))
      [Symbol.asyncIterator]();
    try {
      pages: for (;;) {
        if (limits && !(await limits.hasRoom("read", (SOURCE_USE_PAGE + 1) * SOURCE_USE_ROW_BYTES))) {
          // One record more fits in the page's own allowance: it shows
          // whether anything is really left (round 7).
          const next = await iterator.next();
          if (!next.done) {
            limits.read(next.value);
            firstLeft = next.value;
          }
          break;
        }
        for (let index = 0; index < SOURCE_USE_PAGE; index += 1) {
          const next = await iterator.next();
          if (next.done) break pages;
          limits?.read(next.value);
          if (rows.length === RECOVERY_SOURCE_USE_ROWS_PER_STEP) {
            firstLeft = next.value;
            break pages;
          }
          rows.push(next.value);
        }
      }
    } finally {
      await iterator.return?.();
    }
    let kept = rows;
    if (firstLeft) {
      truncated = true;
      // The run cut part way may have its best record among those left
      // out; its records are left out too rather than shown weaker (round 7).
      const cutRun = firstLeft.run ?? "";
      if (kept.length > 0 && (kept[kept.length - 1]!.run ?? "") === cutRun) {
        kept = kept.filter((row) => (row.run ?? "") !== cutRun);
      }
    }
    const best = new Map<string, Doc<"generationSourceUse">>();
    for (const row of kept) {
      if (!copyOf.has(row.sourceId)) continue;
      const key = `${row.run ?? ""}\u0000${row.sourceId}`;
      const before = best.get(key);
      if (!before || STATE_RANK[row.state] > STATE_RANK[before.state]) best.set(key, row);
    }
    copies.push(...best.values());
  }
  if (copies.length > RECOVERY_SOURCE_USE_COPIES) truncated = true;
  const kept = copies.slice(0, RECOVERY_SOURCE_USE_COPIES).map((row) => ({
    generationId: to._id,
    projectId: to.projectId,
    step: row.step,
    ...(row.run ? { run: row.run } : {}),
    sourceId: copyOf.get(row.sourceId)!,
    ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    state: row.state,
    sent: row.sent,
    total: row.total,
    unit: row.unit,
    at: row.at,
  }));
  let written = 0;
  for (let start = 0; start < kept.length; start += SOURCE_USE_PAGE) {
    const page = kept.slice(start, start + SOURCE_USE_PAGE);
    const bytes = page.reduce(
      (total, row) => total + getDocumentSize(row as unknown as Record<string, Value>) + SOURCE_USE_INDEX_BYTES,
      0
    );
    if (limits && !(await limits.hasRoom("write", bytes, written))) {
      truncated = true;
      break;
    }
    for (const row of page) await ctx.db.insert("generationSourceUse", row);
    written += bytes;
  }
  return { truncated };
}
