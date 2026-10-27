import { isEvaluationProject } from "./lib/evaluationProjects";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { learningHealthReads } from "./lib/learningHealthReads";
import { readSeedLearningHealth } from "./lib/seedLearningHealth";
import { outputArtifact, outputsInArtifacts } from "./lib/generationOutputs";

const DAY = 86_400_000;
/** The readings Learning health's edit-size chart averages (E3 review). */
const MILESTONE_TRIGGERS = ["candidate_selection", "milestone", "client_publish"] as const;
export const HEALTH_LIMITS = { ped: 2000, generations: 200, outcomes: 2000, join: 20, joinBudget: 1000, passages: 2000 };

export const recordRerankOutcome = internalMutation({
  args: {
    operationId: v.string(), observedAt: v.number(), callSite: v.string(),
    outcome: v.union(v.literal("success"), v.literal("fallback"), v.literal("skip"), v.literal("search_error")),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.observedAt) || args.observedAt < 0 || !args.operationId || args.operationId.length > 128 || !args.callSite || args.callSite.length > 200) {
      domainError("INVALID_INPUT", "Invalid operational observation");
    }
    const existing = await ctx.db.query("rerankOutcomes").withIndex("by_operationId", q => q.eq("operationId", args.operationId)).unique();
    if (!existing) await ctx.db.insert("rerankOutcomes", args);
    return null;
  },
});

type SourceRow = {
  identity: string; title: string; identityKind: "source" | "entry" | "unattributed";
  sourceAvailable: boolean; sourceMetadataIncomplete: boolean; generations: number; passages: number;
  candidateIncomplete: boolean; reviewIncomplete: boolean;
  candidateMean: number | null; candidateSamples: number; reviewMean: number | null; reviewSamples: number;
};

