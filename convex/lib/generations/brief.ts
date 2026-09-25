/**
 * The Generation Brief (story 1, CAP-1/2/4): bounded reads, reuse, the diff
 * baseline, publication and rendering.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { domainError } from "../contracts";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { v, type Infer, type ObjectType } from "convex/values";
import { requireSeedInitialization } from "./seedGuards";
import {
  briefOutcomeValidator,
  describeBriefOutcome,
  renderBriefBlock,
} from "../briefRender";
import { appendGenerationProgress } from "../generationProgress";
import { isProjectDeleting } from "../projectDeletion";
import { validateCitation } from "../citations";
import { citationSpeakerReader, type CitationSpeaker } from "../citationSpeakers";
import { resolveFrozenSourceId } from "../seedRevisions";

// ─── Story 1 (CAP-1/2/4): Generation Brief internal helpers ────────────────
// The stage itself (`convex/ai/brief.ts:deriveOrReuseBrief`) is a plain
// "use node" helper called directly from `pipeline.ts`/`iterative.ts` (same
// pattern as `runAnalyzerAgent`) — not a registered Convex function, so it
// never needs an `internal.ai.brief.*` reference. These are its only reads
// and writes; they live here (an already-registered, non-node module) so a
// stale `_generated/api.d.ts` never has to learn a brand-new file to
// typecheck. `deriveOrReuseBrief` and `briefs.saveEntryEdit` are the only two
// writers of `generationBriefs`/`generationBriefEntries` (AD-23).

/**
 * Frozen `generationSources` rows one Brief derivation may read. The
 * structural maximum is 112 (`3 * MAX_TRANSCRIPTS_PER_PROJECT + 52`, see
 * `convex/writerProfiles.ts:585-587`), so this is slack rather than a real
 * ceiling — it exists only so the read is bounded and provably complete.
 */
export const MAX_BRIEF_SOURCE_ROWS = 200;

/**
 * Entries per Brief version a generation consumer may read in one
 * transaction — the same bound `convex/briefs.ts` applies to the
 * writer-facing copy path, so no Brief that path can write is unreadable
 * here. Also the most rows one diff-baseline page may return
 * (`getBriefDiffBaselinePage`); the baseline itself has no ceiling.
 */
export const MAX_BRIEF_ENTRY_ROWS = 500;

/**
 * Bytes one diff-baseline page may read (`maximumBytesRead`), well inside
 * Convex's 16 MiB per-transaction read limit. A page that reaches it reports
 * `SplitRequired` and is re-read smaller by
 * `ai/brief.ts:readCompleteBriefDiffBaseline`.
 */
export const BRIEF_BASELINE_PAGE_BYTES = 4 * 1024 * 1024;

/**
 * Bytes a generation consumer's Brief read may take (`maximumBytesRead` in
 * `readBriefEntryRowsOrOmit`). DW-152: the row bound alone does not bound
 * bytes, because writer edits (`briefs.saveEntryEdit`) accept any non-empty
 * text, so `MAX_BRIEF_ENTRY_ROWS` rows can exceed Convex's 16 MiB
 * per-transaction read limit and throw.
 *
 * 4 MiB (the same size as a diff-baseline page) leaves real headroom in the
 * heaviest caller, `claimOrderedSectionRun`, where the read shares one
 * transaction with the claimed section row, the fence's candidate run,
 * generation and project, the claim's `ctx.db.patch` of the section row
 * (a patch reads the row it merges into, so it is counted as a read; convex-test
 * charges it the same way), the DW-119 `lastProgressAt` patch of the
 * generation (another merge read), the candidate's three section rows (prior
 * drafts) and the Brief parent: 10 other document reads of at most 1 MiB each.
 * Convex checks the byte budget after a row is read, so the Brief read can
 * overshoot by at most one row (1 MiB): 10 + 4 + 1 = 15 MiB worst case, under
 * 16 MiB. `getOrderedCandidateDrafts` (6 other documents, 6 + 4 + 1 = 11 MiB)
 * and `renderBriefForGeneration` (2) have more headroom. A realistic Brief (short
 * derived entries and excerpts) is a small fraction of this; one that exceeds
 * it is omitted whole, like an over-bound one.
 */
export const BRIEF_CONSUMER_READ_BYTES = 4 * 1024 * 1024;

