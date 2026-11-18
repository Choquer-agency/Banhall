/// <reference types="vite/client" />
// 2026-11-18 (fourth): the Brain moves to Voyage 4 through a second search
// index and a stored pointer. These run the real RAG component in
// convex-test with only Voyage's models stubbed (the HTTP boundary has its
// own test in convex/ai/brain/voyageBoundary.test.ts). Every company and
// passage here is made up.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  brain,
  brainV4,
  BRAIN_CHUNK_NOTES_VERSION,
  BRAIN_ENTRY_IMPORTANCE,
  insertBrainSource,
} from "./ai/brain/rag";
import {
  BRAIN_EMBEDDING_DIMENSION,
  BRAIN_SEARCH_INDEXES,
  brainEmbeddingModel,
  brainEmbeddingModelV4,
  brainRerankModel,
  brainRerankModelV4,
} from "./ai/brain/embeddings";
import { embedTargets } from "./ai/brain/ingest";
import { searchBrainExemplars } from "./ai/brain/retrieve";
import { BUILD_PAGE_SIZE, BUILD_WAIT_MS } from "./brain";
import { MODEL_PRICING } from "../shared/modelPricing";
import ragSchema from "../node_modules/@convex-dev/rag/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

// The chunk notes' model: one fake client, so a test can count its calls.
const notesCreate = vi.hoisted(() => vi.fn());
vi.mock("./ai/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai/providers")>()),
  clientForRole: vi.fn(async () => ({ client: { messages: { create: notesCreate } }, model: "claude-haiku-5-5" })),
}));

// Keyed by absolute path, so convex-test finds a module by its function handle.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("./**/*.ts")).map(([path, load]) => [new URL(path, import.meta.url).pathname, load])
);
const ragModules = import.meta.glob("../node_modules/@convex-dev/rag/src/component/**/*.ts");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/*.ts");

type T = ReturnType<typeof convexTest<typeof schema.tables>>;

/** A unit vector with cosine `cos` to the query (axis 0), its rest on its own axis. */
function vectorAt(cos: number, axis: number): number[] {
  const vector = new Array(BRAIN_EMBEDDING_DIMENSION).fill(0);
  vector[0] = cos;
  vector[axis] = Math.sqrt(1 - cos * cos);
  return vector;
}
const QUERY = vectorAt(1, 1);

function setup(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("rag", ragSchema, ragModules);
  t.registerComponent("rag/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("embedPool", workpoolSchema, workpoolModules);
  return t;
}

async function withAdmin(t: T) {
  await t.run((ctx) => ctx.db.insert("users", { authId: "v4-admin", role: "admin", name: "Admin" }));
  return t.withIdentity({ subject: "v4-admin" });
}

let counter = 0;
async function source(t: T, extra: Partial<Doc<"brainSources">> = {}): Promise<Id<"brainSources">> {
  const n = counter++;
  return await t.run((ctx) =>
    insertBrainSource(ctx, {
      kind: "pd_pair",
      status: "approved",
      title: `Past PD ${n}`,
      industry: "manufacturing",
      writerTier: 0.7,
      docType: "pd",
      content: `Passage ${n} about kiln temperature control and drift under cold cycles.`,
      ragKey: `pd_pair:v4-${n}`,
      sourceHash: `hash-v4-${n}`,
      createdBy: "test",
      createdAt: 1_700_000_000_000 + n,
      ...extra,
    })
  );
}

async function row(t: T, id: Id<"brainSources">) {
  return await t.run((ctx) => ctx.db.get(id));
}

async function card(t: T, id: Id<"brainSources">) {
  return await t.run((ctx) =>
    ctx.db.query("brainSourceCards").withIndex("by_sourceId", (q) => q.eq("sourceId", id)).unique()
  );
}

/** Add one chunk for a source to one index, as embedSource does (completion included). */
async function addTo(t: T, rag: typeof brain, namespace: string, id: Id<"brainSources">, cos: number, axis: number) {
  const src = (await row(t, id))!;
  return await t.action(async (ctx) =>
    rag.add(ctx, {
      namespace,
      key: src.ragKey,
      title: src.title,
      importance: BRAIN_ENTRY_IMPORTANCE,
      metadata: { sourceId: id, industry: src.industry, writerTier: src.writerTier, docType: src.docType },
      filterValues: [
        { name: "industryApproved", value: { industry: src.industry, approved: true } },
        { name: "docType", value: src.docType },
      ],
      chunks: [{ text: `${namespace} passage for ${src.title}.`, embedding: vectorAt(cos, axis) }],
      onComplete: internal.ai.brain.rag.ingestOnComplete,
    })
  );
}

async function scheduled(t: T, name: string) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name.includes(name) && job.state.kind === "pending"
    )
  );
}

