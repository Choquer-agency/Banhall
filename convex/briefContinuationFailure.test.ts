/// <reference types="vite/client" />
/**
 * Decision 65 (stage 1 re-review): a continuation after a Brief preparation
 * that throws records the retryable seed initialization failure and lets
 * the preparation go, so the Reading page never keeps showing the failed
 * attempt's facts. The continuation's model lookup is made to fail here.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { sha256 } from "./lib/contracts";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";

vi.mock("./ai/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai/providers")>()),
  registerGenerationModels: async () => {
    throw new Error("Model lookup failed");
  },
}));

const modules = import.meta.glob("./**/*.ts");
const TRANSCRIPT = "Interviewer: What held?\n\nPriya Raman: The fluoropolymer seal held for 400 cycles without leaking.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("No provider call is expected");
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("a continuation that throws records the retry and drops the attempt's facts from the Reading page", async () => {
  const t = convexTest(schema, modules);
  const { userId, projectId } = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "continuation-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Continuation", clientName: "Acme Seals", status: "draft", projectType: "writing", ownerId: userId,
      createdBy: userId, shareToken: "continuation", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("transcripts", {
      projectId, content: TRANSCRIPT, contentHash: await sha256(TRANSCRIPT), label: "Interview", position: 0,
      parserVersion: TRANSCRIPT_PARSER_VERSION, createdAt: now,
    });
    return { userId, projectId };
  });
  const writer = t.withIdentity({ subject: "continuation-writer" });
  const generationId = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "iterative" });
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.patch(generationId, { status: "running" });
    // The run is attached to a running preparation that streamed a fact.
    const preparationId = await ctx.db.insert("briefPreparations", {
      projectId, status: "running", revision: 1, runAt: now, triggeredBy: userId, triggerReason: "transcript_added",
      createdAt: now, updatedAt: now, attemptId: "attempt-1", leaseExpiresAt: now + 60_000, dispatchedAt: now, key: "v1:k",
    });
    await ctx.db.insert("briefPreparationFacts", {
      preparationId, projectId, attemptId: "attempt-1", seq: 1, chip: "Fact",
      quote: "The fluoropolymer seal held", sourceLabel: "Priya, line 3", createdAt: now,
    });
    await ctx.db.insert("briefPreparationWaiters", {
      preparationId, projectId, generationId, attemptId: "attempt-1", status: "waiting", registeredAt: now,
      deadlineAt: now + 60_000,
    });
    await ctx.db.patch(generationId, {
      briefPreparation: { preparationId, attemptId: "attempt-1", state: "attached", at: now },
    });
  });
  expect((await writer.query(api.seeds.getReadingFacts, { generationId }))?.count).toBe(1);

  await t.action(internal.ai.iterative.continueAfterBriefPreparation, { generationId });

  const generation = (await t.run(async (ctx) => ctx.db.get(generationId)))!;
  expect(generation.seedStageError).toBeDefined();
  expect(generation.briefPreparation).toMatchObject({ state: "released", at: Date.now() });
  const waiters = await t.run(async (ctx) =>
    ctx.db.query("briefPreparationWaiters").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
  );
  expect(waiters.map((row) => row.status)).toEqual(["released"]);
  // The Reading page shows only the run's own facts (none), never the attempt's.
  expect(await writer.query(api.seeds.getReadingFacts, { generationId })).toMatchObject({ count: 0, latest: [] });
});