/**
 * Every frozen source a Brief derivation reads, or a refusal. Reads one past
 * the bound rather than returning a silent prefix: a derivation treats what
 * it reads as the complete evidence set, so a prefix would quietly become
 * authoritative (the same rule `convex/briefs.ts:briefEntriesToCopy` applies
 * on the writer side).
 *
 * Write path only, so refusing is safe: its one caller
 * (`ai/brief.ts:deriveOrReuseBrief`) runs under the fail-open stage runner
 * `ai/brief.ts:runGenerationBriefStage`, which means "record a failed outcome
 * and continue with no Brief". The structural maximum is far below the bound
 * (see above), so unlike the diff baseline this read needs no paging.
 */
export async function readBriefSourceRows(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
) {
  const rows = await ctx.db
    .query("generationSources")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(MAX_BRIEF_SOURCE_ROWS + 1);
  if (rows.length > MAX_BRIEF_SOURCE_ROWS) {
    return domainError(
      "INVALID_STATE",
      `This generation has more than ${MAX_BRIEF_SOURCE_ROWS} frozen sources and cannot be read completely for a Generation Brief`
    );
  }
  return rows;
}

/**
 * A generation consumer's read of a Brief's entry rows: every row, or `null`
 * — "omit the whole Brief, exactly as if this generation had no briefId" —
 * plus one `console.error` so the omission is diagnosable. The single
 * bounded probe (`bound + 1` rows, `BRIEF_CONSUMER_READ_BYTES` bytes);
 * nothing else reads a Brief's rows for a prompt.
 *
 * An over-bound Brief is reachable in production, not only from seeded data:
 * `ai/brief.ts:289-305` reuses a Brief by parent row alone (it never reads
 * children), and `persistDerivedBrief` publishes a derivation's validated
 * entries plus removal markers in full, however many that is. The diff
 * baseline does not use this read: it enumerates every row in pages
 * (`getBriefDiffBaselinePage`), so an over-bound newest Brief never blocks a
 * later derivation.
 *
 * Scope: this handles row-count and byte overflow (DW-152) — it never returns
 * a prefix and never raises for an over-bound or byte-heavy Brief. The read
 * is one `.paginate()` with `maximumBytesRead`, so a byte-heavy Brief stops
 * at the budget instead of reaching the transaction read limit. The Brief is
 * complete only when that single page holds at most `MAX_BRIEF_ENTRY_ROWS`
 * rows, reports `isDone` and is not `SplitRequired`; anything else (including
 * a short page Convex ends early) is omitted whole. Callers must not run
 * another `.paginate()` in the same function (Convex allows one). It is not
 * general exception safety; a database read failure or a transaction limit
 * reached by the caller's own other reads still propagates.
 *
 * Overflow must not raise because `claimOrderedSectionRun` is awaited at
 * `ai/orderedGeneration.ts:173-178` and `getOrderedCandidateDrafts` at
 * `:373-376`, both *outside* that action's own `try` (`:200`, `:410`), so a
 * throw here would roll the CAS claim back and strand the section `queued`
 * until stale-generation recovery — `failOrderedSectionRun:345` never sees
 * it. `iterative.ts:406-410` and `pipeline.ts:957-961` would fail the
 * section/candidate outright. Brief guidance is optional by contract, so its
 * unreadability must not fail or stall a generation.
 */
export type CompleteBriefEntryRead = {
  kind: "complete";
  rows: Doc<"generationBriefEntries">[];
};

export type IncompleteBriefEntryRead =
  | { kind: "row_limit" }
  | { kind: "byte_limit" };

export type BriefEntryReadScope = "all" | "immutable_input";

/**
 * The one bounded complete-read criterion shared by legacy generation
 * consumers, Summary sign-off admission and every signed Summary consumer.
 */
export async function readBriefEntryRowsBounded(
  ctx: { db: QueryCtx["db"] },
  briefId: Id<"generationBriefs">,
  scope: BriefEntryReadScope = "all"
): Promise<CompleteBriefEntryRead | IncompleteBriefEntryRead> {
  const pagination = {
    cursor: null,
    numItems: MAX_BRIEF_ENTRY_ROWS + 1,
    maximumBytesRead: BRIEF_CONSUMER_READ_BYTES,
  } as const;
  const result = scope === "immutable_input"
    ? await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId_and_generatedOutput", (q) =>
          q.eq("briefId", briefId).eq("generatedOutput", undefined))
        .paginate(pagination)
    : await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
        .paginate(pagination);
  const rows = result.page;
  if (rows.length > MAX_BRIEF_ENTRY_ROWS) {
    return { kind: "row_limit" };
  }
  if (!result.isDone || result.pageStatus === "SplitRequired") {
    return { kind: "byte_limit" };
  }
  return { kind: "complete", rows };
}

