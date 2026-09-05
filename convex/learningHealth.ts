import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { learningHealthReads } from "./lib/learningHealthReads";

const DAY = 86_400_000;
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
    const pedRead = await reads.list("PED samples", ctx.db.query("reportEditDistance").withIndex("by_computedAt", q => q.gte("computedAt", start).lte("computedAt", end)).order("asc"), HEALTH_LIMITS.ped);
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
    for (const generation of generations) {
      if (generation.brainProvenance === undefined) { missingProvenanceGenerations++; continue; }
      if (generation.brainProvenance.length === 0) { emptyProvenanceGenerations++; continue; }
      const passages = bounded(generation.brainProvenance, passageBudget, "source passages");
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
