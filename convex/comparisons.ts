/**
 * AD-29 (story 6, CAP-16): Paired Comparison records and the SM-1 / SM-2
 * readout.
 *
 * Every judgement field on a `comparisons` row is entered by a human judge.
 * The server resolves only the revision pin (`projectId`, `reportId`,
 * `revisionNumber`, `contentHash`, `generationId`), `recordedAt`, and
 * `draftTextMatches`. No code path in this file reads `chatProposalItems`,
 * `complianceNotes`, `generations.qa`, `writerReviews`, or any other model
 * output: Deviation and Corrections-to-acceptable counts are the judge's
 * manual counts (measurement-protocol.md, "LLM self-scores are never an
 * outcome").
 *
 * A recorded row is never patched or deleted. The only correction path is a
 * new row whose `voidsComparisonId` names the row it replaces, and at most one
 * live (non-voided) row exists per project — CAP-16 records a Paired
 * Comparison *per project*, so a second live row would force a tie-break rule
 * inside the metric query. Writes and reads both require an Admin: AD-29's
 * interim answer to Q18.
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
import { MODEL, modelById } from "../shared/generationModels";

/** A pasted strip longer than this is a paste accident, not a PD. */
const MAX_DRAFT_TEXT_LENGTH = 120_000;
/** Bounded reads — never `.collect()`, never `.filter` (Convex guideline). */
const PROJECT_COMPARISON_LIMIT = 200;
const RECORD_TARGET_LIMIT = 200;
const METRIC_ROW_LIMIT = 500;
/** Free-text provenance fields (model ids, caveat, counting method). */
const MAX_NOTE_LENGTH = 2_000;

type Ctx = QueryCtx | MutationCtx;
type Comparison = Doc<"comparisons">;

/** A row is voided when some OTHER row in the set names it. No row is patched. */
function voidedIds(rows: readonly Comparison[]): Set<string> {
  const voided = new Set<string>();
  for (const row of rows) {
    if (row.voidsComparisonId) voided.add(String(row.voidsComparisonId));
  }
  return voided;
}

async function projectComparisons(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<Comparison[]> {
  return await ctx.db
    .query("comparisons")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .order("desc")
    .take(PROJECT_COMPARISON_LIMIT);
}

function liveComparison(rows: readonly Comparison[]): Comparison | null {
  const voided = voidedIds(rows);
  return rows.find((row) => !voided.has(String(row._id))) ?? null;
}

function requireCount(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) {
    domainError("INVALID_INPUT", `${field} must be a non-negative whole number`);
  }
}

function requireDraftText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    domainError("INVALID_INPUT", `${field} is empty`);
  }
  if (value.length > MAX_DRAFT_TEXT_LENGTH) {
    domainError(
      "INVALID_INPUT",
      `${field} exceeds ${MAX_DRAFT_TEXT_LENGTH.toLocaleString("en-CA")} characters`
    );
  }
  return trimmed;
}

function requireNote(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) domainError("INVALID_INPUT", `${field} is required`);
  if (trimmed.length > MAX_NOTE_LENGTH) {
    domainError("INVALID_INPUT", `${field} is too long`);
  }
  return trimmed;
}

/**
 * The Banhall-side model the report was actually generated with, as a label —
 * the default offered for the judge's `banhallModel` field. Resolved from the
 * generation's own selection row first, else its `singleModelId`, else the
 * registry default. `null` when the report has no generation (hand-written).
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
  const modelId = generation?.singleModelId ?? MODEL;
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

    const existing = await projectComparisons(ctx, report.projectId);
    const live = liveComparison(existing);
    if (args.voidsComparisonId) {
      const voidedId = String(args.voidsComparisonId);
      const target = existing.find((row) => String(row._id) === voidedId);
      if (!target) {
        domainError(
          "INVALID_INPUT",
          "The comparison being replaced does not belong to this project"
        );
      }
      if (!live || String(live._id) !== voidedId) {
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
    // a blinded reformat still matches and a wrong draft still records.
    const contentHash = report.contentHash || (await sha256(report.content));
    const draftTextMatches =
      (await sha256(comparisonPlainText(report.content))) ===
      (await sha256(comparisonPlainText(banhallDraftText)));

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

/** The project picker on /admin/comparisons. */
export const listRecordTargets = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const projects = await ctx.db
      .query("projects")
      .order("desc")
      .take(RECORD_TARGET_LIMIT);
    const targets = [];
    for (const project of projects) {
      const rows = await projectComparisons(ctx, project._id);
      targets.push({
        projectId: project._id,
        label: `${project.clientName} — ${project.title}`,
        hasLiveComparison: liveComparison(rows) !== null,
      });
    }
    return targets;
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
    const rows = await projectComparisons(ctx, args.projectId);
    const live = liveComparison(rows);
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

/** Every record on a project, newest first, with liveness derived in memory. */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const rows = await projectComparisons(ctx, args.projectId);
    const voided = voidedIds(rows);
    const judgeLabels = new Map<string, string>();
    for (const row of rows) {
      const key = String(row.judgeUserId);
      if (judgeLabels.has(key)) continue;
      const judge = await ctx.db.get(row.judgeUserId);
      judgeLabels.set(key, judge ? userDisplayLabel(judge) : "Unknown judge");
    }
    return rows.map((row) => ({
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
    }));
  },
});

/**
 * SM-1 / SM-2, computed only from judge-entered counts on live, non-development
 * `comparisons` rows. `computedMet` covers the countable clauses only;
 * `manualConditions` names the clauses no query can check, and each eligible
 * project's `financialSummaries` figures are attached where a financial upload
 * ran so the "100–200-hour" clause can be settled by a human.
 */
export const successMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const rows = await ctx.db
      .query("comparisons")
      .withIndex("by_recordedAt")
      .order("desc")
      .take(METRIC_ROW_LIMIT);
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

    const projectLabels = new Map<string, string>();
    const labelFor = async (projectId: Id<"projects">) => {
      const key = String(projectId);
      const cached = projectLabels.get(key);
      if (cached !== undefined) return cached;
      const project = await ctx.db.get(projectId);
      const label = project
        ? `${project.clientName} — ${project.title}`
        : "Deleted project";
      projectLabels.set(key, label);
      return label;
    };

    const projects = [];
    for (const row of eligible) {
      // The "≥ 1 small (100–200-hour)" clause is reported, never computed: no
      // project row carries claim hours, and `financialSummaries` exists only
      // where a financial upload ran.
      const financial = await ctx.db
        .query("financialSummaries")
        .withIndex("by_projectId", (q) => q.eq("projectId", row.projectId))
        .first();
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
    for (const row of development) {
      developmentRows.push({
        comparisonId: row._id,
        projectId: row.projectId,
        label: await labelFor(row.projectId),
        recordedAt: row.recordedAt,
        preference: row.preference,
      });
    }

    return {
      sm1: summary.sm1,
      sm2: summary.sm2,
      projects,
      excluded: { development: developmentRows, voided: voidedCount },
      // The metric reads a bounded window; say so rather than imply totality.
      scannedRows: rows.length,
      rowLimit: METRIC_ROW_LIMIT,
    };
  },
});
