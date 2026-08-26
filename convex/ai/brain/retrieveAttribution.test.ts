/**
 * Drives the ACTUAL searchBrainExemplars (convex/ai/brain/retrieve.ts) with
 * stubbed search / rerank so the CAP-9 generationId is asserted on BOTH Voyage
 * usage rows (query embedding and rerank) that a generation's retrieval emits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

const searchMock = vi.fn();
const rerankMock = vi.fn();

vi.mock("./rag", () => ({
  brain: { search: (...args: unknown[]) => searchMock(...args) },
  BRAIN_NAMESPACE: "brain",
}));
vi.mock("./embeddings", () => ({
  brainEmbeddingModel: { modelId: "voyage-3-large" },
  brainRerankModel: { modelId: "rerank-2.5" },
}));
vi.mock("ai", () => ({
  rerank: (...args: unknown[]) => rerankMock(...args),
}));

import { searchBrainExemplars } from "./retrieve";

function fakeCtx() {
  const runAfter = vi.fn(async (..._args: unknown[]) => {});
  const runMutation = vi.fn(async (..._args: unknown[]) => {});
  const ctx = {
    scheduler: { runAfter },
    runMutation,
  } as unknown as ActionCtx;
  return { ctx, runAfter };
}

const entryIds = ["e1", "e2", "e3", "e4", "e5", "e6"];

beforeEach(() => {
  searchMock.mockReset();
  rerankMock.mockReset();
  searchMock.mockResolvedValue({
    results: entryIds.map((entryId, i) => ({
      entryId,
      score: 1 - i * 0.1,
      content: [{ text: `exemplar ${entryId}` }],
    })),
    entries: entryIds.map((entryId) => ({
      entryId,
      title: entryId,
      metadata: { writerTier: 0.8 },
    })),
    usage: { tokens: 42 },
  });
  rerankMock.mockResolvedValue({
    ranking: entryIds.map((_, i) => ({ originalIndex: i, score: 0.9 - i * 0.05 })),
    response: { body: { usage: { total_tokens: 17 } } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchBrainExemplars attribution", () => {
  it("stamps generationId on the embedding and rerank usage rows", async () => {
    const { ctx, runAfter } = fakeCtx();
    const generationId = "gen_1" as Id<"generations">;
    const outcome = await searchBrainExemplars(ctx, {
      query: "SR&ED hypothesis",
      k: 4,
      projectId: "proj_1" as Id<"projects">,
      usageLabel: "generation",
      generationId,
    });
    expect(outcome.degraded).toBe(false);
    expect(rerankMock).toHaveBeenCalledTimes(1);
    expect(runAfter).toHaveBeenCalledTimes(2);
    const payloads = runAfter.mock.calls.map(
      (call) => call[2] as Record<string, unknown>
    );
    expect(payloads.map((p) => p.callSite)).toEqual([
      "brain:query_embedding:generation",
      "brain:rerank:generation",
    ]);
    for (const payload of payloads) {
      expect(payload.generationId).toBe(generationId);
      expect(payload.projectId).toBe("proj_1");
    }
    expect(payloads[0].inputTokens).toBe(42);
    expect(payloads[1].inputTokens).toBe(17);
  });

  it("omits generationId when retrieval has no generation (chat)", async () => {
    const { ctx, runAfter } = fakeCtx();
    await searchBrainExemplars(ctx, { query: "q", k: 4 });
    expect(runAfter).toHaveBeenCalledTimes(2);
    for (const call of runAfter.mock.calls) {
      expect(call[2]).not.toHaveProperty("generationId");
    }
  });
});