/**
 * Generated questions belong to a Summary-authored Brief's visible/editable
 * history, not to its reusable prompt guidance. The author generation is the
 * persisted workflow discriminator: legacy-authored Briefs retain their
 * historical combined read, while Summary consumers and legacy consumers of
 * a Summary-authored edit read the complete immutable-input partition.
 */
export async function briefEntryReadScope(
  ctx: { db: QueryCtx["db"] },
  consumer: Doc<"generations">,
  brief: Doc<"generationBriefs">
): Promise<BriefEntryReadScope> {
  if (resolveGatedWorkflow(consumer) === "seeds") return "immutable_input";
  const author = await ctx.db.get(brief.generationId);
  return author && resolveGatedWorkflow(author) === "seeds"
    ? "immutable_input"
    : "all";
}

export async function readBriefEntryRowsOrOmit(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  brief: Doc<"generationBriefs">
) {
  const result = await readBriefEntryRowsBounded(
    ctx,
    brief._id,
    await briefEntryReadScope(ctx, generation, brief)
  );
  if (result.kind === "row_limit") {
    console.error(
      `Generation Brief omitted from generation ${generation._id}: Brief ${brief._id} has more than ${MAX_BRIEF_ENTRY_ROWS} entries and cannot be read completely`
    );
    return null;
  }
  if (result.kind === "byte_limit") {
    console.error(
      `Generation Brief omitted from generation ${generation._id}: Brief ${brief._id} cannot be read completely within ${BRIEF_CONSUMER_READ_BYTES} bytes`
    );
    return null;
  }
  return result.rows;
}

/** Argument validators of generations.getGenerationSourcesForBrief. */
export const getGenerationSourcesForBriefArgs = { generationId: v.id("generations") };

/** Handler of generations.getGenerationSourcesForBrief. */
export async function getGenerationSourcesForBriefHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getGenerationSourcesForBriefArgs>
) {
  return await readBriefSourceRows(ctx, args.generationId);
}

/**
 * Spans one `getCitationSpeakers` call may ask about. Each span reads at
 * most MAX_SPAN_TURNS + 1 turns, twice when it names the place a quote
 * moves from, so 250 spans stay inside one query's read limits (review
 * 2026-09-25, P3-5).
 */
export const MAX_CITATION_SPEAKER_SPANS = 250;

export const citationSpeakerValidator = v.union(
  v.literal("client"),
  v.literal("needs_check"),
  v.literal("excluded"),
  v.literal("unchecked")
);

export const getCitationSpeakersArgs = {
  generationId: v.id("generations"),
  spans: v.array(
    v.object({
      sourceId: v.id("generationSources"),
      startOffset: v.number(),
      endOffset: v.number(),
      // A quote's first place on the same row: this span is a new place for
      // it and counts only near that one (review 2026-09-25, P2-3).
      movedFrom: v.optional(v.object({ startOffset: v.number(), endOffset: v.number() })),
    })
  ),
};

/**
 * Handler of generations.getCitationSpeakers: owner decision 25 for spans of
 * this generation's frozen rows, in order (convex/lib/citationSpeakers.ts).
 * A row of another generation, or one that is not a transcript, answers
 * `unchecked`.
 */
export async function getCitationSpeakersHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getCitationSpeakersArgs>
): Promise<CitationSpeaker[]> {
  if (args.spans.length > MAX_CITATION_SPEAKER_SPANS) {
    return domainError(
      "INVALID_INPUT",
      `At most ${MAX_CITATION_SPEAKER_SPANS} citation spans can be checked at once`
    );
  }
  const speakerOf = citationSpeakerReader(ctx);
  const sources = new Map<Id<"generationSources">, Doc<"generationSources"> | null>();
  const verdicts: CitationSpeaker[] = [];
  for (const span of args.spans) {
    let source = sources.get(span.sourceId);
    if (source === undefined) {
      source = await ctx.db.get(span.sourceId);
      sources.set(span.sourceId, source);
    }
    verdicts.push(
      source && source.generationId === args.generationId
        ? await speakerOf(source, span.startOffset, span.endOffset, span.movedFrom)
        : "unchecked"
    );
  }
  return verdicts;
}

/** Latest stored Brief for one reusable input key, regardless of origin. */
export async function latestBriefForInputs(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
  inputsHash: string
) {
  return await ctx.db
    .query("generationBriefs")
    .withIndex("by_projectId_and_inputsHash", (q) =>
      q.eq("projectId", projectId).eq("inputsHash", inputsHash)
    )
    .order("desc")
    .first();
}

