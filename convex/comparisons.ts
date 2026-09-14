/**
 * AD-29 (story 6, CAP-16): Paired Comparison records and the SM-1 / SM-2
 * readout.
 *
 * Every judgement field on a `comparisons` row is entered by a human judge.
 * The server resolves only the revision pin (`projectId`, `reportId`,
 * `revisionNumber`, `contentHash`, `generationId`), `recordedAt`, and
 * `draftTextMatches`. No code path in this file reads proposal items,
 * compliance notes, QA scores, consultant reviews, or any other model output:
 * Deviation and Corrections-to-acceptable counts are the judge's manual counts
 * (measurement-protocol.md, "LLM self-scores are never an outcome"). The exact
 * table names that must never appear here are pinned by the source-contract
 * test in `comparisons.test.ts`.
 *
 * A recorded row is never patched or deleted. The only correction path is a
 * new row whose `voidsComparisonId` names the row it replaces, and at most one
 * live (non-voided) row exists per project — CAP-16 records a Paired
 * Comparison *per project*, so a second live row would force a tie-break rule
 * inside the metric query. Writes and reads both require an Admin: AD-29's
 * interim answer to Q18.
 *
 * READ BUDGETS. A row carries both pasted drafts, each permitted up to 120,000
 * characters, so a `comparisons` row can approach 751 KB in UTF-8. A
 * fixed 200- or 500-row scan of this table can therefore blow past Convex's
 * 16 MiB per-transaction read limit
 * (https://docs.convex.dev/production/state/limits#transactions). Every read
 * here reserves bytes before reading, including ancillary documents. The picker
 * is paginated; a capped metric corpus explicitly withholds its conclusion.
 */
import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./lib/auth";
import { domainError, sha256 } from "./lib/contracts";
import { comparisonPlainText } from "./lib/comparisonText";
import {
  summarizeSuccessMetrics,
  type SuccessMetricRow,
} from "./lib/successMetrics";
import { userDisplayLabel } from "./lib/teamRoster";
import { modelById } from "../shared/generationModels";

/** A pasted strip longer than this is a paste accident, not a PD. */
const MAX_DRAFT_TEXT_LENGTH = 120_000;
/** Free-text provenance fields (model ids, caveat, counting method). */
const MAX_NOTE_LENGTH = 2_000;

/**
 * Worst-case ENCODED size of one `comparisons` row.
 *
 * Convex stores strings as UTF-8 and charges the transaction for the encoded
 * bytes, so a maximum-length draft of three-byte characters is three times the
 * size an ASCII draft of the same character count would suggest. Every budget
 * below is checked against this figure BEFORE a read, so a batch can never be
 * fetched that the remaining budget cannot cover — a guard consulted only
 * after `.take(...)` has already returned the documents guards nothing.
 *
 * Two drafts plus the five free-text provenance fields, at three UTF-8 bytes
 * per UTF-16 code unit (the maximum; a surrogate pair is four bytes for two
 * units, i.e. two per unit), plus ids, numbers and keys.
 */
const MAX_ROW_BYTES =
  2 * MAX_DRAFT_TEXT_LENGTH * 3 + 5 * MAX_NOTE_LENGTH * 3 + 1_024;

/** Records shown for one project at a time; a project has a handful at most. */
const PROJECT_COMPARISON_LIMIT = 12;
/** One picker page. Each entry costs at most one `comparisons` row. */
const TARGET_PAGE_SIZE = 25;
/** Encoded bytes one picker page may read before it stops resolving liveness. */
const TARGET_BYTE_BUDGET = 6_000_000;
/** Metric corpus: read in pages sized by the remaining byte budget. */
const METRIC_BATCH = 25;
const METRIC_ROW_CAP = 500;
const METRIC_BYTE_BUDGET = 8_000_000;
/** Per-project detail (label + financial summary) attached to the readout. */
const METRIC_DETAIL_CAP = 100;
/** Convex caps every stored document at 1 MiB, including unbounded strings. */
const MAX_DOCUMENT_BYTES = 1_048_576;
const TARGET_PROJECT_BYTE_BUDGET = 2_000_000;
const ANCILLARY_BYTE_BUDGET = 5_000_000;

