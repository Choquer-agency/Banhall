/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const authId = "recovery-user";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

async function setupPartial() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Recovery project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "recovery-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "awaiting_selection",
      requestedBy: userId,
      candidateMode: "compare",
      compareModelIds: ["claude-sonnet-5", "google/gemini-3.1-pro-preview"],
      previousProjectStatus: "draft",
      candidatesDone: 1,
      candidatesFailed: 1,
      startedAt: now,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const candidateId = await ctx.db.insert("reportCandidates", {
      projectId,
      generationId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      content: "Ready candidate",
      agentOutputs: "{}",
      createdAt: now,
    });
    await ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      status: "succeeded",
      candidateId,
      queuedAt: now,
      completedAt: now,
    });
    await ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId,
      model: "google/gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro",
      status: "failed",
      error: "unknown: provider rejected request",
      queuedAt: now,
      completedAt: now,
    });
    return { projectId, generationId, candidateId };
  });
  return { t, ...ids };
}

describe("generation recovery", () => {
  it("projects per-model state without raw provider errors", async () => {
    const { t, generationId } = await setupPartial();
    const recovery = await t.withIdentity({ subject: authId }).query(
      api.generations.getGenerationRecovery,
      { generationId }
    );
    expect(recovery?.models).toEqual([
      { model: "claude-sonnet-5", label: "Sonnet 5", status: "succeeded" },
      { model: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", status: "failed" },
    ]);
    expect(JSON.stringify(recovery)).not.toContain("provider rejected");
  });

  it("creates one linked retry, preserves ready content, and queues only failed models", async () => {
    const { t, generationId, candidateId } = await setupPartial();
    const authed = t.withIdentity({ subject: authId });
    const retryId = await authed.mutation(api.generations.retryFailedCandidates, {
      generationId,
    });
    const state = await t.run(async (ctx) => {
      const original = await ctx.db.get(generationId);
      const retry = await ctx.db.get(retryId);
      const retryCandidates = await ctx.db
        .query("reportCandidates")
        .withIndex("by_generationId", (q) => q.eq("generationId", retryId))
        .take(10);
      const originalCandidate = await ctx.db.get(candidateId);
      return { original, retry, retryCandidates, originalCandidate };
    });
    expect(state.original?.status).toBe("completed");
    expect(state.retry?.retryOfGenerationId).toBe(generationId);
    expect(state.retry?.retryModelIds).toEqual(["google/gemini-3.1-pro-preview"]);
    expect(state.retry?.seededCandidates).toBe(1);
    expect(state.retryCandidates.map((candidate) => candidate.content)).toEqual(["Ready candidate"]);
    expect(state.originalCandidate?.content).toBe("Ready candidate");
    await expect(
      authed.mutation(api.generations.retryFailedCandidates, { generationId })
    ).rejects.toThrow(/partial generation/i);
  });

  it("rejects legacy partial retries whose original model pair cannot be proven", async () => {
    const { t, generationId } = await setupPartial();
    await t.run(async (ctx) => {
      await ctx.db.patch(generationId, { compareModelIds: undefined });
      const failed = (
        await ctx.db
          .query("generationCandidateRuns")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .take(10)
      ).find((run) => run.status === "failed");
      if (failed) {
        await ctx.db.patch(failed._id, { model: "legacy-unknown-model" });
      }
    });
    await expect(
      t.withIdentity({ subject: authId }).mutation(
        api.generations.retryFailedCandidates,
        { generationId }
      )
    ).rejects.toThrow(/older comparison/i);
    const original = await t.run(async (ctx) => await ctx.db.get(generationId));
    expect(original?.status).toBe("awaiting_selection");
  });

  it("terminalizes a seeded recovery after the retried model succeeds", async () => {
    const { t, generationId } = await setupPartial();
    const retryId = await t.withIdentity({ subject: authId }).mutation(
      api.generations.retryFailedCandidates,
      { generationId }
    );
    const retryRunId = await t.run(async (ctx) => {
      await ctx.db.patch(retryId, { status: "running" });
      const project = await ctx.db
        .query("projects")
        .withIndex("by_shareToken", (q) => q.eq("shareToken", "recovery-token"))
        .unique();
      if (!project) throw new Error("project missing");
      await ctx.db.patch(project._id, { activeGenerationId: retryId });
      return await ctx.db.insert("generationCandidateRuns", {
        generationId: retryId,
        projectId: project._id,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "running",
        queuedAt: Date.now(),
        startedAt: Date.now(),
      });
    });
    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: retryRunId,
      content: "Recovered candidate",
      agentOutputs: "{}",
    });
    const retry = await t.run(async (ctx) => await ctx.db.get(retryId));
    expect(retry?.status).toBe("awaiting_selection");
    expect(retry?.candidatesDone).toBe(2);
    expect(retry?.candidatesFailed).toBe(0);
  });

  it("keeps seeded drafts selectable when the retried model fails again", async () => {
    const { t, generationId } = await setupPartial();
    const retryId = await t.withIdentity({ subject: authId }).mutation(
      api.generations.retryFailedCandidates,
      { generationId }
    );
    const retryRunId = await t.run(async (ctx) => {
      await ctx.db.patch(retryId, { status: "running" });
      const retry = await ctx.db.get(retryId);
      if (!retry) throw new Error("retry missing");
      const project = await ctx.db.get(retry.projectId);
      if (!project) throw new Error("project missing");
      await ctx.db.patch(project._id, { activeGenerationId: retryId });
      return await ctx.db.insert("generationCandidateRuns", {
        generationId: retryId,
        projectId: project._id,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "running",
        queuedAt: Date.now(),
        startedAt: Date.now(),
      });
    });
    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: retryRunId,
      error: "unknown: provider unavailable",
    });
    const retry = await t.run(async (ctx) => await ctx.db.get(retryId));
    expect(retry?.status).toBe("awaiting_selection");
    expect(retry?.candidatesDone).toBe(1);
    expect(retry?.candidatesFailed).toBe(1);
  });

  it("requires an authenticated internal user", async () => {
    const { t, generationId } = await setupPartial();
    await expect(
      t.mutation(api.generations.retryFailedCandidates, { generationId })
    ).rejects.toThrow(/Authentication required/);
    expect(
      await t.query(api.generations.getGenerationRecovery, { generationId })
    ).toBeNull();
  });
});