/** Observed populations only. Every cap probes one extra row and discloses truncation. */
export const getHealth = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, { start, end }) => {
    await requireRole(ctx, ["admin"]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end - start > 90 * DAY || end > 8.64e15) {
      domainError("INVALID_INPUT", "Choose finite ordered bounds spanning at most 90 days");
    }
    const truncated = new Set<string>();
    function bounded<T>(rows: T[], cap: number, population: string) {
      if (rows.length > cap) truncated.add(population);
      return rows.slice(0, cap);
    }
    const reads = learningHealthReads(truncated);
    // Small operational populations first; all reads share the same byte budget.
    const outcomeRead = await reads.list("rerank outcomes", ctx.db.query("rerankOutcomes").withIndex("by_observedAt", q => q.gte("observedAt", start).lte("observedAt", end)).order("asc"), HEALTH_LIMITS.outcomes);
    const earliestRead = await reads.one("earliest rerank observation", () => ctx.db.query("rerankOutcomes").withIndex("by_observedAt").first());
    const earliest = earliestRead.kind === "loaded" ? earliestRead.value : null;
    // E3 review: the chart reads the three milestone readings only; chat
    // applies and editing bursts are shown by version (getEditSizeByVersion).
    const pedRows: Doc<"reportEditDistance">[] = [];
    let pedComplete = true;
    for (const trigger of MILESTONE_TRIGGERS) {
      const read = await reads.list("PED samples", ctx.db.query("reportEditDistance").withIndex("by_trigger_and_computedAt", q => q.eq("trigger", trigger).gte("computedAt", start).lte("computedAt", end)).order("asc"), HEALTH_LIMITS.ped);
      pedRows.push(...read.rows);
      pedComplete &&= read.complete;
    }
    pedRows.sort((a, b) => a.computedAt - b.computedAt || a._creationTime - b._creationTime);
    if (pedRows.length > HEALTH_LIMITS.ped) {
      truncated.add("PED samples");
      pedComplete = false;
    }
    const pedRead = { rows: pedRows.slice(0, HEALTH_LIMITS.ped), complete: pedComplete };
    const generationRead = await reads.list("generations", ctx.db.query("generations").withIndex("by_startedAt", q => q.gte("startedAt", start).lte("startedAt", end)).order("asc"), HEALTH_LIMITS.generations);
    const samples = pedRead.rows;
    const generations = generationRead.rows;
    const outcomes = outcomeRead.rows;
    function selection<T>(rows: T[], complete: boolean, timestamp: (row: T) => number) {
      return { order: "oldest-first" as const, firstLoadedAt: rows.length ? timestamp(rows[0]) : null,
        lastLoadedAt: rows.length ? timestamp(rows[rows.length - 1]) : null, complete };
    }
    const daily = new Map<number, { day: number; mean: number; samples: number }>();
    for (const sample of samples) {
      const day = Math.floor(sample.computedAt / DAY) * DAY;
      const bucket = daily.get(day) ?? { day, mean: 0, samples: 0 };
      bucket.mean += sample.ped;
      bucket.samples++;
      daily.set(day, bucket);
    }
    const sourceRows = new Map<string, SourceRow>();
    const namedSources = new Set<string>();
    let missingProvenanceGenerations = 0, emptyProvenanceGenerations = 0, missingSourceIdPassages = 0, unattributedPassages = 0;
    let missingReportGenerations = 0, excludedVersionReviews = 0, legacyVersionReviews = 0;
    let passageBudget = HEALTH_LIMITS.passages;
    const budgets = { candidates: HEALTH_LIMITS.joinBudget, reports: HEALTH_LIMITS.joinBudget, reviews: HEALTH_LIMITS.joinBudget };
    // E3 re-check: release suite evaluation projects are not real work.
    const evaluationProjects = new Map<Id<"projects">, boolean>();
    for (const generation of generations) {
      if (!evaluationProjects.has(generation.projectId)) {
        const projectRead = await reads.one("project joins", () => ctx.db.get(generation.projectId));
        evaluationProjects.set(generation.projectId, projectRead.kind === "loaded" && isEvaluationProject(projectRead.value));
      }
      if (evaluationProjects.get(generation.projectId)) continue;
      // Since 2026-09-25 a generation's provenance lives in a
      // generationArtifacts row once outputsInArtifactsAt is set; that read
      // shares the byte budget. Older rows keep it on the row.
      let brainProvenance = generation.brainProvenance;
      if (outputsInArtifacts(generation)) {
        const provenanceRead = await reads.one("brain provenance", () =>
          outputArtifact(ctx, generation._id, "brain_provenance"));
        if (provenanceRead.kind === "not-loaded") continue;
        brainProvenance = provenanceRead.value?.brainProvenance;
      }
      if (brainProvenance === undefined) { missingProvenanceGenerations++; continue; }
      if (brainProvenance.length === 0) { emptyProvenanceGenerations++; continue; }
      const passages = bounded(brainProvenance, passageBudget, "source passages");
      passageBudget -= passages.length;
      if (!passages.length) continue;
      const used = new Set<string>();
      for (const [position, passage] of passages.entries()) {
        const rawSource = passage.sourceId?.trim();
        const entry = passage.entryId.trim();
        if (!rawSource) missingSourceIdPassages++;
        if (!rawSource && !entry) unattributedPassages++;
        const identityKind = rawSource ? "source" : entry ? "entry" : "unattributed";
        // Entry IDs preserve historical identity; titles never establish identity.
        const identity = rawSource ? `source:${rawSource}` : entry ? `entry:${entry}` : `unattributed:${generation._id}:${position}`;
        let row = sourceRows.get(identity);
        if (!row) {
          const id = rawSource ? ctx.db.normalizeId("brainSources", rawSource) : null;
          const lookup = id ? await reads.one("source metadata", () => ctx.db.get("brainSources", id)) : null;
          const source = lookup?.kind === "loaded" ? lookup.value : null;
          const title = source?.title.trim() || passage.title?.trim();
          if (title) namedSources.add(identity);
          row = { identity, identityKind, title: title || (identityKind === "unattributed" ? "Unattributed passage" : "Historical source"), sourceAvailable: source !== null,
            sourceMetadataIncomplete: lookup?.kind === "not-loaded", candidateIncomplete: false, reviewIncomplete: false,
            generations: 0, passages: 0, candidateMean: null, candidateSamples: 0, reviewMean: null, reviewSamples: 0 };
          sourceRows.set(identity, row);
        }
        if (!namedSources.has(identity) && passage.title?.trim()) {
          row.title = passage.title.trim();
          namedSources.add(identity);
        }
        row.passages++;
        used.add(identity);
      }
      const candidateCap = Math.min(HEALTH_LIMITS.join, budgets.candidates);
      const reportCap = Math.min(HEALTH_LIMITS.join, budgets.reports);
      const candidateRead = await reads.list("candidate scores", ctx.db.query("candidateScores").withIndex("by_generationId", q => q.eq("generationId", generation._id)), candidateCap);
      const reportRead = await reads.list("linked reports", ctx.db.query("reports").withIndex("by_generationId", q => q.eq("generationId", generation._id)), reportCap);
      const candidates = candidateRead.rows;
      const reports = reportRead.rows;
      budgets.candidates -= candidates.length;
      budgets.reports -= reports.length;
      if (!reports.length && reportRead.complete) missingReportGenerations++;
      const reviews: number[] = [];
      let reviewIncomplete = !reportRead.complete;
      for (const report of reports) {
        const cap = Math.min(HEALTH_LIMITS.join, budgets.reviews);
        const reviewRead = await reads.list("writer reviews", ctx.db.query("writerReviews").withIndex("by_reportId", q => q.eq("reportId", report._id)), cap);
        budgets.reviews -= reviewRead.rows.length;
        reviewIncomplete ||= !reviewRead.complete;
        for (const review of reviewRead.rows) {
          if (review.reportVersion !== undefined && review.reportVersion !== report.version) { excludedVersionReviews++; continue; }
          if (review.reportVersion === undefined) legacyVersionReviews++;
          reviews.push(review.score);
        }
      }
      for (const identity of used) {
        const row = sourceRows.get(identity);
        if (!row) continue;
        row.generations++;
        row.candidateIncomplete ||= !candidateRead.complete;
        row.reviewIncomplete ||= reviewIncomplete;
        row.candidateMean = (row.candidateMean ?? 0) + candidates.reduce((sum, c) => sum + c.score, 0);
        row.candidateSamples += candidates.length;
        row.reviewMean = (row.reviewMean ?? 0) + reviews.reduce((sum, score) => sum + score, 0);
        row.reviewSamples += reviews.length;
      }
    }
    const successes = outcomes.filter(row => row.outcome === "success").length;
    const fallbacks = outcomes.filter(row => row.outcome === "fallback").length;
    const attempts = successes + fallbacks;
    const sourcePartial = ["generations", "source passages", "source metadata", "candidate scores", "linked reports", "writer reviews"].some(name => truncated.has(name));
    // Omitted generations/passages can carry additional judgments for any source.
    const sourceCohortIncomplete = !generationRead.complete || truncated.has("source passages");
    return {
      window: { start, end },
      ped: { selection: selection(samples, pedRead.complete, row => row.computedAt), daily: [...daily.values()].map(bucket => ({ ...bucket, mean: bucket.mean / bucket.samples })).sort((a, b) => a.day - b.day),
        samples: samples.length, reports: new Set(samples.map(row => row.reportId)).size,
        mean: samples.length ? samples.reduce((sum, row) => sum + row.ped, 0) / samples.length : null,
        missingWriterSamples: samples.filter(row => !row.writerUserId).length, partial: truncated.has("PED samples") },
      sources: { selection: selection(generations, generationRead.complete, row => row.startedAt), rows: [...sourceRows.values()].map(row => ({ ...row,
          candidateIncomplete: row.candidateIncomplete || sourceCohortIncomplete, reviewIncomplete: row.reviewIncomplete || sourceCohortIncomplete,
          candidateMean: row.candidateSamples ? (row.candidateMean ?? 0) / row.candidateSamples : null,
          reviewMean: row.reviewSamples ? (row.reviewMean ?? 0) / row.reviewSamples : null,
        })).sort((a, b) => b.generations - a.generations || a.identity.localeCompare(b.identity)),
        generations: generations.length, missingProvenanceGenerations, emptyProvenanceGenerations, missingSourceIdPassages, unattributedPassages,
        missingReportGenerations, excludedVersionReviews, legacyVersionReviews, partial: sourcePartial },
      rerank: { selection: selection(outcomes, outcomeRead.complete, row => row.observedAt), successes, fallbacks, attempts, rate: attempts ? fallbacks / attempts : null,
        skips: outcomes.filter(row => row.outcome === "skip").length, searchErrors: outcomes.filter(row => row.outcome === "search_error").length,
        observations: outcomes.length, earliestRecordedAtIncomplete: earliestRead.kind === "not-loaded", earliestRecordedAt: earliest?.observedAt ?? null,
        firstInWindowAt: outcomes.length ? outcomes[0].observedAt : null, lastInWindowAt: outcomes.length ? outcomes[outcomes.length - 1].observedAt : null, partial: truncated.has("rerank outcomes") },
      coverage: { partial: truncated.size > 0, truncated: [...truncated], limits: HEALTH_LIMITS, byteBudget: reads.snapshot(), recording: "best-effort" },
    };
  },
});

