/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { HEALTH_DOCUMENT_HEADROOM, HEALTH_READ_BYTES } from "./lib/learningHealthReads";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;
const start = 100 * DAY;
const end = start + 30 * DAY;
// Representative large report/generation/comment bodies, below one-document max.
const prose = "narrative ".repeat(80_000);
async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ids = await t.run(async ctx => {
    const user = await ctx.db.insert("users", { authId: "bytes-admin", role: "admin" });
    const project = await ctx.db.insert("projects", { title: "Fixture", clientName: "Fixture", shareToken: "fixture", status: "draft", createdBy: user, createdAt: start, updatedAt: start });
    const generation = await ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: start, brainProvenance: [{ entryId: "entry", score: 1 }] });
    const report = await ctx.db.insert("reports", { projectId: project, generationId: generation, content: "", version: 1, generatedAt: start, updatedAt: start });
    const candidate = await ctx.db.insert("reportCandidates", { projectId: project, generationId: generation, model: "m", label: "l", content: "", agentOutputs: "", createdAt: start });
    return { user, project, generation, report, candidate };
  });
  return { t, admin: t.withIdentity({ subject: "bytes-admin" }), ...ids };
}

describe("learning health shared byte budget with enforced Convex transaction limits", () => {
  test("large generations reproduce eager read failure, then return oldest-first partial evidence safely", async () => {
    const { t, admin, project } = await setup();
    for (let i = 1; i <= 24; i++) await t.run(ctx => ctx.db.insert("generations", { projectId: project, status: "completed", startedAt: start + i, agentOutputs: prose, brainProvenance: [{ entryId: "entry", score: 1 }] }));
    // Baseline row-capped read exceeds the real configured 16MiB transaction limit.
    await expect(t.query(ctx => ctx.db.query("generations").withIndex("by_startedAt", q => q.gte("startedAt", start).lte("startedAt", end)).take(201))).rejects.toThrow("Read too much data");
    const result = await admin.query(api.learningHealth.getHealth, { start, end });
    expect(result.coverage.byteBudget).toMatchObject({ limit: HEALTH_READ_BYTES, reservedDocumentBytes: HEALTH_DOCUMENT_HEADROOM, exhausted: true });
    expect(result.coverage.byteBudget.estimatedBytesRead).toBeLessThan(HEALTH_READ_BYTES);
    expect(result.coverage.truncated).toContain("generations");
    expect(result.sources.generations).toBeGreaterThan(1);
    expect(result.sources.generations).toBeLessThan(25);
    expect(result.sources.selection).toEqual({ order: "oldest-first", firstLoadedAt: start, lastLoadedAt: start + result.sources.generations - 1, complete: false });
    expect(result.sources.rows[0]).toMatchObject({ candidateIncomplete: true, reviewIncomplete: true, candidateMean: null, reviewMean: null });
    // Unread report joins must never increment the count of known missing reports.
    expect(result.sources.missingReportGenerations).toBe(0);
  });

  test("mixed evidence populations share one budget and leave later joins incomplete", async () => {
    const { t, admin, project, generation, report, candidate, user } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(generation, { agentOutputs: prose });
      const sourceId = await ctx.db.insert("brainSources", { kind: "pd_pair", status: "approved", title: "Mixed source", industry: "tech", writerTier: 1, docType: "pd", content: prose, ragKey: "mixed", sourceHash: "mixed", createdBy: user, createdAt: start });
      await ctx.db.patch(generation, { brainProvenance: [{ sourceId, entryId: "mixed", score: 1 }] });
      for (let i = 0; i < 3; i++) await ctx.db.insert("candidateScores", { projectId: project, generationId: generation, candidateId: candidate, optionPosition: i, model: "m", label: "l", userId: user, score: 7, comment: prose, createdAt: start, updatedAt: start });
      await ctx.db.patch(report, { content: prose });
      for (let i = 0; i < 3; i++) await ctx.db.insert("writerReviews", { projectId: project, reportId: report, userId: user, score: 70, comment: prose, createdAt: start, updatedAt: start });
    });
    const result = await admin.query(api.learningHealth.getHealth, { start, end });
    expect(result.sources.selection.complete).toBe(true);
    expect(result.sources.rows[0]).toMatchObject({ sourceAvailable: true, sourceMetadataIncomplete: false, candidateMean: 7, candidateSamples: 3, candidateIncomplete: false, reviewMean: 70, reviewSamples: 1, reviewIncomplete: true });
    expect(result.coverage.byteBudget.exhausted).toBe(true);
    expect(result.coverage.byteBudget.estimatedBytesRead).toBeLessThan(HEALTH_READ_BYTES);
    expect(result.coverage.truncated).toEqual(expect.arrayContaining(["writer reviews", "read byte budget"]));
  });

  test.each(["sources", "candidates", "reports", "reviews"] as const)("guards large %s bodies and marks row-level missing loading separately", async population => {
    const { t, admin, project, generation, report, candidate, user } = await setup();
    const provenance: { sourceId: string; entryId: string; score: number }[] = [];
    for (let i = 0; i < 24; i++) await t.run(async ctx => {
      if (population === "sources") {
        const sourceId = await ctx.db.insert("brainSources", { kind: "pd_pair", status: "approved", title: `Source ${i}`, industry: "tech", writerTier: 1, docType: "pd", content: prose, ragKey: `${i}`, sourceHash: `${i}`, createdBy: user, createdAt: start });
        provenance.push({ sourceId, entryId: `${i}`, score: 1 });
      } else if (population === "candidates") {
        await ctx.db.insert("candidateScores", { projectId: project, generationId: generation, candidateId: candidate, optionPosition: i, model: "m", label: "l", userId: user, score: 7, comment: prose, createdAt: start, updatedAt: start });
      } else if (population === "reports") {
        await ctx.db.insert("reports", { projectId: project, generationId: generation, content: prose, version: 1, generatedAt: start, updatedAt: start });
      } else {
        await ctx.db.insert("writerReviews", { projectId: project, reportId: report, userId: user, score: 70, comment: prose, createdAt: start, updatedAt: start });
      }
    });
    if (population === "sources") await t.run(ctx => ctx.db.patch(generation, { brainProvenance: provenance }));
    const result = await admin.query(api.learningHealth.getHealth, { start, end });
    expect(result.coverage.byteBudget.exhausted).toBe(true);
    expect(result.coverage.byteBudget.estimatedBytesRead).toBeLessThan(HEALTH_READ_BYTES);
    expect(result.sources.partial).toBe(true);
    if (population === "sources") {
      expect(result.sources.rows.some(row => row.sourceMetadataIncomplete)).toBe(true);
      expect(result.sources.rows.some(row => row.sourceAvailable)).toBe(true);
    } else if (population === "candidates") {
      expect(result.sources.rows[0]).toMatchObject({ candidateIncomplete: true, candidateMean: 7 });
      expect(result.sources.rows[0].candidateSamples).toBeLessThan(20);
    } else {
      expect(result.sources.rows[0].reviewIncomplete).toBe(true);
    }
    expect(result.sources.selection.complete).toBe(true);
  });
});
