/// <reference types="vite/client" />
// 2026-11-18 (fourth): voyage-4-large and rerank-3 proved at Voyage's real
// request and response boundary (AGENTS.md: SDK changes are verified with
// the HTTP transport stubbed, not the decoded response). `fetch` is the only
// stub: the @ai-sdk/voyage provider builds the request, and its own schema
// decodes the response. No real data goes to Voyage.
import { convexTest } from "convex-test";
import { embedMany, rerank } from "ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { insertBrainSource } from "./rag";
import { BRAIN_EMBEDDING_DIMENSION, brainEmbeddingModelV4, brainRerankModelV4 } from "./embeddings";
import ragSchema from "../../../node_modules/@convex-dev/rag/src/component/schema.js";
import workpoolSchema from "../../../node_modules/@convex-dev/workpool/src/component/schema.js";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, load]) => [new URL(path, import.meta.url).pathname, load])
);
const ragModules = import.meta.glob("../../../node_modules/@convex-dev/rag/src/component/**/*.ts");
const workpoolModules = import.meta.glob("../../../node_modules/@convex-dev/workpool/src/component/**/*.ts");

type Sent = { url: string; body: Record<string, unknown>; auth: string | null };

/** A fetch that answers Voyage's embeddings and rerank routes in their documented shapes. */
function voyageFetch(sent: Sent[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    sent.push({ url, body, auth: headers.get("authorization") });
    const json = url.endsWith("/embeddings")
      ? {
          object: "list",
          data: (body.input as string[]).map((_, index) => ({
            object: "embedding",
            embedding: Array.from({ length: BRAIN_EMBEDDING_DIMENSION }, (_, i) => (i === index ? 1 : 0)),
            index,
          })),
          model: body.model,
          usage: { total_tokens: 8 },
        }
      : {
          object: "list",
          data: [
            { relevance_score: 0.91, index: 1 },
            { relevance_score: 0.12, index: 0 },
          ],
          model: body.model,
          usage: { total_tokens: 26 },
        };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  });
}

let sent: Sent[];
beforeEach(() => {
  sent = [];
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
  vi.stubGlobal("fetch", voyageFetch(sent));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Voyage 4 at the HTTP boundary", () => {
  test("an embed request names voyage-4-large, sends no input type or dimension, and its response decodes", async () => {
    const result = await embedMany({ model: brainEmbeddingModelV4, values: ["first passage", "second passage"] });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(sent[0].auth).toBe("Bearer test-voyage-key");
    expect(sent[0].body).toEqual({ model: "voyage-4-large", input: ["first passage", "second passage"] });
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(BRAIN_EMBEDDING_DIMENSION);
    expect(result.usage.tokens).toBe(8);
  });

  test("a rerank request names rerank-3, and its scores and billed tokens decode", async () => {
    const result = await rerank({
      model: brainRerankModelV4,
      query: "kiln drift",
      documents: ["off topic", "on topic"],
      topN: 2,
      maxRetries: 0,
    });
    expect(sent[0].url).toBe("https://api.voyageai.com/v1/rerank");
    expect(sent[0].body).toEqual({ model: "rerank-3", query: "kiln drift", documents: ["off topic", "on topic"], top_k: 2 });
    expect(result.ranking.map((r) => [r.originalIndex, r.score])).toEqual([
      [1, 0.91],
      [0, 0.12],
    ]);
    expect((result.response.body as { usage: { total_tokens: number } }).usage.total_tokens).toBe(26);
  });

  test("embedSource sends the source's text to both models through the RAG component and records both entries", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    t.registerComponent("rag", ragSchema, ragModules);
    t.registerComponent("rag/workpool", workpoolSchema, workpoolModules);
    t.registerComponent("embedPool", workpoolSchema, workpoolModules);
    const sourceId = await t.run((ctx) =>
      insertBrainSource(ctx, {
        kind: "pd_pair",
        status: "approved",
        title: "Made-up PD",
        industry: "manufacturing",
        writerTier: 0.7,
        docType: "pd",
        content: "A made-up passage about kiln drift.",
        ragKey: "pd_pair:boundary",
        sourceHash: "hash-boundary",
        createdBy: "test",
        createdAt: 1,
      })
    );
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId });
    expect(sent.map((s) => s.body.model)).toEqual(["voyage-3-large", "voyage-4-large"]);
    expect(sent[0].body.input_type).toBeUndefined();
    expect(sent[1].body.input_type).toBe("document");
    for (const request of sent) expect(request.body.input).toEqual(["A made-up passage about kiln drift."]);
    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.ragEntryId).toBeTruthy();
    expect(row?.ragEntryIdV4).toBeTruthy();

    sent.length = 0;
    const { embed } = await import("ai");
    const { BRAIN_SEARCH_EMBEDDING_MODELS } = await import("./embeddings");
    await embed({
      model: BRAIN_SEARCH_EMBEDDING_MODELS.voyage4,
      value: "kiln drift control",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.model).toBe("voyage-4-large");
    expect(sent[0].body.input_type).toBe("query");
  });
});