/** Caps of the edit size by version view; each probes one extra row. */
export const VERSION_LIMITS = { readings: 4000, generations: 500, lessonSets: 200 };

type LessonSetView = { id: Id<"learningDigests">; kind: "qa_calibration" | "draft_style" | null; createdAt: number | null };
type SizeGroup = { latest: Map<string, Doc<"reportEditDistance">>; readings: number };

function addReading(groups: Map<string, SizeGroup>, key: string, row: Doc<"reportEditDistance">) {
  const group = groups.get(key) ?? { latest: new Map(), readings: 0 };
  group.readings++;
  // Rows load newest first, so the first one per report is its latest.
  if (!group.latest.has(row.reportId)) group.latest.set(row.reportId, row);
  groups.set(key, group);
}

function sizeSummary(group: SizeGroup) {
  const latest = [...group.latest.values()];
  return {
    mean: latest.length ? latest.reduce((sum, row) => sum + row.ped, 0) / latest.length : null,
    reports: latest.length,
    readings: group.readings,
  };
}

/**
 * 2026-10-27 (Phase E, E3): edit size by version. One reading per report
 * per version, its latest in the window, averaged. A draft's version is its
 * prompt version, the lesson sets it used and whether saved preferences were
 * used, all read through the reading's generation; nothing is copied onto
 * the reading. Chat applies are also grouped by the style lesson set their
 * chat turn used. Evaluation projects record no readings (E3).
 */
