/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { APICallError } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { brainRerankModel } from "./embeddings";
import { searchBrainExemplars } from "./retrieve";

const search = vi.hoisted(() => vi.fn());
vi.mock("./rag", () => ({
  brain: { search },
  BRAIN_NAMESPACE: "brain",
  BRAIN_FILTER_NAMES: ["industryApproved", "docType"],
}));
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, load]) => [
    new URL(path, import.meta.url).pathname, load,
  ]),
);
const args = { query: "private query", k: 1, usageLabel: "chat" };

function slate(scores = [0.9, 0.7, 0.1], tokens = 0) {
  return {
    results: scores.map((score, index) => ({
      entryId: `entry-${index}`,
      score,
      content: [{ text: `private passage ${index}` }],
    })),
    entries: [],
    usage: { tokens },
  };
}
function ranked(scores = [0.8, 0.6], billed = false) {
  return {
    ranking: scores.map((relevanceScore, index) => ({ index, relevanceScore })),
    response: { body: billed ? { usage: { total_tokens: 23 } } : {} },
  };
}
function transientError() {
  return new APICallError({
    message: "provider unavailable",
    url: "https://provider.invalid/rerank",
    requestBodyValues: {},
    statusCode: 503,
    responseHeaders: { "retry-after-ms": "1" },
  });
}
async function observations(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.query("rerankOutcomes").take(100));
}