async function runUnlearns(t: T) {
  for (const job of await scheduled(t, "unlearnSource")) {
    await t.action(internal.brain.unlearnSource, job.args[0] as never);
    await t.run((ctx) => ctx.scheduler.cancel(job._id));
  }
}

async function backfillCards(t: T) {
  for (let cursor: string | null = null; ; ) {
    const result: { done: boolean; continueCursor: string } = await t.mutation(internal.brain.backfillBrainSourceCards, { cursor });
    if (result.done) return;
    cursor = result.continueCursor;
  }
}

beforeEach(() => {
  // Scheduled jobs wait, so each test runs only the ones it means to.
  vi.useFakeTimers();
  counter = 0;
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const embed = async ({ values }: { values: string[] }) =>
    ({ embeddings: values.map(() => QUERY), usage: { tokens: 3 * values.length }, warnings: [] }) as never;
  vi.spyOn(brainEmbeddingModel, "doEmbed").mockImplementation(embed as never);
  vi.spyOn(brainEmbeddingModelV4, "doEmbed").mockImplementation(embed as never);
  notesCreate.mockReset().mockResolvedValue({ content: [{ type: "text", text: "In the method section." }] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the models and prices", () => {
  test("voyage4 uses voyage-4-large and rerank-3 on its own namespace; voyage3 keeps the old ones", () => {
    expect(BRAIN_SEARCH_INDEXES.voyage3).toMatchObject({ embeddingModelId: "voyage-3-large", namespace: "brain", rerankModelId: "rerank-2.5" });
    expect(BRAIN_SEARCH_INDEXES.voyage4).toMatchObject({ embeddingModelId: "voyage-4-large", namespace: "brain-v4", rerankModelId: "rerank-3" });
    expect(brainEmbeddingModelV4.modelId).toBe("voyage-4-large");
    expect(brainRerankModelV4.modelId).toBe("rerank-3");
    expect(BRAIN_SEARCH_INDEXES.voyage4.namespace).not.toBe(BRAIN_SEARCH_INDEXES.voyage3.namespace);
  });

  test("prices resolve for both new ids, beside the old ones", () => {
    expect(MODEL_PRICING["voyage-4-large"]?.input).toBe(0.12);
    expect(MODEL_PRICING["rerank-3"]?.input).toBe(0.05);
    expect(MODEL_PRICING["voyage-3-large"]?.input).toBe(0.18);
    expect(MODEL_PRICING["rerank-2.5"]?.input).toBe(0.05);
  });
});

describe("two indexes, one pointer", () => {
  test("the trap this design avoids: a new model under the old namespace name empties the old index's search", async () => {
    const t = setup();
    const id = await source(t);
    await addTo(t, brain, "brain", id, 0.6, 2);
    const searchOld = () =>
      t.action(async (ctx) => (await brain.search(ctx, { namespace: "brain", query: "kiln", searchType: "vector", limit: 5 })).results);
    expect(await searchOld()).toHaveLength(1);
    // The first add of a new model under the SAME name makes a new version
    // of "brain" and marks the old one replaced: the old instance finds nothing.
    await addTo(t, brainV4, "brain", id, 0.6, 3);
    expect(await searchOld()).toEqual([]);
  });

  test("adding to voyage4 leaves voyage3 searchable, and search follows the pointer both ways", async () => {
    const t = setup();
    const id = await source(t);
    await addTo(t, brain, BRAIN_SEARCH_INDEXES.voyage3.namespace, id, 0.6, 2);
    await addTo(t, brainV4, BRAIN_SEARCH_INDEXES.voyage4.namespace, id, 0.7, 3);
    const after = (await row(t, id))!;
    expect(after.ragEntryId).toBeTruthy();
    expect(after.ragEntryIdV4).toBeTruthy();
    expect(after.ragEntryIdV4).not.toBe(after.ragEntryId);
    expect((await card(t, id))?.ragEntryIdV4).toBe(after.ragEntryIdV4);

    const search = () => t.action((ctx: ActionCtx) => searchBrainExemplars(ctx, { query: "kiln", k: 4 }));
    const first = await search();
    expect(first.exemplars.map((e) => e.entryId)).toEqual([after.ragEntryId]);
    expect(first.exemplars[0].text).toContain("brain passage");

    await t.run(async (ctx) => {
      await ctx.db.insert("brainSearchIndexState", {
        key: "search",
        serving: "voyage3",
        lastBuild: { finishedAt: 1, approved: 1, present: 1, queued: 0, missing: 0 },
        changedBy: "test",
        changedAt: 1,
      });
    });
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4", actor: "owner" })).toEqual({ serving: "voyage4", changed: true });
    const moved = await search();
    expect(moved.exemplars.map((e) => e.entryId)).toEqual([after.ragEntryIdV4]);
    expect(moved.exemplars[0].text).toContain("brain-v4 passage");

    await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage3", actor: "owner", reason: "rollback drill" });
    expect((await search()).exemplars.map((e) => e.entryId)).toEqual([after.ragEntryId]);
    const audit = await t.run((ctx) => ctx.db.query("brainAuditLog").collect());
    expect(audit.filter((a) => a.action === "switch_index").map((a) => a.reason)).toEqual([
      "Search moved from voyage3 (voyage-3-large) to voyage4 (voyage-4-large)",
      "Search moved from voyage4 (voyage-4-large) to voyage3 (voyage-3-large): rollback drill",
    ]);
  });

  test("with voyage4 serving, the query is embedded by voyage-4-large, reranked by rerank-3 at its floor, and billed under those ids", async () => {
    const t = setup();
    const ids = [await source(t), await source(t)];
    for (const [i, id] of ids.entries()) await addTo(t, brainV4, "brain-v4", id, 0.6, 2 + i);
    await t.run((ctx) =>
      ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 })
    );
    const oldRerank = vi.spyOn(brainRerankModel, "doRerank");
    const newRerank = vi.spyOn(brainRerankModelV4, "doRerank").mockResolvedValue({
      ranking: [
        { index: 0, relevanceScore: BRAIN_SEARCH_INDEXES.voyage4.rerankRelevanceFloor + 0.1 },
        { index: 1, relevanceScore: BRAIN_SEARCH_INDEXES.voyage4.rerankRelevanceFloor - 0.01 },
      ],
      response: { body: { usage: { total_tokens: 17 } } },
    } as never);
    const result = await t.action((ctx: ActionCtx) => searchBrainExemplars(ctx, { query: "kiln", k: 1, usageLabel: "test" }));
    expect(result.exemplars).toHaveLength(1);
    expect(newRerank).toHaveBeenCalledTimes(1);
    expect(oldRerank).not.toHaveBeenCalled();
    expect(brainEmbeddingModel.doEmbed).not.toHaveBeenCalled();
    const usage = (await scheduled(t, "logUsage")).map((job) => job.args[0] as { model: string; callSite: string });
    expect(usage.map((u) => [u.callSite, u.model]).sort()).toEqual([
      ["brain:query_embedding:test", "voyage-4-large"],
      ["brain:rerank:test", "rerank-3"],
    ]);
  });

  test("the pointer refuses voyage4 before a build and while sources are missing, unless forced", async () => {
    const t = setup();
    await expect(t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).rejects.toThrow(/buildSearchIndex to the end/);
    await t.run((ctx) =>
      ctx.db.insert("brainSearchIndexState", {
        key: "search",
        serving: "voyage3",
        lastBuild: { finishedAt: 1, approved: 3, present: 2, queued: 1, missing: 1 },
        changedBy: "test",
        changedAt: 1,
      })
    );
    await expect(t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).rejects.toThrow(
      "The last build left 1 approved sources without a voyage4 entry. Run brain:buildSearchIndex again."
    );
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4", force: true })).toEqual({ serving: "voyage4", changed: true });
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).toEqual({ serving: "voyage4", changed: false });
    const reasons = (await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).map((a) => a.reason);
    expect(reasons).toEqual(["Search moved from voyage3 (voyage-3-large) to voyage4 (voyage-4-large), forced"]);
  });
});