export async function reusableBriefForGeneration(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  inputsHash: string
) {
  const brief = await latestBriefForInputs(ctx, generation.projectId, inputsHash);
  if (!brief) return null;
  const scope = await briefEntryReadScope(ctx, generation, brief);
  // Preserve the historical legacy path: legacy-authored Briefs are reused by
  // parent row and an over-bound combined read remains optional/fail-open.
  if (scope === "all") return brief;
  const read = await readBriefEntryRowsBounded(ctx, brief._id, scope);
  return read.kind === "complete" ? brief : null;
}

/** Argument validators of generations.findReusableBrief. */
export const findReusableBriefArgs = { generationId: v.id("generations"), inputsHash: v.string() };

/** Handler of generations.findReusableBrief. */
export async function findReusableBriefHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof findReusableBriefArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  return await reusableBriefForGeneration(ctx, generation, args.inputsHash);
}

/** Argument validators of generations.stampGenerationBriefId. */
export const stampGenerationBriefIdArgs = { generationId: v.id("generations"), briefId: v.id("generationBriefs") };

/**
 * Handler of generations.stampGenerationBriefId. Outside Step-by-step the
 * reused Brief is checked under owner decision 25 first
 * (`briefWithoutExcludedQuotes`), so the id stamped and returned may be a
 * new version of it.
 */
export async function stampGenerationBriefIdHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof stampGenerationBriefIdArgs>
): Promise<Id<"generationBriefs"> | null> {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  if (resolveGatedWorkflow(generation) === "seeds") {
    await requireSeedInitialization(ctx, generation._id);
    if (generation.briefId) return generation.briefId;
    if (generation.seedBriefPin !== args.briefId) domainError("INVALID_STATE", "Brief was not pinned at startup");
    await ctx.db.patch(args.generationId, { briefId: args.briefId });
    return args.briefId;
  }
  const brief = await ctx.db.get(args.briefId);
  const briefId = brief ? (await briefWithoutExcludedQuotes(ctx, brief))._id : args.briefId;
  await ctx.db.patch(args.generationId, { briefId });
  return briefId;
}

/**
 * A stored Brief about to be reused, under owner decision 25 (review
 * 2026-09-25, P2-4): Briefs derived before the check, or before a speaker's
 * role changed, can hold entries backed only by the interviewer's or
 * another speaker's words. Those entries are dropped into a new version of
 * the Brief (the next version number, everything else copied as it is) and
 * counted on it in `droppedEntryCount`, as a fresh derivation counts them.
 * No model call and no re-derivation; a Brief with nothing to drop is
 * returned as it is. Removed-entry markers and generated questions are
 * copied unchecked. A Brief too large to read whole is returned unchecked.
 */
export async function briefWithoutExcludedQuotes(
  ctx: MutationCtx,
  brief: Doc<"generationBriefs">
): Promise<Doc<"generationBriefs">> {
  const rows = await ctx.db
    .query("generationBriefEntries")
    .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
    .take(2 * MAX_BRIEF_ENTRY_ROWS + 1);
  if (rows.length > 2 * MAX_BRIEF_ENTRY_ROWS) return brief;
  const speakerOf = citationSpeakerReader(ctx);
  const sources = new Map<Id<"generationSources">, Doc<"generationSources"> | null>();
  const excluded = new Set<Id<"generationBriefEntries">>();
  for (const row of rows) {
    if (row.change === "removed" || row.generatedOutput) continue;
    let source = sources.get(row.sourceId);
    if (source === undefined) {
      source = await ctx.db.get(row.sourceId);
      sources.set(row.sourceId, source);
    }
    if (source && (await speakerOf(source, row.startOffset, row.endOffset)) === "excluded") {
      excluded.add(row._id);
    }
  }
  if (excluded.size === 0) return brief;
  const now = Date.now();
  const { _id, _creationTime, ...fields } = brief;
  const briefId = await ctx.db.insert("generationBriefs", {
    ...fields,
    version: brief.version + 1,
    droppedEntryCount: (brief.droppedEntryCount ?? 0) + excluded.size,
    createdAt: now,
  });
  for (const row of rows) {
    if (excluded.has(row._id)) continue;
    const { _id: _rowId, _creationTime: _rowCreationTime, ...rowFields } = row;
    await ctx.db.insert("generationBriefEntries", { ...rowFields, briefId, createdAt: now });
  }
  return (await ctx.db.get(briefId))!;
}