/** Conservative encoded size, including per-value/container/key overhead. */
function documentBytes(document: unknown): number {
  const size = (value: unknown): number => {
    if (typeof value === "string") return utf8Bytes(value) + 16;
    if (Array.isArray(value))
      return 16 + value.reduce((sum, item) => sum + size(item), 0);
    if (value !== null && typeof value === "object") {
      return (
        16 +
        Object.entries(value).reduce(
          (sum, [key, item]) => sum + utf8Bytes(key) + 16 + size(item),
          0
        )
      );
    }
    return 16;
  };
  // Either upper bound suffices; the document limit also covers future fields.
  return document === null
    ? 0
    : Math.min(MAX_DOCUMENT_BYTES, size(document) + 1_024);
}

type Ctx = QueryCtx | MutationCtx;
type Comparison = Doc<"comparisons">;

/**
 * Encoded (UTF-8) length of a string, counted without allocating a copy.
 *
 * `String.length` counts UTF-16 code units, which understates a non-ASCII
 * document by up to three times — the difference between a scan that fits the
 * transaction limit and one that does not.
 */
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      // A surrogate pair is one code point: four bytes for two code units.
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The actual read cost of a row: both drafts and all five free-text
 * provenance fields, encoded, plus a fixed allowance for ids, numbers and
 * keys. Used to charge a budget for what was really read; `MAX_ROW_BYTES` is
 * what the budget is *reserved* against before a read happens.
 */
function rowBytes(row: Comparison): number {
  return (
    utf8Bytes(row.banhallDraftText) +
    utf8Bytes(row.baselineDraftText) +
    utf8Bytes(row.banhallModel) +
    utf8Bytes(row.baselineProduct) +
    utf8Bytes(row.baselineModel) +
    utf8Bytes(row.modelCaveat) +
    utf8Bytes(row.countingMethod) +
    1_024
  );
}

/** A row is voided when some OTHER row in the set names it. No row is patched. */
function voidedIds(rows: readonly Comparison[]): Set<string> {
  const voided = new Set<string>();
  for (const row of rows) {
    if (row.voidsComparisonId) voided.add(String(row.voidsComparisonId));
  }
  return voided;
}

/**
 * The project's newest record, which is its live one.
 *
 * A correction is always inserted *after* the row it voids, so no row can be
 * voided by anything older than itself: the newest row in `by_projectId`
 * order is never in any other row's `voidsComparisonId`. Finding the live row
 * is therefore one document read, not a walk over the project's history
 * (R6: "avoid history scans merely to find the current row").
 */
async function liveComparison(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<Comparison | null> {
  const newest = await ctx.db
    .query("comparisons")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .order("desc")
    .take(1);
  return newest[0] ?? null;
}

/**
 * A judge's count. `Number.isInteger` accepts values above
 * `Number.MAX_SAFE_INTEGER` whose integer identity is an artefact of float
 * rounding, so a count that cannot be stored and read back exactly is refused
 * rather than silently rounded.
 */
function requireCount(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    domainError(
      "INVALID_INPUT",
      `${field} must be a whole number between 0 and ${Number.MAX_SAFE_INTEGER}`
    );
  }
}

/**
 * Validates a human-entered string and returns the CALLER'S string unchanged.
 *
 * Emptiness is judged on the trimmed value and length on the value as typed,
 * but what is stored is what the human entered — the record is evidence, and
 * silently reshaping a judge's text would make it something else. Match
 * normalization is a separate rule that lives in `comparisonPlainText`.
 */
function requireDraftText(value: string, field: string): string {
  if (!value.trim()) {
    domainError("INVALID_INPUT", `${field} is empty`);
  }
  if (value.length > MAX_DRAFT_TEXT_LENGTH) {
    domainError(
      "INVALID_INPUT",
      `${field} exceeds ${MAX_DRAFT_TEXT_LENGTH.toLocaleString("en-CA")} characters`
    );
  }
  return value;
}