describe("both entries are erased, confirmed", () => {
  test("a revoke schedules an unlearn per index; each confirmed erasure clears its own field", async () => {
    const t = setup();
    const admin = await withAdmin(t);
    const id = await source(t);
    await addTo(t, brain, "brain", id, 0.6, 2);
    await addTo(t, brainV4, "brain-v4", id, 0.6, 3);
    const before = (await row(t, id))!;

    await admin.mutation(api.brain.revokeSource, { sourceId: id });
    const jobs = (await scheduled(t, "unlearnSource")).map((job) => job.args[0] as { ragEntryId: string; index: string });
    expect(jobs.map((j) => [j.index, j.ragEntryId])).toEqual([
      ["voyage3", before.ragEntryId],
      ["voyage4", before.ragEntryIdV4],
    ]);
    await runUnlearns(t);

    const after = (await row(t, id))!;
    expect(after.ragEntryId).toBeUndefined();
    expect(after.ragEntryIdV4).toBeUndefined();
    expect((await card(t, id))?.ragEntryIdV4).toBeUndefined();
    await t.action(async (ctx) => {
      expect(await brain.getEntry(ctx, { entryId: before.ragEntryId as never })).toBeNull();
      expect(await brainV4.getEntry(ctx, { entryId: before.ragEntryIdV4 as never })).toBeNull();
    });
    const confirmed = (await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).filter((a) => a.action === "unlearn_confirmed");
    expect(confirmed).toHaveLength(2);
  });

  test("a voyage4 completion for a source revoked meanwhile is erased and never recorded", async () => {
    const t = setup();
    const admin = await withAdmin(t);
    const id = await source(t);
    await admin.mutation(api.brain.revokeSource, { sourceId: id });
    const result = await addTo(t, brainV4, "brain-v4", id, 0.6, 2);
    expect((await row(t, id))?.ragEntryIdV4).toBeUndefined();
    const jobs = (await scheduled(t, "unlearnSource")).map((job) => job.args[0] as { ragEntryId: string; index?: string });
    expect(jobs).toEqual([expect.objectContaining({ ragEntryId: result.entryId, index: "voyage4", sourceId: id })]);
    await runUnlearns(t);
    await t.action(async (ctx) => {
      expect(await brainV4.getEntry(ctx, { entryId: result.entryId })).toBeNull();
    });
  });

  test("a failed voyage4 erasure keeps its id as evidence in the voyage4 field", async () => {
    const t = setup();
    const id = await source(t, { status: "revoked" });
    await t.mutation(internal.brain.recordUnlearnFailure, {
      ragEntryId: "entry-v4-evidence",
      sourceId: id,
      index: "voyage4",
      attempt: 1,
      error: "temporary failure",
    });
    const after = (await row(t, id))!;
    expect(after.ragEntryIdV4).toBe("entry-v4-evidence");
    expect(after.ragEntryId).toBeUndefined();
    const retry = (await scheduled(t, "unlearnSource")).map((job) => job.args[0]);
    expect(retry).toEqual([expect.objectContaining({ ragEntryId: "entry-v4-evidence", index: "voyage4", attempt: 2 })]);
  });

  test("removing a source for good erases both entries with no bookkeeping", async () => {
    const t = setup();
    const id = await source(t, { status: "revoked", ragEntryId: "e3", ragEntryIdV4: "e4" });
    await t.mutation(internal.brain.removeSourcePermanently, { sourceId: id });
    const jobs = (await scheduled(t, "unlearnSource")).map((job) => job.args[0] as Record<string, unknown>);
    expect(jobs).toEqual([
      { ragEntryId: "e3", index: "voyage3" },
      { ragEntryId: "e4", index: "voyage4" },
    ]);
  });
});