beforeEach(() => {
  search.mockReset().mockResolvedValue(slate());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("actual Brain retrieval terminal observations", () => {
  test.each([
    { name: "without billed metadata", scores: [0.8, 0.6], survivors: 1 },
    { name: "with zero surviving exemplars", scores: [0.1, 0.2], survivors: 0 },
  ])("records success $name without fabricating usage", async ({ scores, survivors }) => {
    const t = convexTest(schema, modules);
    vi.spyOn(brainRerankModel, "doRerank").mockResolvedValue(ranked(scores));
    const result = await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args);
    expect(result.degraded).toBe(false);
    expect(result.exemplars).toHaveLength(survivors);
    expect(await observations(t)).toEqual([expect.objectContaining({ outcome: "success", callSite: "brain:rerank:chat" })]);
    expect(await t.run((ctx) => ctx.db.query("aiUsage").take(10))).toEqual([]);
  });

  test.each([false, true])("SDK retry terminal result records once (exhausted=%s)", async (exhausted) => {
    const t = convexTest(schema, modules);
    const provider = vi.spyOn(brainRerankModel, "doRerank").mockRejectedValueOnce(transientError());
    if (exhausted) provider.mockRejectedValue(transientError());
    else provider.mockResolvedValue(ranked());
    const result = await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(result.degraded).toBe(false);
    expect(result.exemplars[0]).toMatchObject(exhausted
      ? { entryId: "entry-0", score: 0.9 }
      : { entryId: "entry-0", rerankScore: 0.8 });
    expect(await observations(t)).toEqual([expect.objectContaining({ outcome: exhausted ? "fallback" : "success" })]);
  });

  test("short and empty slates skip the provider and preserve the raw relevance floor", async () => {
    const t = convexTest(schema, modules);
    const provider = vi.spyOn(brainRerankModel, "doRerank");
    for (const scores of [[0.1], []]) {
      search.mockResolvedValueOnce(slate(scores));
      expect(await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args)).toEqual({ exemplars: [], degraded: false });
    }
    expect(provider).not.toHaveBeenCalled();
    expect((await observations(t)).map((row) => row.outcome)).toEqual(["skip", "skip"]);
  });

  test("revoked sources are removed before eligibility and source attribution survives", async () => {
    const t = convexTest(schema, modules);
    const sourceIds = await t.run(async (ctx) => {
      const base = { kind: "pd_pair", title: "Source", industry: "test", writerTier: 0.7, docType: "pd", content: "private", ragKey: "key", sourceHash: "hash", createdBy: "writer", createdAt: 1 } as const;
      return [
        await ctx.db.insert("brainSources", { ...base, status: "approved" }),
        await ctx.db.insert("brainSources", { ...base, status: "revoked" }),
      ];
    });
    search.mockResolvedValue({
      ...slate([0.9, 0.8]),
      entries: sourceIds.map((sourceId, index) => ({ entryId: `entry-${index}`, title: `Source ${index}`, metadata: { sourceId, writerTier: 0.7 } })),
    });
    const provider = vi.spyOn(brainRerankModel, "doRerank");
    const result = await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args);
    expect(result.degraded).toBe(false);
    expect(result.exemplars).toEqual([expect.objectContaining({ entryId: "entry-0", sourceId: sourceIds[0], title: "Source 0" })]);
    expect(provider).not.toHaveBeenCalled();
    expect(await observations(t)).toEqual([expect.objectContaining({ outcome: "skip" })]);
  });

  test("search infrastructure failure is degraded and excluded from attempts", async () => {
    const t = convexTest(schema, modules);
    const provider = vi.spyOn(brainRerankModel, "doRerank");
    search.mockRejectedValueOnce(new Error("search offline"));
    expect(await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args)).toEqual({ exemplars: [], degraded: true });
    expect(provider).not.toHaveBeenCalled();
    expect(await observations(t)).toEqual([expect.objectContaining({ outcome: "search_error" })]);
  });

  test.each(["success", "fallback", "skip", "search_error"] as const)("recording failure preserves %s result and emits a payload-free diagnostic", async (outcome) => {
    const t = convexTest(schema, modules);
    const provider = vi.spyOn(brainRerankModel, "doRerank").mockResolvedValue(ranked());
    if (outcome === "fallback") provider.mockRejectedValue(new Error("not retryable"));
    if (outcome === "skip") search.mockResolvedValue(slate([0.9]));
    if (outcome === "search_error") search.mockRejectedValue(new Error("offline"));
    const normal = await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args);
    const recording = vi.fn().mockRejectedValue(new Error("storage offline"));
    const failed = await t.action((ctx) => searchBrainExemplars({ ...ctx, runMutation: recording }, args));
    expect(failed).toEqual(normal);
    expect(recording).toHaveBeenCalledTimes(1);
    expect(recording.mock.calls[0][1]).toEqual({
      operationId: expect.any(String), observedAt: expect.any(Number), outcome, callSite: "brain:rerank:chat",
    });
    expect(console.error).toHaveBeenCalledWith("brain rerank outcome recording failed", { outcome, callSite: "brain:rerank:chat" });
    expect(await observations(t)).toHaveLength(1);
  });

  test("actual mixed retrieval outcomes produce the approved dashboard denominator", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { authId: "retrieval-admin", role: "admin" }));
    const provider = vi.spyOn(brainRerankModel, "doRerank").mockResolvedValue(ranked());
    for (let i = 0; i < 8; i++) await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args);
    provider.mockRejectedValue(new Error("not retryable"));
    for (let i = 0; i < 2; i++) await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args);
    search.mockResolvedValue(slate([]));
    for (let i = 0; i < 5; i++) await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args);
    search.mockRejectedValue(new Error("offline"));
    await t.action(internal.ai.brain.retrieve.retrieveBrainContext, args);
    const result = await t.withIdentity({ subject: "retrieval-admin" }).query(api.learningHealth.getHealth, { start: Date.now() - 60_000, end: Date.now() });
    expect(result.rerank).toMatchObject({ successes: 8, fallbacks: 2, attempts: 10, skips: 5, searchErrors: 1, rate: 0.2 });
    const rows = await observations(t);
    expect(new Set(rows.map((row) => row.operationId)).size).toBe(16);
  });

  test("billed success retains existing attribution and exact token amounts", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const userId = await t.run((ctx) => ctx.db.insert("users", { authId: "billed-writer", role: "writer" }));
      search.mockResolvedValue(slate(undefined, 7));
      vi.spyOn(brainRerankModel, "doRerank").mockResolvedValue(ranked(undefined, true));
      await t.action(internal.ai.brain.retrieve.retrieveBrainContext, { ...args, userId, agentThreadId: "thread-123" });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const usage = await t.run((ctx) => ctx.db.query("aiUsage").take(10));
      expect(usage).toHaveLength(2);
      expect(usage).toEqual(expect.arrayContaining([
        expect.objectContaining({ callSite: "brain:query_embedding:chat", inputTokens: 7, outputTokens: 0, userId, agentThreadId: "thread-123" }),
        expect.objectContaining({ callSite: "brain:rerank:chat", inputTokens: 23, outputTokens: 0, userId, agentThreadId: "thread-123" }),
      ]));
      expect(await observations(t)).toEqual([expect.objectContaining({ outcome: "success" })]);
    } finally {
      vi.useRealTimers();
    }
  });
});