function requireNote(value: string, field: string): string {
  if (!value.trim()) domainError("INVALID_INPUT", `${field} is required`);
  if (value.length > MAX_NOTE_LENGTH) {
    domainError("INVALID_INPUT", `${field} is too long`);
  }
  return value;
}

/**
 * The Banhall-side model the report was actually generated with, as a label —
 * the default offered for the judge's `banhallModel` field.
 *
 * Resolved from the generation's own selection row first, else its recorded
 * `singleModelId`. When neither is known there is NO suggestion: the registry
 * default is today's configuration, not evidence of what a historical
 * generation ran (R10), and the `banhallModel` field is the judge's to fill.
 */
async function suggestedBanhallModel(
  ctx: Ctx,
  report: Doc<"reports">
): Promise<string | null> {
  const generationId = report.generationId;
  if (!generationId) return null;
  const selection = await ctx.db
    .query("modelSelections")
    .withIndex("by_projectId_and_generationId", (q) =>
      q.eq("projectId", report.projectId).eq("generationId", generationId)
    )
    .first();
  if (selection) return selection.label || selection.model;
  const generation = await ctx.db.get(generationId);
  const modelId = generation?.singleModelId;
  if (!modelId) return null;
  return modelById(modelId)?.label ?? modelId;
}

/**
 * Record one Paired Comparison.
 *
 * The pin is read from the report, never from the caller, and fenced on
 * `expectedRevisionNumber` exactly like `reports.updateReportContent`, so the
 * row names the revision the judge actually read.
 */
