/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { beginTrackedGeneration } from "./ai/pipeline";
import { withWriteRetries } from "./lib/writeRetry";
import { WRITE_RETRY_DELAYS_MS } from "../shared/writeLimit";
import type { ActionCtx } from "./_generated/server";

// The entry actions must never strand a reserved row: both the prompt-program
// hash and the begin mutation run while the row is still `reserved`, so either
// failing has to fail the generation with the phase named. The mock is
// scoped to this file so the provenance suite keeps the real manifest.
// Model catalog: the version is per generation (generationPromptVersion).
const promptVersionMock = vi.hoisted(() => vi.fn<() => Promise<string>>());
vi.mock("./ai/promptProgram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/promptProgram")>();
  return { ...actual, generationPromptVersion: promptVersionMock };
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

  // Owner, 2026-10-28 (question 14): the write rate refused this begin when
  // two large drafts started in the same second (F5 stress run).
  const REFUSED =
    '{"code":"TooManyWrites","message":"Too many writes per second. Your deployment is limited to 4 MiB bytes written per second."}';
  /** The action's ctx with the write rate refusing `name` `times` times. */
  const refusing = (ctx: ActionCtx, name: string, times: number) => {
    const refused = { count: 0 };
    const flaky = {
      ...ctx,
      runMutation: (async (ref: Parameters<ActionCtx["runMutation"]>[0], ...rest: unknown[]) => {
        if (getFunctionName(ref) === name && refused.count < times) {
          refused.count += 1;
          throw new Error(REFUSED);
        }
        return await (ctx.runMutation as (...args: unknown[]) => Promise<unknown>)(ref, ...rest);
      }) as ActionCtx["runMutation"],
    } as ActionCtx;
    return { flaky, refused };
  };

  it("without the wrapper, one refusal fails the draft (as on the F5 stress run)", async () => {
    promptVersionMock.mockResolvedValueOnce(`sha256:${"a".repeat(64)}`);
    const t = convexTest(schema, modules);
    const { generationId } = await insertReservedGeneration(t, "iterative");
    const began = await t.action(async (ctx) => {
      const { flaky } = refusing(ctx, "generations:beginGeneration", 1);
      return await beginTrackedGeneration(flaky, generationId);
    });
    expect(began).toBe(false);
    const generation = await t.run(async (ctx) => await ctx.db.get(generationId));
    expect(generation?.error).toMatch(/^Generation could not begin: .*TooManyWrites/);
  });

  it("begins once the write rate lets the begin through", async () => {
    promptVersionMock.mockResolvedValueOnce(`sha256:${"a".repeat(64)}`);
    const t = convexTest(schema, modules);
    const { generationId } = await insertReservedGeneration(t, "iterative");
    const { began, refusals } = await t.action(async (ctx) => {
      const { flaky, refused } = refusing(ctx, "generations:beginGeneration", 2);
      // As the start actions do: their ctx is wrapped once, at the top.
      return { began: await beginTrackedGeneration(withWriteRetries(flaky), generationId), refusals: refused.count };
    });
    expect(began).toBe(true);
    expect(refusals).toBe(2);
    const generation = await t.run(async (ctx) => await ctx.db.get(generationId));
    expect(generation?.status).not.toBe("failed");
    expect(generation?.promptVersion).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("fails the generation naming the write rate once every try is refused", async () => {
    vi.useFakeTimers();
    try {
      promptVersionMock.mockResolvedValueOnce(`sha256:${"a".repeat(64)}`);
      const t = convexTest(schema, modules);
      const { projectId, generationId } = await insertReservedGeneration(t, "iterative");
      const pending = t.action(async (ctx) => {
        const { flaky, refused } = refusing(ctx, "generations:beginGeneration", 99);
        return { began: await beginTrackedGeneration(withWriteRetries(flaky), generationId), refusals: refused.count };
      });
      await vi.runAllTimersAsync();
      const { began, refusals } = await pending;
      expect(began).toBe(false);
      // The first try and one after each wait.
      expect(refusals).toBe(WRITE_RETRY_DELAYS_MS.length + 1);
      const state = await t.run(async (ctx) => ({
        generation: await ctx.db.get(generationId),
        project: await ctx.db.get(projectId),
      }));
      expect(state.generation?.status).toBe("failed");
      expect(state.generation?.error).toMatch(/^Generation could not begin: .*TooManyWrites/);
      expect(state.project?.activeGenerationId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
