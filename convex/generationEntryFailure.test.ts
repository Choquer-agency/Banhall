/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// The entry actions must never strand a reserved row: both the prompt-program
// hash and the begin mutation run while the row is still `reserved`, so either
// failing has to fail the generation with the phase named. The mock is
// scoped to this file so the provenance suite keeps the real manifest.
const promptVersionMock = vi.hoisted(() => vi.fn<() => Promise<string>>());
vi.mock("./ai/promptProgram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/promptProgram")>();
  return { ...actual, currentPromptVersion: promptVersionMock };
});

const modules = import.meta.glob("./**/*.ts");

async function insertReservedGeneration(
  t: ReturnType<typeof convexTest>,
  candidateMode: "single" | "iterative",
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: "entry-failure-writer",
      role: "writer",
      name: "Entry Failure Writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Entry failure project",
      clientName: "Test client",
      status: "draft",
      createdBy: userId,
      shareToken: `entry-failure-${candidateMode}`,
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "A usable interview transcript.",
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "reserved",
      requestedAt: now,
      requestedBy: userId,
      candidateMode,
      ...(candidateMode === "single"
        ? { singleModelId: "claude-sonnet-5" }
        : {}),
      previousProjectStatus: "draft",
      learningDigestIds: [],
      startedAt: now,
    });
    await ctx.db.patch(projectId, {
      activeGenerationId: generationId,
      status: "generating",
    });
    return { projectId, generationId };
  });
}

describe("generation entry failure paths", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    promptVersionMock.mockReset();
  });

  it.each([
    ["one-shot", internal.ai.pipeline.generateReport, "single"] as const,
    [
      "iterative",
      internal.ai.iterative.startIterativeGeneration,
      "iterative",
    ] as const,
  ])(
    "fails the %s generation when the prompt program hash is unavailable",
    async (_label, action, candidateMode) => {
      promptVersionMock.mockRejectedValueOnce(new Error("manifest exploded"));
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const t = convexTest(schema, modules);
      const { projectId, generationId } = await insertReservedGeneration(
        t,
        candidateMode,
      );

      await t.action(action, { generationId });

      const state = await t.run(async (ctx) => ({
        generation: await ctx.db.get(generationId),
        project: await ctx.db.get(projectId),
      }));
      expect(state.generation?.status).toBe("failed");
      expect(state.generation?.error).toBe(
        "Prompt program version unavailable: manifest exploded",
      );
      expect(state.generation?.promptVersion).toBeUndefined();
      expect(state.generation?.learningDigestIds).toEqual([]);
      expect(state.project?.activeGenerationId).toBeUndefined();
      expect(state.project?.status).toBe("draft");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["one-shot", internal.ai.pipeline.generateReport, "single"] as const,
    [
      "iterative",
      internal.ai.iterative.startIterativeGeneration,
      "iterative",
    ] as const,
  ])(
    "fails the %s generation when begin rejects the stamped version",
    async (_label, action, candidateMode) => {
      promptVersionMock.mockResolvedValueOnce("not-a-prompt-program-hash");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const t = convexTest(schema, modules);
      const { projectId, generationId } = await insertReservedGeneration(
        t,
        candidateMode,
      );

      await t.action(action, { generationId });

      const state = await t.run(async (ctx) => ({
        generation: await ctx.db.get(generationId),
        project: await ctx.db.get(projectId),
      }));
      expect(state.generation?.status).toBe("failed");
      expect(state.generation?.error).toMatch(
        /^Generation could not begin: .*Invalid promptVersion hash/,
      );
      expect(state.generation?.promptVersion).toBeUndefined();
      expect(state.project?.activeGenerationId).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