export const record = mutation({
  args: {
    reportId: v.id("reports"),
    expectedRevisionNumber: v.number(),
    banhallModel: v.string(),
    baselineProduct: v.string(),
    baselineModel: v.string(),
    modelCaveat: v.string(),
    judgeUserId: v.id("users"),
    preference: v.union(
      v.literal("banhall"),
      v.literal("baseline"),
      v.literal("tie")
    ),
    deviationsBanhall: v.number(),
    deviationsBaseline: v.number(),
    countingMethod: v.string(),
    correctionsBanhall: v.number(),
    correctionsBaseline: v.number(),
    usedInDevelopment: v.boolean(),
    banhallDraftText: v.string(),
    baselineDraftText: v.string(),
    voidsComparisonId: v.optional(v.id("comparisons")),
  },
  handler: async (ctx, args) => {
    // Q18 interim: Admin only. Runs before any lookup so a non-admin caller
    // cannot probe report or project existence.
    await requireRole(ctx, ["admin"]);

    requireCount(args.deviationsBanhall, "Banhall Deviations");
    requireCount(args.deviationsBaseline, "Baseline Deviations");
    requireCount(args.correctionsBanhall, "Banhall Corrections-to-acceptable");
    requireCount(args.correctionsBaseline, "Baseline Corrections-to-acceptable");
    // Validated, then stored exactly as the human entered them.
    const banhallDraftText = requireDraftText(
      args.banhallDraftText,
      "The Banhall draft"
    );
    const baselineDraftText = requireDraftText(
      args.baselineDraftText,
      "The baseline draft"
    );
    const banhallModel = requireNote(args.banhallModel, "Banhall model");
    const baselineProduct = requireNote(args.baselineProduct, "Baseline product");
    const baselineModel = requireNote(args.baselineModel, "Baseline model");
    // Q15 is unresolved, so the caveat is the record's answer to it.
    const modelCaveat = requireNote(args.modelCaveat, "Model-equivalence caveat");
    const countingMethod = requireNote(args.countingMethod, "Counting method");

    const report = await ctx.db.get(args.reportId);
    if (!report) domainError("NOT_FOUND", "Report not found");

    const revisionNumber = report.revisionNumber ?? 0;
    if (args.expectedRevisionNumber !== revisionNumber) {
      domainError(
        "STALE_REVISION",
        "The report moved to a new revision after this comparison was loaded"
      );
    }

    // The judge is a named team member, not free text: SM-1 attributes every
    // judgement.
    const judge = await ctx.db.get(args.judgeUserId);
    if (!judge || judge.isAnonymous === true || !judge.role) {
      domainError("INVALID_INPUT", "The judge must be an active team member");
    }

    const live = await liveComparison(ctx, report.projectId);
    if (args.voidsComparisonId) {
      const target = await ctx.db.get(args.voidsComparisonId);
      if (!target || target.projectId !== report.projectId) {
        domainError(
          "INVALID_INPUT",
          "The comparison being replaced does not belong to this project"
        );
      }
      if (!live || live._id !== args.voidsComparisonId) {
        domainError(
          "INVALID_INPUT",
          "The comparison being replaced is already voided"
        );
      }
    } else if (live) {
      domainError(
        "INVALID_STATE",
        "This project already has a live Paired Comparison. Record a correction that voids it instead of adding a second record.",
        { liveComparisonId: String(live._id) }
      );
    }

    // Evidence, never a gate. Both sides go through one normalization rule so
    // a blinded reformat still matches and a wrong draft still records. Two
    // inputs that normalize to no prose at all are NOT a match: equality of
    // nothing is not evidence that the judge read this revision (R15).
    const contentHash = report.contentHash || (await sha256(report.content));
    const revisionProse = comparisonPlainText(report.content);
    const draftProse = comparisonPlainText(banhallDraftText);
    const draftTextMatches =
      revisionProse.length > 0 &&
      draftProse.length > 0 &&
      (await sha256(revisionProse)) === (await sha256(draftProse));

    return await ctx.db.insert("comparisons", {
      projectId: report.projectId,
      reportId: report._id,
      revisionNumber,
      contentHash,
      generationId: report.generationId,
      banhallModel,
      baselineProduct,
      baselineModel,
      modelCaveat,
      judgeUserId: args.judgeUserId,
      preference: args.preference,
      deviationsBanhall: args.deviationsBanhall,
      deviationsBaseline: args.deviationsBaseline,
      countingMethod,
      correctionsBanhall: args.correctionsBanhall,
      correctionsBaseline: args.correctionsBaseline,
      usedInDevelopment: args.usedInDevelopment,
      recordedAt: Date.now(),
      voidsComparisonId: args.voidsComparisonId,
      banhallDraftText,
      baselineDraftText,
      draftTextMatches,
    });
  },
});

/**
 * The project picker on /admin/comparisons, one bounded page at a time.
 *
 * Paged rather than capped at "the newest 200" so a project older than the
 * first page is still reachable, selectable and correctable (R7). Liveness
 * costs at most one `comparisons` row per project; once a page has read
 * `TARGET_BYTE_BUDGET` of drafts it stops resolving liveness and reports it as
 * unknown (`null`) rather than exceeding the transaction read limit (R6).
 */
export const listRecordTargets = query({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const page = await ctx.db
      .query("projects")
      .order("desc")
      .paginate({
        numItems: TARGET_PAGE_SIZE,
        cursor: args.cursor ?? null,
        maximumRowsRead: TARGET_PAGE_SIZE,
        maximumBytesRead: TARGET_PROJECT_BYTE_BUDGET,
      });
    // Pagination may cross its byte threshold by one document. Even allowing
    // that 1 MiB overshoot, projects + liveness + auth remain below 16 MiB.

    let bytes = 0;
    const targets = [];
    for (const project of page.page) {
      let hasLiveComparison: boolean | null = null;
      // Reserve a worst-case row BEFORE reading it: once the remaining budget
      // could not cover one, liveness is reported as unknown rather than read.
      if (bytes + MAX_ROW_BYTES <= TARGET_BYTE_BUDGET) {
        const live = await liveComparison(ctx, project._id);
        bytes += live ? rowBytes(live) : 0;
        hasLiveComparison = live !== null;
      }
      targets.push({
        projectId: project._id,
        label: `${project.clientName} — ${project.title}`,
        hasLiveComparison,
      });
    }
    return {
      targets,
      cursor: page.continueCursor,
      isDone: page.isDone,
      pageSize: TARGET_PAGE_SIZE,
    };
  },
});