/** Argument validators of generations.recordBriefOutcome. */
export const recordBriefOutcomeArgs = { generationId: v.id("generations"), outcome: briefOutcomeValidator };

/** Handler of generations.recordBriefOutcome. */
export async function recordBriefOutcomeHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof recordBriefOutcomeArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  await appendGenerationProgress(ctx, generation, [
    describeBriefOutcome(args.outcome),
  ]);
  await ctx.db.patch(args.generationId, {
    briefOutcome: args.outcome,
  });
  return null;
}

export const briefEntryGroupValidator = v.union(
  v.literal("storyline"),
  v.literal("claimExclusion"),
  v.literal("confidenceMap"),
  v.literal("glossaryTerm")
);

export const briefEntryReasonValidator = v.union(
  v.literal("business_risk"),
  v.literal("routine_engineering"),
  v.literal("outside_claim_period"),
  v.literal("not_technological")
);

export const briefEntryConfidenceValidator = v.union(
  v.literal("established"),
  v.literal("partial"),
  v.literal("unresolved"),
  v.literal("unreliable")
);

export const briefCandidateEntryValidator = v.object({
  group: briefEntryGroupValidator,
  text: v.string(),
  reason: v.optional(briefEntryReasonValidator),
  confidence: v.optional(briefEntryConfidenceValidator),
  sourceId: v.id("generationSources"),
  sourceContentHash: v.string(),
  startOffset: v.number(),
  endOffset: v.number(),
  exactExcerpt: v.string(),
});

export type BriefCandidateEntry = Infer<typeof briefCandidateEntryValidator>;

/**
 * The one diff key between a Brief version and the next derivation:
 * `(group, sourceContentHash, startOffset, endOffset)`. Shared by
 * `ai/brief.ts:readCompleteBriefDiffBaseline`, which partitions the baseline
 * against the candidates, and `persistDerivedBrief`, which stamps against that
 * partition, so the two can never disagree about which rows match.
 */
export function briefDiffKey(entry: {
  group: string;
  sourceContentHash: string;
  startOffset: number;
  endOffset: number;
}) {
  return `${entry.group}|${entry.sourceContentHash}|${entry.startOffset}|${entry.endOffset}`;
}

/**
 * A stored row as diff-baseline evidence: exactly the fields a removal marker
 * copies, or `null` for a row that is not live derived evidence. A
 * `change: "removed"` row is a version's own history — diffing against it
 * would re-insert the same marker on every later version, forever. A
 * `storylineQuestion` row is a Self-check artifact owned by
 * `briefs.saveEntryEdit`, not derived evidence: carrying it forward would
 * re-emit it as a bogus "removed" marker (DW-118).
 */
export function liveBaselinePayload(
  row: Doc<"generationBriefEntries">
): BriefCandidateEntry | null {
  if (row.change === "removed" || row.group === "storylineQuestion") return null;
  return {
    group: row.group,
    text: row.text,
    ...(row.reason !== undefined ? { reason: row.reason } : {}),
    ...(row.confidence !== undefined ? { confidence: row.confidence } : {}),
    sourceId: row.sourceId,
    sourceContentHash: row.sourceContentHash,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    exactExcerpt: row.exactExcerpt,
  };
}

/** The project's newest Brief, whatever its inputsHash or origin: the one
 * version a new derivation diffs against and fences on. A single-row select,
 * so it cannot return a prefix. */
export async function newestProjectBrief(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">
) {
  return await ctx.db
    .query("generationBriefs")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first();
}

/** Argument validators of generations.getBriefDiffBaselineId. */
export const getBriefDiffBaselineIdArgs = { projectId: v.id("projects") };

/** Handler of generations.getBriefDiffBaselineId. */
export async function getBriefDiffBaselineIdHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getBriefDiffBaselineIdArgs>
) {
  return (await newestProjectBrief(ctx, args.projectId))?._id ?? null;
}

/** Argument validators of generations.getBriefDiffBaselinePage. */
export const getBriefDiffBaselinePageArgs = {
  briefId: v.id("generationBriefs"),
  cursor: v.union(v.string(), v.null()),
  numItems: v.number(),
};