describe("embedSource writes both indexes and pays each model once", () => {
  async function approved(t: T) {
    return await source(t, { content: "Section one about the kiln.\n\nSection two about cold-cycle drift." });
  }

  test("with chunk notes on, the notes are made once for two adds, and usage names each model", async () => {
    vi.stubEnv("BRAIN_CONTEXTUAL", "1");
    const t = setup();
    const id = await approved(t);
    const add3 = vi.spyOn(brain, "add");
    const add4 = vi.spyOn(brainV4, "add");
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    const chunks = notesCreate.mock.calls.length;
    expect(chunks).toBeGreaterThan(0);
    expect(add3).toHaveBeenCalledTimes(1);
    expect(add4).toHaveBeenCalledTimes(1);
    // The same noted chunks go to both indexes.
    const chunksOf = (call: unknown[]) => (call[1] as unknown as { chunks: string[] }).chunks;
    expect(chunksOf(add3.mock.calls[0])).toEqual(chunksOf(add4.mock.calls[0]));
    const after = (await row(t, id))!;
    expect(after.ragEntryId).toBeTruthy();
    expect(after.ragEntryIdV4).toBeTruthy();
    expect(after.chunkNotesVersion).toBe(BRAIN_CHUNK_NOTES_VERSION);
    expect(after.chunkNotesVersionV4).toBe(BRAIN_CHUNK_NOTES_VERSION);
    const usage = (await scheduled(t, "logUsage")).map((job) => job.args[0] as { model: string; callSite: string });
    expect(usage.filter((u) => u.callSite === "brain:corpus_embedding").map((u) => u.model).sort()).toEqual(["voyage-3-large", "voyage-4-large"]);

    // A second embed finds both entries current and pays nothing.
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    expect(notesCreate.mock.calls.length).toBe(chunks);
    expect(add3).toHaveBeenCalledTimes(1);
    expect(add4).toHaveBeenCalledTimes(1);
  });

  test("a voyage4 failure keeps the voyage3 entry; the retry pays neither voyage3 nor the notes again", async () => {
    vi.stubEnv("BRAIN_CONTEXTUAL", "1");
    const t = setup();
    const id = await approved(t);
    vi.mocked(brainEmbeddingModelV4.doEmbed).mockRejectedValueOnce(new Error("voyage 429"));
    await expect(t.action(internal.ai.brain.ingest.embedSource, { sourceId: id })).rejects.toThrow();
    const half = (await row(t, id))!;
    expect(half.ragEntryId).toBeTruthy();
    expect(half.ragEntryIdV4).toBeUndefined();
    const notesPaid = notesCreate.mock.calls.length;

    const add3 = vi.spyOn(brain, "add");
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    expect(add3).not.toHaveBeenCalled();
    expect(notesCreate.mock.calls.length).toBe(notesPaid);
    const after = (await row(t, id))!;
    expect(after.ragEntryIdV4).toBeTruthy();
    expect(after.ragEntryId).toBe(half.ragEntryId);
  });

  test("with notes off, both indexes take the plain text", async () => {
    const t = setup();
    const id = await approved(t);
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    expect(notesCreate).not.toHaveBeenCalled();
    const after = (await row(t, id))!;
    expect(after.ragEntryId).toBeTruthy();
    expect(after.ragEntryIdV4).toBeTruthy();
    expect(after.chunkNotesVersionV4).toBeUndefined();
  });

  test("an entry the source lost track of is added again and recorded (the component replaces it)", async () => {
    const t = setup();
    const id = await approved(t);
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id, indexes: ["voyage4"] });
    const entryId = (await row(t, id))!.ragEntryIdV4!;
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(id))!, { ragEntryIdV4: undefined });
    });
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id, indexes: ["voyage4"] });
    const next = (await row(t, id))!.ragEntryIdV4;
    expect(next).toBeTruthy();
    // The object filter value never compares equal in the component, so it
    // makes a new version and the old one is replaced, not left beside it.
    await t.action(async (ctx) => {
      expect((await brainV4.getEntry(ctx, { entryId: entryId as never }))?.status).toBe("replaced");
      expect((await brainV4.getEntry(ctx, { entryId: next as never }))?.status).toBe("ready");
    });
  });

  test("recordReadyEntry books an unchanged entry like a completion", async () => {
    const t = setup();
    const id = await approved(t);
    await t.mutation(internal.ai.brain.rag.recordReadyEntry, { sourceId: id, index: "voyage4", entryId: "kept-entry", importance: 1, notesVersion: 2 });
    expect(await row(t, id)).toMatchObject({ ragEntryIdV4: "kept-entry", chunkNotesVersionV4: 2 });
    expect((await row(t, id))?.ragEntryId).toBeUndefined();
    const revoked = await source(t, { status: "revoked" });
    await t.mutation(internal.ai.brain.rag.recordReadyEntry, { sourceId: revoked, index: "voyage4", entryId: "late-entry", importance: 1 });
    expect((await row(t, revoked))?.ragEntryIdV4).toBeUndefined();
    expect((await scheduled(t, "unlearnSource")).map((job) => job.args[0])).toEqual([
      { ragEntryId: "late-entry", sourceId: revoked, index: "voyage4" },
    ]);
  });

  test("embedTargets: the serving index first, current entries passed over unless forced, dropped index never", () => {
    const src = { ragEntryId: "e3", ragImportance: 1, writerTier: 0.7, ragEntryIdV4: undefined, chunkNotesVersion: undefined, chunkNotesVersionV4: undefined };
    const both = { serving: "voyage4" as const, written: ["voyage3", "voyage4"] as ("voyage3" | "voyage4")[] };
    expect(embedTargets(src, both, false)).toEqual(["voyage4"]);
    expect(embedTargets(src, both, false, { force: true })).toEqual(["voyage4", "voyage3"]);
    expect(embedTargets(src, both, true)).toEqual(["voyage4", "voyage3"]); // old notes on voyage3
    expect(embedTargets({ ...src, ragImportance: 0.4 }, { ...both, serving: "voyage3" }, false)).toEqual(["voyage3", "voyage4"]);
    expect(embedTargets(src, { serving: "voyage4", written: ["voyage4"] }, false, { indexes: ["voyage3"], force: true })).toEqual([]);
  });
});