export const getEditSizeByVersion = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, { start, end }) => {
    await requireRole(ctx, ["admin"]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end - start > 90 * DAY || end > 8.64e15) {
      domainError("INVALID_INPUT", "Choose finite ordered bounds spanning at most 90 days");
    }
    // Review: every read shares the page's byte budget, so a window of
    // large drafts gives partial results, never a failed query.
    const truncated = new Set<string>();
    const reads = learningHealthReads(truncated);
    const readingRead = await reads.list(
      "edit size readings",
      ctx.db
        .query("reportEditDistance")
        .withIndex("by_computedAt", (q) => q.gte("computedAt", start).lte("computedAt", end))
        .order("desc"),
      VERSION_LIMITS.readings,
    );
    const loaded = readingRead.rows;

    // A draft not read (past the cap or the budget) is "not-loaded".
    const generations = new Map<Id<"generations">, Doc<"generations"> | null | "not-loaded">();
    let draftsRead = 0;
    for (const row of loaded) {
      if (!row.generationId || generations.has(row.generationId)) continue;
      if (draftsRead >= VERSION_LIMITS.generations) {
        truncated.add("drafts");
        generations.set(row.generationId, "not-loaded");
        continue;
      }
      draftsRead += 1;
      const read = await reads.one("drafts", () => ctx.db.get(row.generationId!));
      generations.set(row.generationId, read.kind === "loaded" ? read.value : "not-loaded");
    }
    const lessonSets = new Map<Id<"learningDigests">, LessonSetView>();
    async function lessonSet(id: Id<"learningDigests">): Promise<LessonSetView> {
      const known = lessonSets.get(id);
      if (known) return known;
      if (lessonSets.size >= VERSION_LIMITS.lessonSets) {
        truncated.add("lesson sets");
        return { id, kind: null, createdAt: null };
      }
      const read = await reads.one("lesson sets", () => ctx.db.get(id));
      const digest = read.kind === "loaded" ? read.value : null;
      const view = { id, kind: digest?.kind ?? null, createdAt: digest?.createdAt ?? null };
      lessonSets.set(id, view);
      return view;
    }

    // `recorded`: the reading names a draft (false only for readings with no
    // generation, shown as "No draft recorded").
    type DraftVersion = { promptVersion: string | null; lessonSetIds: Id<"learningDigests">[]; savedPreferencesUsed: boolean; known: boolean; recorded: boolean };
    const draftVersions = new Map<string, DraftVersion>();
    const draftGroups = new Map<string, SizeGroup>();
    const chatGroups = new Map<string, SizeGroup>();
    let notLoaded = 0;
    for (const row of loaded) {
      let version: DraftVersion;
      if (!row.generationId) {
        version = { promptVersion: null, lessonSetIds: [], savedPreferencesUsed: false, known: false, recorded: false };
      } else if (!generations.has(row.generationId) || generations.get(row.generationId) === "not-loaded") {
        notLoaded++;
        continue;
      } else {
        const generation = (generations.get(row.generationId) as Doc<"generations"> | null | undefined) ?? null;
        version = generation
          ? {
              promptVersion: generation.promptVersion ?? null,
              lessonSetIds: [...(generation.learningDigestIds ?? [])].sort(),
              savedPreferencesUsed: (generation.writerSettings?.savedPreferences?.count ?? 0) > 0,
              known: true,
              recorded: true,
            }
          : { promptVersion: null, lessonSetIds: [], savedPreferencesUsed: false, known: false, recorded: true };
      }
      const key = JSON.stringify(version);
      draftVersions.set(key, version);
      addReading(draftGroups, key, row);
      if (row.trigger === "chat_apply") addReading(chatGroups, row.learningDigestId ?? "", row);
    }

    const byVersion = [];
    for (const [key, group] of draftGroups) {
      const version = draftVersions.get(key)!;
      byVersion.push({
        promptVersion: version.promptVersion,
        lessonSets: await Promise.all(version.lessonSetIds.map(lessonSet)),
        savedPreferencesUsed: version.savedPreferencesUsed,
        known: version.known,
        recorded: version.recorded,
        ...sizeSummary(group),
      });
    }
    const byChatLessonSet = [];
    for (const [key, group] of chatGroups) {
      byChatLessonSet.push({
        lessonSet: key ? await lessonSet(key as Id<"learningDigests">) : null,
        ...sizeSummary(group),
      });
    }
    byVersion.sort((a, b) => b.reports - a.reports || (b.promptVersion ?? "").localeCompare(a.promptVersion ?? ""));
    byChatLessonSet.sort((a, b) => b.reports - a.reports);
    return {
      window: { start, end },
      readings: loaded.length,
      byVersion,
      byChatLessonSet,
      notLoaded,
      partial: truncated.size > 0,
      truncated: [...truncated],
      limits: VERSION_LIMITS,
    };
  },
});

/**
 * AD-39 seed scorecard. NFR-1 cohort: "From the dispatch of an attempt to its
 * validated result being available (completion event; failures included,
 * prefetch included): at most 12 s at the median and 30 s at the 95th
 * percentile for a project within the standard context budget. A separate
 * foreground figure, dispatch to first render for attempts whose Subsection
 * stayed open, is reported but not thresholded; first-view events remain the
 * exposure measure. Prose Generation, from Sign-off to report created, is the
 * normative bound: within the existing single-mode drafting time (request to
 * report created, same model, same project, retries included) plus the
 * consistency pass, measured as a median over the release cohort."
 */
export const getSeedHealth = query({
  args: {
    start: v.number(),
    end: v.number(),
    gatedWorkflow: v.literal("seeds"),
  },
  handler: async (ctx, { start, end }) => {
    await requireRole(ctx, ["admin"]);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end - start > 90 * DAY ||
      end > 8.64e15
    ) {
      domainError(
        "INVALID_INPUT",
        "Choose finite ordered half-open bounds spanning at most 90 firm-time days",
      );
    }
    return await readSeedLearningHealth(ctx, { start, end });
  },
});
