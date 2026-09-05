/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { HEALTH_LIMITS } from "./learningHealth";
import type { Doc } from "./_generated/dataModel";
const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;
const end = 100 * DAY;
const window = { start: end - 30 * DAY, end };
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const user = await ctx.db.insert("users", { authId: "admin", role: "admin" });
    const project = await ctx.db.insert("projects", { title: "Fixture", shareToken: "fixture", clientName: "Fixture", createdAt: end, status: "draft", createdBy: user, updatedAt: end });
    const generation = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end });
    const report = await ctx.db.insert("reports", { projectId: project, generationId: generation, content: "", version: 2, generatedAt: end, updatedAt: end });
    return { user, project, generation, report };
  });
  return { t, admin: t.withIdentity({ subject: "admin" }), ...ids };
}

describe("learning health persisted metrics", () => {
  test("source cohorts use inclusive generation bounds and retain later current judgments", async () => {
    const { t, admin, project, user } = await setup();
    const cohorts = [
      { entry: "before", startedAt: window.start - 1, score: 1 },
      { entry: "start", startedAt: window.start, score: 2 },
      { entry: "end", startedAt: end, score: 8 },
      { entry: "after", startedAt: end + 1, score: 9 },
      { entry: "ninety-only", startedAt: end - 60 * DAY, score: 5 },
    ];
    await t.run(async ctx => {
      for (const cohort of cohorts) {
        const generationId = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: cohort.startedAt, brainProvenance: [{ entryId: cohort.entry, score: 1 }] });
        const candidateId = await ctx.db.insert("reportCandidates", { projectId: project, generationId, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
        await ctx.db.insert("candidateScores", { projectId: project, generationId, candidateId, optionPosition: 1, model: "m", label: "l", userId: user, score: cohort.score, createdAt: window.start - DAY, updatedAt: end + DAY });
        const reportId = await ctx.db.insert("reports", { projectId: project, generationId, content: "", version: 3, generatedAt: cohort.startedAt, updatedAt: end + DAY });
        await ctx.db.insert("writerReviews", { projectId: project, reportId, reportVersion: 3, userId: user, score: cohort.score * 10, createdAt: end + DAY, updatedAt: end + 2 * DAY });
      }
    });
    const short = await admin.query(api.learningHealth.getHealth, window);
    expect(short.sources.generations).toBe(3); // Includes setup's generation without provenance.
    expect(short.sources.selection).toEqual({ order: "oldest-first", firstLoadedAt: window.start, lastLoadedAt: end, complete: true });
    expect(short.sources.rows).toHaveLength(2);
    for (const cohort of cohorts.filter(row => row.entry === "start" || row.entry === "end")) {
      expect(short.sources.rows.find(row => row.identity === `entry:${cohort.entry}`)).toMatchObject({ generations: 1, passages: 1, candidateSamples: 1, candidateMean: cohort.score, reviewSamples: 1, reviewMean: cohort.score * 10 });
    }
    const long = await admin.query(api.learningHealth.getHealth, { start: end - 90 * DAY, end });
    expect(long.sources.generations).toBe(5);
    expect(long.sources.selection).toEqual({ order: "oldest-first", firstLoadedAt: end - 60 * DAY, lastLoadedAt: end, complete: true });
    expect(long.sources.rows).toHaveLength(4);
    expect(long.sources.rows.map(row => row.identity).sort()).toEqual(["entry:before", "entry:end", "entry:ninety-only", "entry:start"]);
    expect(long.sources.rows.find(row => row.identity === "entry:ninety-only")).toMatchObject({ generations: 1, passages: 1, candidateSamples: 1, candidateMean: 5, reviewSamples: 1, reviewMean: 50 });
  });

  test("shared-source means weight judgment samples across unequal and unjudged generations", async () => {
    const { t, admin, project, user } = await setup();
    await t.run(async ctx => {
      for (const [index, group] of [{ candidates: [2, 4], reviews: [0] }, { candidates: [9], reviews: [60, 90] }, { candidates: [], reviews: [] }].entries()) {
        const generationId = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end - index, brainProvenance: Array.from({ length: index + 1 }, () => ({ entryId: "weighted", score: 1 })) });
        const candidateId = await ctx.db.insert("reportCandidates", { projectId: project, generationId, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
        for (const score of group.candidates) await ctx.db.insert("candidateScores", { projectId: project, generationId, candidateId, optionPosition: 1, model: "m", label: "l", userId: user, score, createdAt: end, updatedAt: end });
        const reportId = await ctx.db.insert("reports", { projectId: project, generationId, content: "", version: 1, generatedAt: end, updatedAt: end });
        for (const score of group.reviews) await ctx.db.insert("writerReviews", { projectId: project, reportId, reportVersion: 1, userId: user, score, createdAt: end, updatedAt: end });
      }
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows).toHaveLength(1);
    expect(result.sources.rows[0]).toMatchObject({ generations: 3, passages: 6, candidateMean: 5, candidateSamples: 3, reviewMean: 50, reviewSamples: 3 });
  });

  test.each([undefined, "", "   "])("later historical title replaces an early unavailable title (%s)", async title => {
    const { t, admin, project, generation } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(generation, { startedAt: window.start, brainProvenance: [{ entryId: "historical", title, score: 1 }] });
      await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end, brainProvenance: [{ entryId: "historical", title: "Recovered source title", score: 1 }] });
    });
    expect((await admin.query(api.learningHealth.getHealth, window)).sources.rows).toEqual([expect.objectContaining({ identity: "entry:historical", title: "Recovered source title", generations: 2, passages: 2 })]);
  });

  test("exact top-level caps are complete when no additional record exists", async () => {
    const { t, admin, project, report } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i < HEALTH_LIMITS.ped; i++) await ctx.db.insert("reportEditDistance", { projectId: project, reportId: report, computedAt: end, ped: 0, revisionNumber: 0, trigger: "milestone" });
      for (let i = 0; i < HEALTH_LIMITS.outcomes; i++) await ctx.db.insert("rerankOutcomes", { operationId: `${i}`, observedAt: end, outcome: "success", callSite: "brain:rerank" });
      for (let i = 1; i < HEALTH_LIMITS.generations; i++) await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end });
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.ped).toMatchObject({ samples: HEALTH_LIMITS.ped, partial: false });
    expect(result.sources).toMatchObject({ generations: HEALTH_LIMITS.generations, partial: false });
    expect(result.rerank).toMatchObject({ attempts: HEALTH_LIMITS.outcomes, partial: false });
    expect(result.coverage).toMatchObject({ partial: false, truncated: [] });
  });

  test("exact per-join and passage caps do not imply truncated evidence", async () => {
    const { t, admin, project, generation, report, user } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(generation, { brainProvenance: Array.from({ length: HEALTH_LIMITS.passages }, () => ({ entryId: "exact", score: 1 })) });
      const candidateId = await ctx.db.insert("reportCandidates", { projectId: project, generationId: generation, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
      for (let i = 0; i < HEALTH_LIMITS.join; i++) {
        await ctx.db.insert("candidateScores", { projectId: project, generationId: generation, candidateId, optionPosition: i, model: "m", label: "l", userId: user, score: 5, createdAt: end, updatedAt: end });
        await ctx.db.insert("writerReviews", { projectId: project, reportId: report, reportVersion: 2, userId: user, score: 50, createdAt: end, updatedAt: end });
        if (i > 0) await ctx.db.insert("reports", { projectId: project, generationId: generation, content: "", version: 1, generatedAt: end, updatedAt: end });
      }
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows[0]).toMatchObject({ passages: HEALTH_LIMITS.passages, candidateSamples: HEALTH_LIMITS.join, reviewSamples: HEALTH_LIMITS.join });
    expect(result.coverage).toMatchObject({ partial: false, truncated: [] });
  });

  test("exact shared candidate report and review budgets stay complete", async () => {
    const { t, admin, project, user } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i < HEALTH_LIMITS.joinBudget / HEALTH_LIMITS.join; i++) {
        const generationId = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end, brainProvenance: [{ entryId: "shared-exact", score: 1 }] });
        const candidateId = await ctx.db.insert("reportCandidates", { projectId: project, generationId, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
        for (let j = 0; j < HEALTH_LIMITS.join; j++) {
          await ctx.db.insert("candidateScores", { projectId: project, generationId, candidateId, optionPosition: j, model: "m", label: "l", userId: user, score: 5, createdAt: end, updatedAt: end });
          const reportId = await ctx.db.insert("reports", { projectId: project, generationId, content: "", version: 1, generatedAt: end, updatedAt: end });
          await ctx.db.insert("writerReviews", { projectId: project, reportId, reportVersion: 1, userId: user, score: 50, createdAt: end, updatedAt: end });
        }
      }
      // Exhausted budgets still probe a later generation and correctly find no extra rows.
      await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end, brainProvenance: [{ entryId: "shared-exact", score: 1 }] });
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows[0]).toMatchObject({ candidateSamples: HEALTH_LIMITS.joinBudget, reviewSamples: HEALTH_LIMITS.joinBudget });
    expect(result.coverage).toMatchObject({ partial: false, truncated: [] });
  });

  test("exhausted judgment budgets distinguish omitted evidence from verified empty joins", async () => {
    const { t, admin, project, user } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i < HEALTH_LIMITS.joinBudget / HEALTH_LIMITS.join; i++) {
        const generationId = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: window.start + i, brainProvenance: [{ entryId: "budget-consumer", score: 1 }] });
        const candidateId = await ctx.db.insert("reportCandidates", { projectId: project, generationId, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
        const reportId = await ctx.db.insert("reports", { projectId: project, generationId, content: "", version: 1, generatedAt: end, updatedAt: end });
        for (let j = 0; j < HEALTH_LIMITS.join; j++) {
          await ctx.db.insert("candidateScores", { projectId: project, generationId, candidateId, optionPosition: j, model: "m", label: "l", userId: user, score: 5, createdAt: end, updatedAt: end });
          await ctx.db.insert("writerReviews", { projectId: project, reportId, reportVersion: 1, userId: user, score: 50, createdAt: end, updatedAt: end });
        }
      }
      for (const entryId of ["judgments-omitted", "judgments-empty"]) {
        const generationId = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end - 1, brainProvenance: [{ entryId, score: 1 }] });
        const reportId = await ctx.db.insert("reports", { projectId: project, generationId, content: "", version: 1, generatedAt: end, updatedAt: end });
        if (entryId === "judgments-omitted") {
          const candidateId = await ctx.db.insert("reportCandidates", { projectId: project, generationId, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
          await ctx.db.insert("candidateScores", { projectId: project, generationId, candidateId, optionPosition: 1, model: "m", label: "l", userId: user, score: 9, createdAt: end, updatedAt: end });
          await ctx.db.insert("writerReviews", { projectId: project, reportId, reportVersion: 1, userId: user, score: 90, createdAt: end, updatedAt: end });
        }
      }
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows.find(row => row.identity === "entry:budget-consumer")).toMatchObject({ candidateSamples: HEALTH_LIMITS.joinBudget, reviewSamples: HEALTH_LIMITS.joinBudget, candidateMean: 5, reviewMean: 50, candidateIncomplete: false, reviewIncomplete: false });
    expect(result.sources.rows.find(row => row.identity === "entry:judgments-omitted")).toMatchObject({ candidateSamples: 0, reviewSamples: 0, candidateMean: null, reviewMean: null, candidateIncomplete: true, reviewIncomplete: true });
    expect(result.sources.rows.find(row => row.identity === "entry:judgments-empty")).toMatchObject({ candidateSamples: 0, reviewSamples: 0, candidateMean: null, reviewMean: null, candidateIncomplete: false, reviewIncomplete: false });
    expect(result.sources.selection.complete).toBe(true);
    expect(result.coverage.truncated).toEqual(["candidate scores", "writer reviews"]);
  });

  test("rejects unauthorized, anonymous role holders, roleless and unmapped callers", async () => {
    const { t } = await setup();
    await expect(t.query(api.learningHealth.getHealth, window)).rejects.toThrow();
    for (const [name, role, isAnonymous] of [["writer", "writer", false], ["manager", "manager", false], ["anonymous", "admin", true], ["roleless", undefined, false]] satisfies [string, Doc<"users">["role"], boolean][]) {
      await t.run(ctx => ctx.db.insert("users", { authId: name, role, isAnonymous }));
      await expect(t.withIdentity({ subject: name }).query(api.learningHealth.getHealth, window)).rejects.toThrow();
    }
    await expect(t.withIdentity({ subject: "missing" }).query(api.learningHealth.getHealth, window)).rejects.toThrow();
  });

  test("validates finite ordered bounded windows", async () => {
    const { admin } = await setup();
    for (const bad of [{ start: NaN, end }, { start: 0, end: Infinity }, { start: -1, end }, { start: end + 1, end }, { start: 0, end }]) {
      await expect(admin.query(api.learningHealth.getHealth, bad)).rejects.toThrow();
    }
  });

  test("preserves PED zero and multiple milestones, daily means, inclusive bounds and missing days", async () => {
    const { t, admin, report, project, generation, user } = await setup();
    await t.run(async ctx => {
      for (const [computedAt, ped, writerUserId] of [[window.start - 1, 0.9, user], [window.start, 0, user], [window.start + 1, 0.4, undefined], [end, 1, user], [end + 1, 0.9, user]] satisfies [number, number, typeof user | undefined][]) {
        await ctx.db.insert("reportEditDistance", { projectId: project, reportId: report, generationId: generation, writerUserId, computedAt, ped, revisionNumber: 1, trigger: "milestone" });
      }
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.window).toEqual(window);
    expect(result.ped).toMatchObject({ samples: 3, reports: 1, missingWriterSamples: 1, daily: [{ day: window.start, mean: 0.2, samples: 2 }, { day: end, mean: 1, samples: 1 }], partial: false });
    expect(result.ped.mean).toBeCloseTo(1.4 / 3);
    const longer = await admin.query(api.learningHealth.getHealth, { start: end - 90 * DAY, end });
    expect(longer.ped.samples).toBe(4);
  });

  test("joins retained candidate scores directly and separates native judgment scales and identities", async () => {
    const { t, admin, project, generation, report, user } = await setup();
    const sourceIds = await t.run(async ctx => {
      const fields = { kind: "pd_pair", status: "approved", title: "Same title", industry: "tech", writerTier: 1, docType: "pd", content: "", ragKey: "key", sourceHash: "hash", createdBy: "admin", createdAt: end } satisfies Omit<Doc<"brainSources">, "_id" | "_creationTime">;
      const sourceA = await ctx.db.insert("brainSources", fields);
      const sourceB = await ctx.db.insert("brainSources", fields);
      const deleted = await ctx.db.insert("brainSources", fields);
      await ctx.db.delete(deleted);
      await ctx.db.patch(generation, { brainProvenance: [
        { sourceId: sourceA, entryId: "a", section: "242", score: 1 }, { sourceId: sourceA, entryId: "a", section: "244", score: 1 },
        { sourceId: sourceB, entryId: "b", score: 1 }, { sourceId: deleted, entryId: "deleted", title: "Same title", score: 1 },
        { sourceId: "malformed", entryId: "bad", title: "Same title", score: 1 },
        { entryId: "historical-a", title: "Same title", score: 1 }, { entryId: "historical-b", title: "Same title", score: 1 }, { entryId: "", score: 1 },
      ] });
      const candidate = await ctx.db.insert("reportCandidates", { projectId: project, generationId: generation, model: "model", label: "label", content: "", agentOutputs: "", createdAt: end });
      for (const score of [2, 8]) await ctx.db.insert("candidateScores", { projectId: project, generationId: generation, candidateId: candidate, optionPosition: 1, model: "model", label: "label", userId: user, score, createdAt: end, updatedAt: end });
      await ctx.db.delete(candidate);
      for (const [score, reportVersion] of [[0, 2], [100, undefined], [99, 1]] satisfies [number, number | undefined][]) await ctx.db.insert("writerReviews", { projectId: project, reportId: report, reportVersion, userId: user, score, createdAt: end, updatedAt: end });
      return { sourceA, sourceB };
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows).toHaveLength(7);
    expect(result.sources.rows.find(row => row.identity === `source:${sourceIds.sourceA}`)).toMatchObject({ passages: 2, generations: 1, candidateMean: 5, candidateSamples: 2, reviewMean: 50, reviewSamples: 2, sourceAvailable: true });
    expect(result.sources.rows.find(row => row.identity === `source:${sourceIds.sourceB}`)?.passages).toBe(1);
    expect(result.sources).toMatchObject({ missingSourceIdPassages: 3, unattributedPassages: 1, excludedVersionReviews: 1, legacyVersionReviews: 1 });
    expect(result.sources.rows.find(row => row.identity === "source:malformed")?.sourceAvailable).toBe(false);
  });

  test("a source ID from another table never supplies unrelated metadata", async () => {
    const { t, admin, project, generation } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(project, { title: "Unrelated project metadata" });
      await ctx.db.patch(generation, { brainProvenance: [{ sourceId: project, entryId: "wrong-table", title: "Recorded historical title", score: 1 }] });
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows).toEqual([expect.objectContaining({
      identity: `source:${project}`, title: "Recorded historical title", sourceAvailable: false, sourceMetadataIncomplete: false,
    })]);
    expect(JSON.stringify(result)).not.toContain("Unrelated project metadata");
  });

  test("capped candidate means include oldest-created scores and exclude newer scores", async () => {
    const { t, admin, project, generation, user } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(generation, { brainProvenance: [{ entryId: "ordered", score: 1 }] });
      const candidate = await ctx.db.insert("reportCandidates", { projectId: project, generationId: generation, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
      for (let index = 0; index <= HEALTH_LIMITS.join; index++) {
        // Stored creation order, not editable createdAt, defines the selected cohort.
        await ctx.db.insert("candidateScores", { projectId: project, generationId: generation, candidateId: candidate, optionPosition: index, model: "m", label: "l", userId: user, score: index === HEALTH_LIMITS.join ? 10 : 1, createdAt: end - index, updatedAt: end });
      }
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows[0]).toMatchObject({ candidateMean: 1, candidateSamples: HEALTH_LIMITS.join, candidateIncomplete: true });
    expect(result.coverage.truncated).toContain("candidate scores");
  });

  test("deduplicates source use per generation while counting repeated use across generations", async () => {
    const { t, admin, project, generation } = await setup();
    const provenance = [{ entryId: "stable", score: 1 }, { entryId: "stable", section: "244", score: 1 }];
    await t.run(async ctx => {
      await ctx.db.patch(generation, { brainProvenance: provenance });
      await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end, brainProvenance: provenance });
    });
    expect((await admin.query(api.learningHealth.getHealth, window)).sources.rows[0]).toMatchObject({ generations: 2, passages: 4, candidateMean: null, reviewMean: null, candidateSamples: 0, reviewSamples: 0 });
  });

  test("missing provenance and missing linked reports never establish no historical source use", async () => {
    const { t, admin, project } = await setup();
    await t.run(async ctx => {
      await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end, brainProvenance: [] });
      await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end, brainProvenance: [{ entryId: "old", score: 1 }] });
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources).toMatchObject({ generations: 3, missingProvenanceGenerations: 1, emptyProvenanceGenerations: 1, missingReportGenerations: 1 });
    expect(result.ped.mean).toBeNull();
    expect(result.rerank.rate).toBeNull();
  });

  test("records idempotently, calculates 8 success/2 fallback/5 skip, excludes search failures and bounds", async () => {
    const { t, admin } = await setup();
    let id = 0;
    for (const [outcome, count] of [["success", 8], ["fallback", 2], ["skip", 5], ["search_error", 3]] satisfies ["success" | "fallback" | "skip" | "search_error", number][]) {
      for (let i = 0; i < count; i++) await t.mutation(internal.learningHealth.recordRerankOutcome, { operationId: `${id++}`, observedAt: end, callSite: "brain:rerank", outcome });
    }
    await t.mutation(internal.learningHealth.recordRerankOutcome, { operationId: "0", observedAt: end, callSite: "brain:rerank", outcome: "fallback" });
    await t.mutation(internal.learningHealth.recordRerankOutcome, { operationId: "old", observedAt: window.start - 1, callSite: "brain:rerank", outcome: "fallback" });
    await t.mutation(internal.learningHealth.recordRerankOutcome, { operationId: "future", observedAt: end + 1, callSite: "brain:rerank", outcome: "fallback" });
    expect((await admin.query(api.learningHealth.getHealth, window)).rerank).toMatchObject({ successes: 8, fallbacks: 2, attempts: 10, rate: 0.2, skips: 5, searchErrors: 3, observations: 18, earliestRecordedAt: window.start - 1, firstInWindowAt: end, lastInWindowAt: end });
  });

  test("historical billing alone never becomes operational coverage", async () => {
    const { t, admin } = await setup();
    await t.run(ctx => ctx.db.insert("aiUsage", { callSite: "brain:rerank", model: "reranker", inputTokens: 10, outputTokens: 0, costUsd: 0.01, createdAt: end }));
    expect((await admin.query(api.learningHealth.getHealth, window)).rerank).toMatchObject({ attempts: 0, rate: null, observations: 0, earliestRecordedAt: null });
  });

  test("shared join budgets cap total work across generations and report associations", async () => {
    const { t, admin, project, user } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i < HEALTH_LIMITS.joinBudget / HEALTH_LIMITS.join + 1; i++) {
        const generationId = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end, brainProvenance: [{ entryId: "shared", score: 1 }] });
        const candidateId = await ctx.db.insert("reportCandidates", { projectId: project, generationId, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
        for (let j = 0; j < HEALTH_LIMITS.join; j++) {
          await ctx.db.insert("candidateScores", { projectId: project, generationId, candidateId, optionPosition: j, model: "m", label: "l", userId: user, score: 5, createdAt: end, updatedAt: end });
          const reportId = await ctx.db.insert("reports", { projectId: project, generationId, content: "", version: 1, generatedAt: end, updatedAt: end });
          await ctx.db.insert("writerReviews", { projectId: project, reportId, userId: user, reportVersion: 1, score: 50, createdAt: end, updatedAt: end });
        }
      }
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows[0]).toMatchObject({ candidateSamples: HEALTH_LIMITS.joinBudget, reviewSamples: HEALTH_LIMITS.joinBudget });
    expect(result.coverage.truncated).toEqual(expect.arrayContaining(["candidate scores", "linked reports"]));
  });

  test("the writer-review budget is shared across reports without a silent cap", async () => {
    const { t, admin, project, user } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i <= HEALTH_LIMITS.joinBudget / HEALTH_LIMITS.join; i++) {
        const generationId = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end, brainProvenance: [{ entryId: "shared", score: 1 }] });
        const reportId = await ctx.db.insert("reports", { projectId: project, generationId, content: "", version: 1, generatedAt: end, updatedAt: end });
        for (let j = 0; j < HEALTH_LIMITS.join; j++) await ctx.db.insert("writerReviews", { projectId: project, reportId, userId: user, reportVersion: 1, score: 50, createdAt: end, updatedAt: end });
      }
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.sources.rows[0].reviewSamples).toBe(HEALTH_LIMITS.joinBudget);
    expect(result.coverage.truncated).toEqual(["writer reviews"]);
  });

  test("zero attempts stays unavailable; measured successes produce genuine zero fallback rate", async () => {
    const { t, admin } = await setup();
    expect((await admin.query(api.learningHealth.getHealth, window)).rerank).toMatchObject({ attempts: 0, rate: null, earliestRecordedAt: null });
    await t.mutation(internal.learningHealth.recordRerankOutcome, { operationId: "skip", observedAt: end, callSite: "brain:rerank", outcome: "skip" });
    expect((await admin.query(api.learningHealth.getHealth, window)).rerank.rate).toBeNull();
    await t.mutation(internal.learningHealth.recordRerankOutcome, { operationId: "success", observedAt: end, callSite: "brain:rerank", outcome: "success" });
    expect((await admin.query(api.learningHealth.getHealth, window)).rerank).toMatchObject({ rate: 0, attempts: 1 });
  });

  test("caps all top-level populations with honest partial flags", async () => {
    const { t, admin, project, report } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i <= HEALTH_LIMITS.ped; i++) await ctx.db.insert("reportEditDistance", { projectId: project, reportId: report, computedAt: end, ped: 0, revisionNumber: 0, trigger: "milestone" });
      for (let i = 0; i <= HEALTH_LIMITS.outcomes; i++) await ctx.db.insert("rerankOutcomes", { operationId: `${i}`, observedAt: end, outcome: "success", callSite: "brain:rerank" });
      for (let i = 0; i < HEALTH_LIMITS.generations; i++) await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: end });
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.ped).toMatchObject({ partial: true, samples: HEALTH_LIMITS.ped });
    expect(result.sources).toMatchObject({ partial: true, generations: HEALTH_LIMITS.generations });
    expect(result.rerank).toMatchObject({ partial: true, attempts: HEALTH_LIMITS.outcomes });
    expect(result.coverage.truncated).toEqual(expect.arrayContaining(["PED samples", "generations", "rerank outcomes"]));
  });

  test("detects exact cap versus cap+1 on report, candidate and writer-review joins and provenance", async () => {
    const { t, admin, project, generation, report, user } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(generation, { brainProvenance: Array.from({ length: HEALTH_LIMITS.passages + 1 }, () => ({ entryId: "repeated", score: 1 })) });
      const candidate = await ctx.db.insert("reportCandidates", { projectId: project, generationId: generation, model: "m", label: "l", content: "", agentOutputs: "", createdAt: end });
      for (let i = 0; i <= HEALTH_LIMITS.join; i++) {
        await ctx.db.insert("candidateScores", { projectId: project, generationId: generation, candidateId: candidate, optionPosition: i, model: "m", label: "l", userId: user, score: 5, createdAt: end, updatedAt: end });
        await ctx.db.insert("writerReviews", { projectId: project, reportId: report, userId: user, score: 50, createdAt: end, updatedAt: end });
        await ctx.db.insert("reports", { projectId: project, generationId: generation, content: "", version: 1, generatedAt: end, updatedAt: end });
      }
    });
    const result = await admin.query(api.learningHealth.getHealth, window);
    expect(result.coverage.truncated).toEqual(expect.arrayContaining(["source passages", "candidate scores", "linked reports", "writer reviews"]));
    expect(result.sources.rows[0]).toMatchObject({ generations: 1, passages: HEALTH_LIMITS.passages, candidateSamples: HEALTH_LIMITS.join, reviewSamples: HEALTH_LIMITS.join });
  });
});