/**
 * The pin the form submits back, and nothing else.
 *
 * The revision's canonical plain text is deliberately NOT returned: a recorder
 * who could read it could paste it in and manufacture a `draftTextMatches:
 * true`, which would destroy the only evidence that the judge rated this
 * revision.
 */
export const getRecordContext = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (!report) return null;
    const live = await liveComparison(ctx, args.projectId);
    return {
      reportId: report._id,
      revisionNumber: report.revisionNumber ?? 0,
      contentHash: report.contentHash ?? null,
      generationId: report.generationId ?? null,
      suggestedBanhallModel: await suggestedBanhallModel(ctx, report),
      liveComparisonId: live?._id ?? null,
    };
  },
});

/**
 * Every record on a project, newest first, with liveness derived in memory.
 *
 * Bounded to `PROJECT_COMPARISON_LIMIT` rows: corrections on one project are a
 * handful, and each row carries both pasted drafts. `hasMore` says plainly
 * when older records exist beyond the window rather than implying the list is
 * the project's whole history.
 */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    // One row of lookahead: `hasMore` must mean "there is a row past this
    // window", not "the window happens to be full".
    const fetched = await ctx.db
      .query("comparisons")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(PROJECT_COMPARISON_LIMIT + 1);
    const hasMore = fetched.length > PROJECT_COMPARISON_LIMIT;
    const rows = fetched.slice(0, PROJECT_COMPARISON_LIMIT);
    // A voider is always newer than the row it voids, so every voider of a row
    // in this newest-first window is in the window too.
    const voided = voidedIds(rows);
    const judgeLabels = new Map<string, string>();
    let judgeBytes = 0;
    for (const row of rows) {
      const key = String(row.judgeUserId);
      if (judgeLabels.has(key)) continue;
      if (judgeBytes + MAX_DOCUMENT_BYTES > ANCILLARY_BYTE_BUDGET) {
        judgeLabels.set(key, "Judge label unavailable (read limit)");
        continue;
      }
      const judge = await ctx.db.get(row.judgeUserId);
      judgeBytes += documentBytes(judge);
      judgeLabels.set(key, judge ? userDisplayLabel(judge) : "Unknown judge");
    }
    return {
      records: rows.map((row) => ({
        _id: row._id,
        recordedAt: row.recordedAt,
        revisionNumber: row.revisionNumber,
        contentHash: row.contentHash,
        generationId: row.generationId ?? null,
        banhallModel: row.banhallModel,
        baselineProduct: row.baselineProduct,
        baselineModel: row.baselineModel,
        modelCaveat: row.modelCaveat,
        judgeUserId: row.judgeUserId,
        judgeLabel: judgeLabels.get(String(row.judgeUserId)) ?? "Unknown judge",
        preference: row.preference,
        deviationsBanhall: row.deviationsBanhall,
        deviationsBaseline: row.deviationsBaseline,
        countingMethod: row.countingMethod,
        correctionsBanhall: row.correctionsBanhall,
        correctionsBaseline: row.correctionsBaseline,
        usedInDevelopment: row.usedInDevelopment,
        draftTextMatches: row.draftTextMatches,
        voidsComparisonId: row.voidsComparisonId ?? null,
        voided: voided.has(String(row._id)),
      })),
      hasMore,
    };
  },
});

/** Where the corpus walk stopped: the full index key of the last row read. */
type ScanCursor = { recordedAt: number; creationTime: number };

/**
 * The next `limit` rows strictly after `cursor` in `by_recordedAt` descending
 * order, reading no more than `limit` documents.
 *
 * The index orders by `(recordedAt, _creationTime)`, so "strictly after" is a
 * disjunction — a smaller `recordedAt`, OR the same `recordedAt` with a
 * smaller `_creationTime`. A cursor on `recordedAt` alone cannot express the
 * second case, so a single millisecond holding a whole batch would strand the
 * walk forever and withhold the metric permanently. Draining the tie through
 * `_creationTime` first makes progress guaranteed, and nothing is re-read.
 */