/** Handler of generations.getBriefDiffBaselinePage. */
export async function getBriefDiffBaselinePageHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getBriefDiffBaselinePageArgs>
) {
  const numItems = Number.isFinite(args.numItems)
    ? Math.min(MAX_BRIEF_ENTRY_ROWS, Math.max(1, Math.floor(args.numItems)))
    : MAX_BRIEF_ENTRY_ROWS;
  const result = await ctx.db
    .query("generationBriefEntries")
    .withIndex("by_briefId", (q) => q.eq("briefId", args.briefId))
    .paginate({
      cursor: args.cursor,
      numItems,
      maximumBytesRead: BRIEF_BASELINE_PAGE_BYTES,
    });
  const entries: Array<BriefCandidateEntry & { entryId: Id<"generationBriefEntries"> }> = [];
  for (const row of result.page) {
    const payload = liveBaselinePayload(row);
    if (payload !== null) entries.push({ entryId: row._id, ...payload });
  }
  return {
    entries,
    readCount: result.page.length,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
    pageStatus: result.pageStatus ?? null,
  };
}

/** Argument validators of generations.persistDerivedBrief. */
export const persistDerivedBriefArgs = {
  projectId: v.id("projects"),
  generationId: v.id("generations"),
  inputsHash: v.string(),
  origin: v.union(v.literal("writer"), v.literal("derived")),
  seedStartup: v.optional(v.boolean()),
  storylineText: v.string(),
  entries: v.array(briefCandidateEntryValidator),
  // Entries the caller already dropped before reaching here (its own
  // citeQuote pass never found a byte-match — see `brief.ts`). Added to
  // whatever this mutation's own re-validation additionally drops, so
  // `droppedEntryCount` reflects every entry the model proposed that never
  // made it into the Brief.
  upstreamDroppedEntryCount: v.optional(v.number()),
  // The project's newest Brief when the baseline was pinned (`null`: none).
  baselineBriefId: v.union(v.id("generationBriefs"), v.null()),
  // One reference per live key of that Brief that `entries[candidateIndex]`
  // shares — no text.
  baselineRetained: v.array(
    v.object({
      entryId: v.id("generationBriefEntries"),
      candidateIndex: v.number(),
    })
  ),
  // The full payload of each live key of that Brief no candidate shares.
  baselineRemoved: v.array(briefCandidateEntryValidator),
};

