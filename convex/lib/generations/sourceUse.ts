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

/** One part of a row's text that was sent: string positions, start inclusive, end exclusive. */
export const sourceUseRangeValidator = v.object({ start: v.number(), end: v.number() });
export type SourceUseRange = Infer<typeof sourceUseRangeValidator>;

export const sourceUseEntryValidator = v.object({
  sourceId: v.id("generationSources"),
  /** The source's content fingerprint, when the caller has it. */
  contentHash: v.optional(v.string()),
  /** How much of the source was sent, and its size, in `unit`. */
  sent: v.number(),
  total: v.number(),
  unit: v.union(v.literal("chars"), v.literal("bytes")),
  /**
   * Phase D, step 1: for a row read in part, the parts of its frozen text
   * that were sent, when the step knows them in the text's own positions.
   */
  ranges: v.optional(v.array(sourceUseRangeValidator)),
});
export type SourceUseEntry = Infer<typeof sourceUseEntryValidator>;

/** At most this many rows one call records: a draft freezes at most 123. */
export const MAX_SOURCE_USE_ENTRIES = 200;

/**
 * At most this many parts one record keeps. A step's whole request holds
 * far fewer (a part is about 2,400 characters of at most 600,000), so a
 * record past it keeps none rather than a list that hides the rest.
 */
export const MAX_SOURCE_USE_RANGES = 256;

/**
 * The parts a record keeps: whole numbers, each non-empty, in order and not
 * overlapping, at most MAX_SOURCE_USE_RANGES. Anything else keeps none, so
 * a record never shows parts that were not sent.
 */
export function recordedRanges(ranges: readonly SourceUseRange[] | undefined): SourceUseRange[] | undefined {
  if (!ranges || ranges.length === 0 || ranges.length > MAX_SOURCE_USE_RANGES) return undefined;
  let end = 0;
  for (const range of ranges) {
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) return undefined;
    if (range.start < end || range.end <= range.start) return undefined;
    end = range.end;
  }
  return ranges.map((range) => ({ start: range.start, end: range.end }));
}

/** At most this many records in part one run keeps of one row, each with other parts. */
export const MAX_PART_RECORDS_PER_RUN = 4;

/** The same parts, as one key, so a run that sends the same parts again adds no record. */
function rangesKey(ranges: readonly SourceUseRange[] | undefined): string {
  return ranges ? ranges.map((range) => `${range.start}-${range.end}`).join(",") : "";
}

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
 * band's read). Phase D, step 1: a row read in part keeps the parts that
 * were sent, and a run that sends other parts of a row it read in part (its
 * inputs moved, say a changed budget) adds a record, up to
 * MAX_PART_RECORDS_PER_RUN a row (review: so one run's records of a draft's
 * at most 123 rows, 6 a row, stay within this read; a test holds the bound).
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
    ranges?: SourceUseRange[];
  }>
): Promise<void> {
  const earlier = await ctx.db
    .query("generationSourceUse")
    .withIndex("by_generationId_and_step_and_run", (q) =>
      q.eq("generationId", generation._id).eq("step", step).eq("run", run)
    )
    .take(MAX_SOURCE_USE_ENTRIES * 4);
  const best = new Map<Id<"generationSources">, number>();
  // The parts of each row this run's records already read in part.
  const partsSeen = new Map<Id<"generationSources">, Set<string>>();
  const seePart = (sourceId: Id<"generationSources">, ranges: readonly SourceUseRange[] | undefined) => {
    const seen = partsSeen.get(sourceId) ?? new Set<string>();
    seen.add(rangesKey(ranges));
    partsSeen.set(sourceId, seen);
  };
  for (const row of earlier) {
    best.set(row.sourceId, Math.max(best.get(row.sourceId) ?? -1, STATE_RANK[row.state]));
    if (row.state === "part") seePart(row.sourceId, row.ranges);
  }
  const at = Date.now();
  for (const use of uses.slice(0, MAX_SOURCE_USE_ENTRIES)) {
    if (use.total <= 0) continue;
    const state = sourceUseState(use.sent, use.total);
    const ranges = state === "part" ? recordedRanges(use.ranges) : undefined;
    const before = best.get(use.sourceId) ?? -1;
    if (before > STATE_RANK[state]) continue;
    if (before === STATE_RANK[state]) {
      // Only a read in part with parts not recorded yet adds a record; one
      // with no parts known adds nothing after another read in part.
      const seen = partsSeen.get(use.sourceId);
      if (state !== "part" || !ranges || seen?.has(rangesKey(ranges))) continue;
      if ((seen?.size ?? 0) >= MAX_PART_RECORDS_PER_RUN) continue;
    }
    best.set(use.sourceId, STATE_RANK[state]);
    if (state === "part") seePart(use.sourceId, ranges);
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
      ...(ranges ? { ranges } : {}),
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
    // Same text, so the parts keep their places.
    return sourceId
      ? [{ sourceId, contentHash: use.contentHash, sent: use.sent, total: use.total, unit: use.unit, ...(use.ranges ? { ranges: use.ranges } : {}) }]
      : [];
  });
  await insertSourceUses(ctx, generation, "brief", "reused", copies);
  return null;
}

/** At most this many records a Summary recovery reads per step: the Inputs band's own read. */
export const RECOVERY_SOURCE_USE_ROWS_PER_STEP = 2500;
/** At most this many records one Summary recovery writes, within a mutation's write limit. */
export const RECOVERY_SOURCE_USE_COPIES = 4000;
/**
 * About the size of one source-use record read, with its index entries. A
 * record with parts is larger (about 32 bytes a part), but one run's parts
 * are few, its budget over a part's size (about 250 at most), so a page of
 * records stays within the guard's margin (review, round 2: counting every
 * record at 256 parts would cut whole steps from a recovery near its limit).
 */
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
   * are read and written a page at a time, asking first, so little more
   * than needed is left out, and the copy then says it is incomplete,
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
          // One record more, taken from the guard's margin (at most one a
          // step), shows whether anything is really left (round 7).
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
      // out, so only its "whole" records stay (round 7): "whole" is the
      // highest state, so none is shown weaker than it was. The analyzer
      // and the Brief record no run, so their step is one run (round 8).
      const cutRun = firstLeft.run ?? "";
      if (kept.length > 0 && (kept[kept.length - 1]!.run ?? "") === cutRun) {
        kept = kept.filter((row) => (row.run ?? "") !== cutRun || row.state === "whole");
      }
    }
    const best = new Map<string, Doc<"generationSourceUse">>();
    for (const row of kept) {
      if (!copyOf.has(row.sourceId)) continue;
      const key = `${row.run ?? ""}\u0000${row.sourceId}`;
      const before = best.get(key);
      // At the same depth, the record that read the most, with its parts.
      if (
        !before ||
        STATE_RANK[row.state] > STATE_RANK[before.state] ||
        (row.state === before.state && row.sent > before.sent)
      ) {
        best.set(key, row);
      }
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
    // The copies hold the same text, so the parts keep their places.
    ...(row.ranges ? { ranges: row.ranges } : {}),
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