async function comparisonsAfter(
  ctx: Ctx,
  cursor: ScanCursor | null,
  limit: number
): Promise<Comparison[]> {
  if (!cursor) {
    return await ctx.db
      .query("comparisons")
      .withIndex("by_recordedAt")
      .order("desc")
      .take(limit);
  }
  const sameStamp = await ctx.db
    .query("comparisons")
    .withIndex("by_recordedAt", (q) =>
      q.eq("recordedAt", cursor.recordedAt).lt("_creationTime", cursor.creationTime)
    )
    .order("desc")
    .take(limit);
  if (sameStamp.length >= limit) return sameStamp;
  const older = await ctx.db
    .query("comparisons")
    .withIndex("by_recordedAt", (q) => q.lt("recordedAt", cursor.recordedAt))
    .order("desc")
    .take(limit - sameStamp.length);
  return [...sameStamp, ...older];
}

/**
 * Walk `by_recordedAt` newest-first, one bounded page at a time.
 *
 * Each page is sized so that the worst case it could return still fits the
 * remaining byte budget, so the budget is enforced before the read rather than
 * after it. `complete` is true only when the walk reached the beginning of the
 * table; a partial window is never presented as the whole corpus, and the
 * caller withholds a conclusive metric instead.
 */
async function scanComparisonsNewestFirst(
  ctx: Ctx
): Promise<{ rows: Comparison[]; complete: boolean }> {
  const rows: Comparison[] = [];
  let bytes = 0;
  let cursor: ScanCursor | null = null;

  for (;;) {
    const affordable = Math.floor((METRIC_BYTE_BUDGET - bytes) / MAX_ROW_BYTES);
    if (affordable < 1) return { rows, complete: false };
    if (rows.length >= METRIC_ROW_CAP) {
      // A full window is complete when there is no next row. Reserve this
      // lookahead in the same byte budget and never include it in the metric.
      const lookahead = await comparisonsAfter(ctx, cursor, 1);
      return { rows, complete: lookahead.length === 0 };
    }
    const limit = Math.min(
      METRIC_BATCH,
      affordable,
      METRIC_ROW_CAP - rows.length
    );

    const batch = await comparisonsAfter(ctx, cursor, limit);
    for (const row of batch) {
      bytes += rowBytes(row);
      rows.push(row);
    }
    // A short page is the end of the table: the walk is complete.
    if (batch.length < limit) return { rows, complete: true };
    const last = batch[batch.length - 1];
    cursor = { recordedAt: last.recordedAt, creationTime: last._creationTime };
  }
}

/**
 * SM-1 / SM-2, computed only from judge-entered counts on live, non-development
 * `comparisons` rows.
 *
 * `computedMet` covers the countable clauses only; `manualConditions` names the
 * clauses no query can check, and each eligible project's `financialSummaries`
 * figures are attached where a financial upload ran so the "100–200-hour"
 * clause can be settled by a human. When the corpus walk did not reach the
 * beginning of the table, `corpusComplete` is false and `computedMet` is
 * withheld (forced false) — a partial window must never read as a full result.
 *
 * The per-project detail lists are capped independently of the corpus walk, so
 * each carries its true total and an explicit truncation flag: a measurement
 * artifact that quietly dropped an excluded project would misstate the very
 * exclusions it exists to record.
 */