/** Handler of generations.persistDerivedBrief. */
export async function persistDerivedBriefHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof persistDerivedBriefArgs>
) {
  if (await isProjectDeleting(ctx, args.projectId)) {
    domainError("INVALID_STATE", "Project is being deleted");
  }
  const generation = await ctx.db.get(args.generationId);
  if (!generation || generation.projectId !== args.projectId) {
    domainError("NOT_FOUND", "Generation not found");
  }
  const seedStartup = resolveGatedWorkflow(generation) === "seeds";
  if (seedStartup) {
    await requireSeedInitialization(ctx, generation._id);
    if (!args.seedStartup || generation.seedBriefPin === undefined ||
        generation.seedBriefInputsHash !== args.inputsHash ||
        args.baselineBriefId !== null || args.baselineRetained.length || args.baselineRemoved.length) {
      domainError("INVALID_STATE", "Seed Brief publication must use frozen startup inputs");
    }
    if (generation.briefId) return generation.briefId;
    if (generation.seedBriefPin !== null) domainError("INVALID_STATE", "Pinned Brief cannot be replaced");
  }
  const reusable = await latestBriefForInputs(
    ctx,
    args.projectId,
    args.inputsHash
  );
  let compatibleReusable = false;
  if (reusable) {
    const reusableScope = await briefEntryReadScope(ctx, generation, reusable);
    compatibleReusable = reusableScope === "all" ||
      (await readBriefEntryRowsBounded(ctx, reusable._id, reusableScope)).kind ===
        "complete";
  }
  if (reusable && compatibleReusable && !seedStartup) {
    const checked = await briefWithoutExcludedQuotes(ctx, reusable);
    await ctx.db.patch(args.generationId, { briefId: checked._id });
    return checked._id;
  }

  if (!seedStartup) {
    const newest = await newestProjectBrief(ctx, args.projectId);
    if ((newest?._id ?? null) !== args.baselineBriefId) return null;
  }

  let droppedEntryCount = args.upstreamDroppedEntryCount ?? 0;
  const validatedEntries: Array<
    (typeof args.entries)[number]
  > = [];
  // Owner decision 25 (2026-09-25): an entry whose quote is only the
  // interviewer's or another speaker's words is dropped here too, whatever
  // the derivation chose (defense in depth, like the byte check).
  const speakerOf = citationSpeakerReader(ctx);
  // One read per distinct cited source, however many entries cite it.
  const sources = new Map<Id<"generationSources">, Doc<"generationSources"> | null>();
  for (const entry of args.entries) {
    let source = sources.get(entry.sourceId);
    if (source === undefined) {
      source = await ctx.db.get(entry.sourceId);
      sources.set(entry.sourceId, source);
    }
    // Tenant-scoping parity with reports.createProvenance (convex/reports.ts:108-118):
    // a citation must resolve to a source belonging to this project and generation,
    // not just pass the byte-match check.
    if (
      !source ||
      source.projectId !== args.projectId ||
      source.generationId !== args.generationId ||
      !validateCitation(source, entry) ||
      (await speakerOf(source, entry.startOffset, entry.endOffset)) === "excluded"
    ) {
      droppedEntryCount += 1;
      continue;
    }
    validatedEntries.push(entry);
  }

  const hasPreviousBrief = args.baselineBriefId !== null;
  type BaselineKey =
    | { retained: (typeof args.baselineRetained)[number] }
    | { removed: BriefCandidateEntry };
  const baselineByKey = new Map<string, BaselineKey>();
  for (const reference of args.baselineRetained) {
    const candidate = Number.isInteger(reference.candidateIndex)
      ? args.entries[reference.candidateIndex]
      : undefined;
    if (candidate === undefined) {
      return domainError(
        "INVALID_STATE",
        `Generation Brief diff baseline reference ${reference.entryId} names candidate ${reference.candidateIndex} of ${args.entries.length}`
      );
    }
    baselineByKey.set(briefDiffKey(candidate), { retained: reference });
  }
  for (const row of args.baselineRemoved) {
    baselineByKey.set(briefDiffKey(row), { removed: row });
  }

  // Stamp every validated entry; each baseline key matches at most once.
  const stampedEntries = validatedEntries.map((entry) => {
    const matched = baselineByKey.delete(briefDiffKey(entry));
    const change = !hasPreviousBrief
      ? undefined
      : matched
        ? ("unchanged" as const)
        : ("added" as const);
    return { entry, change };
  });

  // Whatever's left existed before and doesn't now.
  const markers: BriefCandidateEntry[] = [];
  for (const [key, unmatched] of baselineByKey) {
    if ("removed" in unmatched) {
      markers.push(unmatched.removed);
      continue;
    }
    // Every candidate sharing this key failed re-validation: the old row is
    // a truthful marker, but only if it is what the reference claims.
    const row = await ctx.db.get(unmatched.retained.entryId);
    const payload =
      row && row.briefId === args.baselineBriefId ? liveBaselinePayload(row) : null;
    if (payload === null || briefDiffKey(payload) !== key) {
      return domainError(
        "INVALID_STATE",
        `Generation Brief diff baseline reference ${unmatched.retained.entryId} is not a live row of Brief ${args.baselineBriefId} with its candidate's key`
      );
    }
    markers.push(payload);
  }

  const briefId = await ctx.db.insert("generationBriefs", {
    projectId: args.projectId,
    generationId: args.generationId,
    inputsHash: args.inputsHash,
    version: (reusable?.version ?? 0) + 1,
    origin: args.origin,
    storylineText: args.storylineText,
    droppedEntryCount,
    createdAt: Date.now(),
  });

  for (const { entry, change } of stampedEntries) {
    await ctx.db.insert("generationBriefEntries", {
      briefId,
      projectId: args.projectId,
      group: entry.group,
      text: entry.text,
      reason: entry.reason,
      confidence: entry.confidence,
      sourceId: entry.sourceId,
      sourceContentHash: entry.sourceContentHash,
      startOffset: entry.startOffset,
      endOffset: entry.endOffset,
      exactExcerpt: entry.exactExcerpt,
      change,
      createdAt: Date.now(),
    });
  }
  for (const removed of markers) {
    await ctx.db.insert("generationBriefEntries", {
      briefId,
      projectId: args.projectId,
      group: removed.group,
      text: removed.text,
      reason: removed.reason,
      confidence: removed.confidence,
      sourceId: removed.sourceId,
      sourceContentHash: removed.sourceContentHash,
      startOffset: removed.startOffset,
      endOffset: removed.endOffset,
      exactExcerpt: removed.exactExcerpt,
      change: "removed",
      createdAt: Date.now(),
    });
  }

  await ctx.db.patch(args.generationId, { briefId });
  return briefId;
}

/** Argument validators of generations.renderBriefForGeneration. */
export const renderBriefForGenerationArgs = { generationId: v.id("generations") };

