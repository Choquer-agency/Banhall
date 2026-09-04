/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(findingCount = 3) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const creatorId = await ctx.db.insert("users", { authId: "cleanup-creator", role: "writer" });
    await ctx.db.insert("users", { authId: "cleanup-other", role: "writer" });
    await ctx.db.insert("users", { authId: "cleanup-admin", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "QA cleanup", clientName: "Client", createdBy: creatorId, ownerId: creatorId,
      status: "draft", shareToken: "cleanup", createdAt: 1, updatedAt: 1,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: "Report", version: 1, generatedAt: 1, updatedAt: 1,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Retained", clientName: "Client", createdBy: creatorId,
      status: "draft", shareToken: "retained", createdAt: 1, updatedAt: 1,
    });
    const otherReportId = await ctx.db.insert("reports", {
      projectId: otherProjectId, content: "Other", version: 1, generatedAt: 1, updatedAt: 1,
    });
    for (let i = 0; i < findingCount; i++) {
      await ctx.db.insert("qaFindings", {
        reportId, revisionNumber: i, contentHash: `hash-${i}`,
        check: "because_clause", message: "Missing because", blocking: true,
      });
    }
    const retainedFindingId = await ctx.db.insert("qaFindings", {
      reportId: otherReportId, revisionNumber: 0, contentHash: "retained",
      check: "cra_methodology", message: "why_how_why_intact", blocking: true,
    });
    return { projectId, reportId, otherReportId, retainedFindingId };
  });
  const findings = () => t.run(ctx => ctx.db.query("qaFindings")
    .withIndex("by_reportId_and_revisionNumber_and_contentHash_and_findingKey", q => q.eq("reportId", ids.reportId)).collect());
  return { t, ...ids, findings };
}

describe("deleted report QA cleanup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test.each(["cleanup-creator", "cleanup-admin"])("%s deletion cleans history across continuation batches", async subject => {
    const f = await setup(257);
    await f.t.withIdentity({ subject }).mutation(api.projects.deleteProject, { projectId: f.projectId });
    expect(await f.t.run(ctx => ctx.db.get(f.projectId))).toBeNull();
    expect(await f.t.run(ctx => ctx.db.get(f.reportId))).toBeNull();
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await f.findings()).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.get(f.retainedFindingId))).not.toBeNull();
  });

  test("each transaction deletes only one bounded batch and schedules its continuation", async () => {
    const f = await setup(257);
    await f.t.run(ctx => ctx.db.delete(f.reportId));
    await f.t.mutation(internal.projects.cleanupDeletedReportQaFindings, { reportId: f.reportId });
    expect(await f.findings()).toHaveLength(129);
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await f.findings()).toEqual([]);
    await f.t.mutation(internal.projects.cleanupDeletedReportQaFindings, { reportId: f.reportId });
    expect(await f.findings()).toEqual([]);
  });

  test("unauthorized project deletion retains findings and schedules no cleanup", async () => {
    const f = await setup();
    await expect(f.t.withIdentity({ subject: "cleanup-other" }).mutation(api.projects.deleteProject, {
      projectId: f.projectId,
    })).rejects.toThrow();
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await f.t.run(ctx => ctx.db.get(f.reportId))).not.toBeNull();
    expect(await f.findings()).toHaveLength(3);
  });

  test("cleanup refuses to remove findings from a live report", async () => {
    const f = await setup();
    await f.t.mutation(internal.projects.cleanupDeletedReportQaFindings, { reportId: f.reportId });
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await f.findings()).toHaveLength(3);
  });
});
