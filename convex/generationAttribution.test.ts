/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// CAP-9: generation provenance (promptVersion, learningDigestIds) and
// attributable cost (aiUsage.generationId / candidateRunId / durationMs).

const modules = import.meta.glob("./**/*.ts");
const authId = "attribution-user";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

async function setup(
  generationStatus: "reserved" | "running" = "running"
) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Attribution project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "attribution-token",
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
      status: generationStatus,
      requestedBy: userId,
      candidateMode: "compare",
      previousProjectStatus: "draft",
      startedAt: now,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const otherGenerationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "completed",
      requestedBy: userId,
      candidateMode: "compare",
      previousProjectStatus: "draft",
      startedAt: now,
    });
    const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      status: "running",
      queuedAt: now,
    });
    return { projectId, generationId, otherGenerationId, candidateRunId };
  });
  return { t, ...ids };
}

function usageRow(generationId: Id<"generations">, costUsd: number) {
  return {
    generationId,
    callSite: "generation:242",
    model: "claude-sonnet-5",
    inputTokens: 10,
    outputTokens: 5,
    costUsd,
    createdAt: Date.now(),
  };
}

describe("getGeneration cost attribution", () => {
  it("sums costUsd over the generation's aiUsage rows only", async () => {
    const { t, generationId, otherGenerationId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiUsage", usageRow(generationId, 0.1));
      await ctx.db.insert("aiUsage", usageRow(generationId, 0.2));
      await ctx.db.insert("aiUsage", usageRow(generationId, 0.3));
      await ctx.db.insert("aiUsage", usageRow(otherGenerationId, 5));
    });
    const result = await t
      .withIdentity({ subject: authId })
      .query(api.generations.getGeneration, { generationId });
    expect(result).not.toBeNull();
    expect(result!.costUsd).toBeCloseTo(0.6);
    expect(result!.usageCalls).toBe(3);
  });

  it("reports zero cost and zero calls when no usage exists yet", async () => {
    const { t, generationId } = await setup();
    const result = await t
      .withIdentity({ subject: authId })
      .query(api.generations.getGeneration, { generationId });
    expect(result!.costUsd).toBe(0);
    expect(result!.usageCalls).toBe(0);
  });

  it("returns undefined provenance for a legacy row and keeps other fields", async () => {
    const { t, generationId, projectId } = await setup();
    const result = await t
      .withIdentity({ subject: authId })
      .query(api.generations.getGeneration, { generationId });
    expect(result!.promptVersion).toBeUndefined();
    expect(result!.learningDigestIds).toBeUndefined();
    expect(result!._id).toBe(generationId);
    expect(result!.projectId).toBe(projectId);
    expect(result!.status).toBe("running");
    expect(result!.candidateMode).toBe("compare");
  });
});

describe("logUsage attribution", () => {
  it("persists generationId, candidateRunId and durationMs verbatim", async () => {
    const { t, generationId, candidateRunId } = await setup();
    await t.mutation(internal.aiUsage.logUsage, {
      callSite: "generation:242",
      model: "claude-sonnet-5",
      inputTokens: 10,
      outputTokens: 5,
      generationId,
      candidateRunId,
      durationMs: 1234,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("aiUsage")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].generationId).toBe(generationId);
    expect(rows[0].candidateRunId).toBe(candidateRunId);
    expect(rows[0].durationMs).toBe(1234);
  });

  it("drops a negative or non-finite durationMs instead of persisting it", async () => {
    const { t, generationId } = await setup();
    for (const durationMs of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await t.mutation(internal.aiUsage.logUsage, {
        callSite: "generation:242",
        model: "claude-sonnet-5",
        inputTokens: 1,
        outputTokens: 1,
        generationId,
        durationMs,
      });
    }
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("aiUsage")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).not.toHaveProperty("durationMs");
  });

  it("inserts an unattributed row exactly as before", async () => {
    const { t } = await setup();
    await t.mutation(internal.aiUsage.logUsage, {
      callSite: "chat",
      model: "claude-sonnet-5",
      inputTokens: 10,
      outputTokens: 5,
    });
    const rows = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].callSite).toBe("chat");
    expect(rows[0].inputTokens).toBe(10);
    expect(rows[0].outputTokens).toBe(5);
    expect(typeof rows[0].costUsd).toBe("number");
    expect(rows[0]).not.toHaveProperty("generationId");
    expect(rows[0]).not.toHaveProperty("candidateRunId");
    expect(rows[0]).not.toHaveProperty("durationMs");
  });
});

describe("beginGeneration promptVersion", () => {
  it("patches a reserved generation to running with promptVersion", async () => {
    const { t, generationId } = await setup("reserved");
    const started = await t.mutation(internal.generations.beginGeneration, {
      generationId,
      promptVersion: "sha256:0123456789abcdef",
    });
    expect(started).toBe(true);
    const row = await t.run(async (ctx) => ctx.db.get(generationId));
    expect(row!.status).toBe("running");
    expect(row!.promptVersion).toBe("sha256:0123456789abcdef");
  });

  it("returns false and leaves the row untouched when not reserved", async () => {
    const { t, generationId } = await setup("running");
    const started = await t.mutation(internal.generations.beginGeneration, {
      generationId,
      promptVersion: "sha256:0123456789abcdef",
    });
    expect(started).toBe(false);
    const row = await t.run(async (ctx) => ctx.db.get(generationId));
    expect(row!.promptVersion).toBeUndefined();
  });
});

describe("recordLearningDigests", () => {
  it("stores the digest ids, including an empty array", async () => {
    const { t, generationId } = await setup();
    const digestId = await t.run(async (ctx) =>
      ctx.db.insert("learningDigests", {
        kind: "draft_style",
        content: "Prefer concrete verbs.",
        sourceCount: 3,
        feedbackCutoff: Date.now(),
        model: "claude-sonnet-5",
        createdAt: Date.now(),
      })
    );
    await t.mutation(internal.generations.recordLearningDigests, {
      generationId,
      learningDigestIds: [digestId],
    });
    let row = await t.run(async (ctx) => ctx.db.get(generationId));
    expect(row!.learningDigestIds).toEqual([digestId]);

    await t.mutation(internal.generations.recordLearningDigests, {
      generationId,
      learningDigestIds: [],
    });
    row = await t.run(async (ctx) => ctx.db.get(generationId));
    expect(row!.learningDigestIds).toEqual([]);

    const view = await t
      .withIdentity({ subject: authId })
      .query(api.generations.getGeneration, { generationId });
    expect(view!.learningDigestIds).toEqual([]);
  });

  it("is a no-op for a missing generation", async () => {
    const { t, generationId } = await setup();
    await t.run(async (ctx) => ctx.db.delete(generationId));
    await expect(
      t.mutation(internal.generations.recordLearningDigests, {
        generationId,
        learningDigestIds: [],
      })
    ).resolves.toBeNull();
  });
});