/** Handler of generations.renderBriefForGeneration. */
export async function renderBriefForGenerationHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof renderBriefForGenerationArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation?.briefId) return "";
  const brief = await ctx.db.get(generation.briefId);
  if (!brief) return "";
  const entries = await readBriefEntryRowsOrOmit(ctx, generation, brief);
  // Fail open: an unreadable Brief is omitted whole, exactly as a
  // generation with no briefId renders "" above. Never a prefix.
  if (entries === null) return "";
  return renderBriefBlock(
    brief.storylineText,
    // The same filter `loadBriefCheck` applies, so both prompt readers
    // render exactly the same rows: a re-derivation's change: "removed"
    // markers are history for the diff UI, not guidance in force.
    entries.filter(
      (e) => e.group !== "storylineQuestion" && e.change !== "removed"
    )
  );
}

/** The Brief a section is drafted with and checked against: the same rows
 * renderBriefForGeneration renders into the prompt. */
export async function loadBriefCheck(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">
) {
  const summary = generation.summaryVersionId
    ? await ctx.db.get(generation.summaryVersionId)
    : null;
  const isSummaryConsumer =
    resolveGatedWorkflow(generation) === "seeds" &&
    generation.summaryVersionId !== undefined;
  if (
    isSummaryConsumer &&
    (!summary ||
      summary.projectId !== generation.projectId ||
      summary.originGenerationId !== (generation.originGenerationId ?? generation._id))
  ) {
    domainError("INVALID_STATE", "Frozen Summary Brief lineage is unavailable", {
      reason: "SUMMARY_BRIEF_UNREADABLE",
    });
  }
  const briefId = isSummaryConsumer ? summary?.briefVersionId : generation.briefId;
  const briefDoc = briefId ? await ctx.db.get(briefId) : null;
  if (!briefDoc || briefDoc.projectId !== generation.projectId) {
    if (isSummaryConsumer) {
      domainError("INVALID_STATE", "Frozen Summary Brief is unavailable", {
        reason: "SUMMARY_BRIEF_UNREADABLE",
      });
    }
    return { briefBlock: "", brief: null, briefDoc: null, briefEntries: [] };
  }
  const read = await readBriefEntryRowsBounded(
    ctx,
    briefDoc._id,
    await briefEntryReadScope(ctx, generation, briefDoc)
  );
  if (read.kind !== "complete") {
    if (isSummaryConsumer) {
      domainError("INVALID_STATE", "Frozen Summary Brief cannot be read completely", {
        reason:
          read.kind === "row_limit"
            ? "SUMMARY_BRIEF_ROWS_EXCEEDED"
            : "SUMMARY_BRIEF_BYTES_EXCEEDED",
      });
    }
    // Legacy Brief guidance remains optional and fail-open.
    console.error(
      read.kind === "row_limit"
        ? `Generation Brief omitted from generation ${generation._id}: Brief ${briefDoc._id} has more than ${MAX_BRIEF_ENTRY_ROWS} entries and cannot be read completely`
        : `Generation Brief omitted from generation ${generation._id}: Brief ${briefDoc._id} cannot be read completely within ${BRIEF_CONSUMER_READ_BYTES} bytes`
    );
    return { briefBlock: "", brief: null, briefDoc: null, briefEntries: [] };
  }
  const rows = read.rows;
  const entries = rows.filter(
    // A re-derivation carries the previous version's dropped entries as
    // change: "removed" markers for the diff; they are no longer in force.
    (entry) => entry.group !== "storylineQuestion" && entry.change !== "removed"
  );
  // Brief and Seed citations share the same immutable origin-to-current
  // resolver. Recovery never substitutes equal hashes for source identity.
  for (const sourceId of new Set(entries.map((entry) => entry.sourceId as string))) {
    resolveFrozenSourceId(sourceId, generation.sourceIdMap);
  }
  return {
    briefBlock: renderBriefBlock(briefDoc.storylineText, entries),
    briefDoc,
    briefEntries: rows,
    brief: {
      storylineText: briefDoc.storylineText,
      claimExclusions: entries
        .filter((entry) => entry.group === "claimExclusion")
        .map((entry) => ({
          text: entry.text,
          exactExcerpt: entry.exactExcerpt,
          ...(entry.reason ? { reason: entry.reason } : {}),
        })),
      confidenceMap: entries
        .filter((entry) => entry.group === "confidenceMap")
        .map((entry) => ({
          entryId: entry._id,
          text: entry.text,
          ...(entry.confidence ? { confidence: entry.confidence } : {}),
        })),
      glossaryTerms: entries
        .filter((entry) => entry.group === "glossaryTerm")
        .map((entry) => entry.text),
    },
  };
}