export const successMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const { rows, complete } = await scanComparisonsNewestFirst(ctx);
    // Newest-first, and a voider is always newer than its target, so every
    // voider of a scanned row was itself scanned.
    const voided = voidedIds(rows);

    const eligible: Comparison[] = [];
    const development: Comparison[] = [];
    let voidedCount = 0;
    for (const row of rows) {
      if (voided.has(String(row._id))) {
        voidedCount += 1;
        continue;
      }
      if (row.usedInDevelopment) {
        development.push(row);
        continue;
      }
      eligible.push(row);
    }

    const metricRows: SuccessMetricRow[] = eligible.map((row) => ({
      projectId: String(row.projectId),
      preference: row.preference,
      deviationsBanhall: row.deviationsBanhall,
      deviationsBaseline: row.deviationsBaseline,
      correctionsBanhall: row.correctionsBanhall,
    }));
    const summary = summarizeSuccessMetrics(metricRows);

    // 8 MB corpus + 5 MB ancillary + one auth document < 16 MiB. Reserve
    // each whole document BEFORE its read, refunding the unused allowance via
    // conservative actual charges. Small documents still fill the detail cap.
    let ancillaryBytes = 0;
    const projectLabels = new Map<string, string>();
    const labelFor = async (projectId: Id<"projects">) => {
      const key = String(projectId);
      const cached = projectLabels.get(key);
      if (cached !== undefined) return cached;
      const project = await ctx.db.get(projectId);
      ancillaryBytes += documentBytes(project);
      const label = project
        ? `${project.clientName} — ${project.title}`
        : "Deleted project";
      projectLabels.set(key, label);
      return label;
    };

    const projects = [];
    for (const row of eligible.slice(0, METRIC_DETAIL_CAP)) {
      const reservedBytes =
        MAX_DOCUMENT_BYTES * (projectLabels.has(String(row.projectId)) ? 1 : 2);
      if (ancillaryBytes + reservedBytes > ANCILLARY_BYTE_BUDGET) break;
      // The "≥ 1 small (100–200-hour)" clause is reported, never computed: no
      // project row carries claim hours, and `financialSummaries` exists only
      // where a financial upload ran.
      const financial = await ctx.db
        .query("financialSummaries")
        .withIndex("by_projectId", (q) => q.eq("projectId", row.projectId))
        .first();
      ancillaryBytes += documentBytes(financial);
      projects.push({
        comparisonId: row._id,
        projectId: row.projectId,
        label: await labelFor(row.projectId),
        recordedAt: row.recordedAt,
        preference: row.preference,
        deviationsBanhall: row.deviationsBanhall,
        deviationsBaseline: row.deviationsBaseline,
        correctionsBanhall: row.correctionsBanhall,
        correctionsBaseline: row.correctionsBaseline,
        draftTextMatches: row.draftTextMatches,
        sm1Satisfied:
          row.preference === "banhall" &&
          row.deviationsBanhall * 2 <= row.deviationsBaseline,
        sm2Satisfied: row.correctionsBanhall <= 1,
        financials: financial
          ? { totalHours: financial.totalHours, sredHours: financial.sredHours }
          : null,
      });
    }

    const developmentRows = [];
    for (const row of development.slice(0, METRIC_DETAIL_CAP)) {
      const reservedBytes = projectLabels.has(String(row.projectId))
        ? 0
        : MAX_DOCUMENT_BYTES;
      if (ancillaryBytes + reservedBytes > ANCILLARY_BYTE_BUDGET) break;
      developmentRows.push({
        comparisonId: row._id,
        projectId: row.projectId,
        label: await labelFor(row.projectId),
        recordedAt: row.recordedAt,
        preference: row.preference,
      });
    }

    return {
      sm1: { ...summary.sm1, computedMet: summary.sm1.computedMet && complete },
      sm2: { ...summary.sm2, computedMet: summary.sm2.computedMet && complete },
      projects,
      // The lists are capped; the counts never are.
      projectCount: eligible.length,
      projectsTruncated: eligible.length > projects.length,
      excluded: {
        development: developmentRows,
        developmentCount: development.length,
        developmentTruncated: development.length > developmentRows.length,
        voided: voidedCount,
      },
      // The corpus walk either reached the beginning of the table or it did
      // not; say which rather than implying totality.
      corpusComplete: complete,
      scannedRows: rows.length,
    };
  },
});