describe("buildSearchIndex", () => {
  test("refuses before the card backfill", async () => {
    const t = setup();
    await source(t);
    await expect(t.mutation(internal.brain.buildSearchIndex, {})).rejects.toThrow(/backfillBrainSourceCards/);
  });

  test("queues only sources missing from voyage4, deletes nothing, waits for its page, then counts and records", async () => {
    const t = setup();
    const { Workpool } = await import("@convex-dev/workpool");
    const enqueue = vi.spyOn(Workpool.prototype, "enqueueAction");
    const present = await source(t, { ragEntryId: "e3-a", ragEntryIdV4: "e4-a" });
    const missing = await source(t, { ragEntryId: "e3-b" });
    const failing = await source(t, { ragEntryId: "e3-c" });
    await source(t, { status: "pending" });
    await backfillCards(t);

    expect(await t.mutation(internal.brain.buildSearchIndex, {})).toEqual({
      approved: 3, present: 1, queued: 2, missing: 0, waiting: false, done: false,
    });
    expect(enqueue.mock.calls.map((call) => call[2])).toEqual([
      { sourceId: missing, indexes: ["voyage4"] },
      { sourceId: failing, indexes: ["voyage4"] },
    ]);
    expect(await scheduled(t, "unlearnSource")).toEqual([]);
    void present;

    // The next step waits while its page's embeds are still in the pool.
    const [next] = await scheduled(t, "buildSearchIndex");
    expect(next.scheduledTime - Date.now()).toBeGreaterThan(BUILD_WAIT_MS - 1000);
    const args = next.args[0] as Record<string, unknown>;
    const status = vi.spyOn(Workpool.prototype, "statusBatch").mockResolvedValue([
      { state: "running", previousAttempts: 0 },
      { state: "finished" },
    ] as never);
    expect(await t.mutation(internal.brain.buildSearchIndex, args as never)).toMatchObject({ waiting: true, done: false });

    // Both finished: one got its entry, one failed every retry.
    status.mockResolvedValue([{ state: "finished" }, { state: "finished" }] as never);
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(missing))!, { ragEntryIdV4: "e4-b" });
    });
    expect(await t.mutation(internal.brain.buildSearchIndex, args as never)).toEqual({
      approved: 3, present: 1, queued: 2, missing: 1, waiting: false, done: true,
    });
    const state = await t.run((ctx) => ctx.db.query("brainSearchIndexState").unique());
    expect(state).toMatchObject({ serving: "voyage3", lastBuild: { approved: 3, present: 1, queued: 2, missing: 1 } });
    await expect(t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).rejects.toThrow(/left 1 approved/);

    // Run again: only the failed one is queued; once it lands, nothing is missing.
    enqueue.mockClear();
    await t.mutation(internal.brain.buildSearchIndex, {});
    expect(enqueue.mock.calls.map((call) => (call[2] as { sourceId: string }).sourceId)).toEqual([failing]);
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(failing))!, { ragEntryIdV4: "e4-c" });
    });
    const [again] = await scheduled(t, "buildSearchIndex");
    expect(await t.mutation(internal.brain.buildSearchIndex, again.args[0] as never)).toMatchObject({ missing: 0, done: true });
    enqueue.mockClear();
    expect(await t.mutation(internal.brain.buildSearchIndex, {})).toEqual({
      approved: 3, present: 3, queued: 0, missing: 0, waiting: false, done: true,
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).toMatchObject({ changed: true });
  });

  test("pages past one page of approved cards", async () => {
    const t = setup();
    for (let i = 0; i < BUILD_PAGE_SIZE + 3; i++) await source(t, { ragEntryIdV4: `e4-${i}` });
    await backfillCards(t);
    expect(await t.mutation(internal.brain.buildSearchIndex, {})).toMatchObject({ approved: BUILD_PAGE_SIZE, done: false });
    const [next] = await scheduled(t, "buildSearchIndex");
    expect(await t.mutation(internal.brain.buildSearchIndex, next.args[0] as never)).toMatchObject({
      approved: BUILD_PAGE_SIZE + 3, present: BUILD_PAGE_SIZE + 3, done: true,
    });
  });
});

describe("the older re-embed jobs and the drop", () => {
  test("requeue and the importance re-embed touch voyage3 only", async () => {
    const t = setup();
    const { Workpool } = await import("@convex-dev/workpool");
    const enqueue = vi.spyOn(Workpool.prototype, "enqueueAction");
    const id = await source(t, { ragEntryId: "e3", writerTier: 0.4, ragEntryIdV4: "e4" });
    await backfillCards(t);
    await t.mutation(internal.brain.requeueAllApprovedEmbeds, {});
    expect(enqueue.mock.calls.map((call) => call[2])).toEqual([{ sourceId: id, indexes: ["voyage3"], force: true }]);
    expect((await scheduled(t, "unlearnSource")).map((job) => job.args[0])).toEqual([{ ragEntryId: "e3", index: "voyage3" }]);
    enqueue.mockClear();
    await t.mutation(internal.brain.reembedBelowFullImportance, {});
    expect(enqueue.mock.calls.map((call) => call[2])).toEqual([{ sourceId: id, indexes: ["voyage3"] }]);
  });

  test("the drop needs voyage4 serving, stops voyage3 writes and rollback, and erases voyage3 entries only", async () => {
    const t = setup();
    const id = await source(t);
    await addTo(t, brain, "brain", id, 0.6, 2);
    await addTo(t, brainV4, "brain-v4", id, 0.6, 3);
    // A revoked source whose voyage3 erasure failed still holds its id.
    const revoked = await source(t);
    const evidence = (await addTo(t, brain, "brain", revoked, 0.5, 5)).entryId;
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(revoked))!, { status: "revoked" });
    });
    await backfillCards(t);
    await expect(t.mutation(internal.brain.dropOldSearchIndex, { confirm: "drop voyage3" })).rejects.toThrow(/Move it to voyage4 first/);
    await t.run((ctx) =>
      ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 })
    );
    expect(await t.mutation(internal.brain.dropOldSearchIndex, { confirm: "drop voyage3", actor: "owner" })).toEqual({ queued: 2, done: true });
    const before = (await row(t, id))!;
    const jobs = (await scheduled(t, "unlearnSource")).map((job) => job.args[0]);
    expect(jobs).toEqual([
      { ragEntryId: before.ragEntryId, sourceId: id, index: "voyage3", droppedIndex: true },
      { ragEntryId: evidence, sourceId: revoked, index: "voyage3" },
    ]);
    await runUnlearns(t);
    const after = (await row(t, id))!;
    expect(after.status).toBe("approved");
    expect(after.ragEntryId).toBeUndefined();
    expect(after.ragEntryIdV4).toBe(before.ragEntryIdV4);
    expect(await t.query(internal.brain.servingSearchIndex, {})).toEqual({ serving: "voyage4", oldIndexDropped: true });
    await expect(t.mutation(internal.brain.setServingSearchIndex, { index: "voyage3" })).rejects.toThrow(/being dropped/);
    await expect(t.mutation(internal.brain.reembedBelowFullImportance, {})).rejects.toThrow(/being dropped/);
    await expect(t.mutation(internal.brain.requeueAllApprovedEmbeds, {})).rejects.toThrow(/being dropped/);

    // From now an embed writes voyage4 only.
    const add3 = vi.spyOn(brain, "add");
    const fresh = await source(t);
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: fresh });
    expect(add3).not.toHaveBeenCalled();
    expect((await row(t, fresh))?.ragEntryIdV4).toBeTruthy();

    // A voyage3 completion that started before the drop is erased, not recorded.
    const late = await source(t);
    await addTo(t, brain, "brain", late, 0.6, 4);
    expect((await row(t, late))?.ragEntryId).toBeUndefined();
    expect((await scheduled(t, "unlearnSource")).map((job) => job.args[0])).toEqual([
      expect.objectContaining({ sourceId: late, index: "voyage3", droppedIndex: true }),
    ]);

    // Then the namespace goes, with whatever is left in it.
    await runUnlearns(t);
    expect(await t.action(internal.brain.deleteOldSearchNamespace, {})).toEqual({ deleted: true });
    await t.action(async (ctx) => {
      expect(await brain.getNamespace(ctx, { namespace: "brain" })).toBeNull();
    });
  });

  test("a reweight re-embeds a voyage3 entry at an old importance only while voyage3 is written", async () => {
    const t = setup();
    const admin = await withAdmin(t);
    const { Workpool } = await import("@convex-dev/workpool");
    const enqueue = vi.spyOn(Workpool.prototype, "enqueueAction");
    const id = await source(t, { ragEntryId: "e3", writerTier: 0.4, ragEntryIdV4: "e4" });
    await admin.mutation(api.brain.reweightSource, { sourceId: id, writerTier: 0.9 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    await t.run((ctx) =>
      ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", oldIndexDropped: true, changedBy: "test", changedAt: 1 })
    );
    enqueue.mockClear();
    const other = await source(t, { ragEntryId: "e3-x", writerTier: 0.4, ragEntryIdV4: "e4-x" });
    await admin.mutation(api.brain.reweightSource, { sourceId: other, writerTier: 0.9 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("the admin list's in-brain flag follows the serving index", async () => {
    const t = setup();
    const admin = await withAdmin(t);
    await source(t, { ragEntryId: "e3" });
    const list = () => admin.query(api.brain.listBrainSources, { paginationOpts: { cursor: null, numItems: 10 } });
    expect((await list()).page.map((r) => r.hasEntry)).toEqual([true]);
    await t.run((ctx) =>
      ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 })
    );
    expect((await list()).page.map((r) => r.hasEntry)).toEqual([false]);
  });
});

describe("calibrateSearchIndexes", () => {
  test("reports both indexes and both rerankers, suggests floors, and writes nothing", async () => {
    const t = setup();
    const ids = [await source(t, { scienceCode: "2.02.09" }), await source(t, { scienceCode: "2.02.09" }), await source(t)];
    for (const [i, id] of ids.entries()) {
      await addTo(t, brain, "brain", id, 0.5 + i * 0.1, 2 + i);
      await addTo(t, brainV4, "brain-v4", id, 0.6 + i * 0.1, 10 + i);
    }
    await backfillCards(t);
    vi.spyOn(brainRerankModel, "doRerank").mockImplementation(async ({ documents }) => ({
      ranking: (documents as unknown as { values: unknown[] }).values.map((_, index) => ({ index, relevanceScore: 0.5 - index * 0.1 })),
      response: { body: { usage: { total_tokens: 5 } } },
    }) as never);
    vi.spyOn(brainRerankModelV4, "doRerank").mockImplementation(async ({ documents }) => ({
      ranking: (documents as unknown as { values: unknown[] }).values.map((_, index) => ({ index, relevanceScore: 0.7 - index * 0.1 })),
      response: { body: { usage: { total_tokens: 6 } } },
    }) as never);
    const snapshot = () =>
      t.run(async (ctx) => ({
        audit: (await ctx.db.query("brainAuditLog").collect()).length,
        state: (await ctx.db.query("brainSearchIndexState").collect()).length,
        sources: (await ctx.db.query("brainSources").collect()).map((s) => s._id + s.ragEntryId + s.ragEntryIdV4),
        scheduled: (await ctx.db.system.query("_scheduled_functions").collect()).length,
      }));
    const before = await snapshot();
    const report = await t.action(internal.brain.calibrateSearchIndexes, { probes: 3 });
    expect(await snapshot()).toEqual(before);
    expect(report.probes).toBe(3);
    expect(report.search.voyage3.ownEntry.count).toBe(3);
    expect(report.search.voyage4.ownEntry.count).toBe(3);
    expect(report.search.voyage4.embeddingModelId).toBe("voyage-4-large");
    expect(report.search.suggestedVoyage4Floor).not.toBeNull();
    expect(report.rerank.next.modelId).toBe("rerank-3");
    expect(report.rerank.suggestedRerank3Floor).not.toBeNull();
    expect(report.rerank.atProvisionalFloor.served).toBeGreaterThan(0);
    expect(report.tokens.rerank4).toBeGreaterThan(0);
    // No query text and no title reaches the log.
    const logged = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toMatch(/kiln|Past PD/);
  });

  test("refuses with no source in both indexes", async () => {
    const t = setup();
    await source(t, { ragEntryId: "e3" });
    await backfillCards(t);
    await expect(t.action(internal.brain.calibrateSearchIndexes, {})).rejects.toThrow(/buildSearchIndex first/);
  });
});
