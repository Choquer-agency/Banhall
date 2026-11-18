/// <reference types="vite/client" />
// 2026-11-18 (fourth): the Brain moves to Voyage 4 through a second search
// index and a stored pointer. These run the real RAG component in
// convex-test with only Voyage's models stubbed (the HTTP boundary has its
// own test in convex/ai/brain/voyageBoundary.test.ts). Every company and
// passage here is made up.
import { convexTest } from "convex-test";
import { APICallError } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  brain,
  brainV4,
  BRAIN_CHUNK_NOTES_VERSION,
  BRAIN_ENTRY_IMPORTANCE,
  INDEX_WRITE_LEASE_MS,
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
import { embedTargets, reusableNoteChunks } from "./ai/brain/ingest";
import { searchBrainExemplars } from "./ai/brain/retrieve";
import { BUILD_PAGE_SIZE, BUILD_WAIT_MS, MOVE_CHECK_BUDGET } from "./brain";
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

    await backfillCards(t);
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
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4", actor: "owner" })).toEqual({ serving: "voyage4", changed: true, checked: 1 });
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

  test("the live guard: refused at the first approved source not current in the target, and while a build runs; force skips it", async () => {
    const t = setup();
    const a = await source(t, { ragEntryId: "e3-a", ragImportance: 1, ragEntryIdV4: "e4-a" });
    const b = await source(t, { ragEntryId: "e3-b", ragImportance: 1 });
    await source(t, { status: "pending" });
    await backfillCards(t);
    const move = (index: "voyage3" | "voyage4", extra: Record<string, unknown> = {}) =>
      t.mutation(internal.brain.setServingSearchIndex, { index, actor: "owner", ...extra });

    // voyage4 is refused while one approved source has no voyage4 entry, though no build ever ran.
    expect(await move("voyage4")).toEqual({
      serving: "voyage3",
      changed: false,
      checked: 2,
      message: `Not moved: approved source ${b} has no current voyage4 entry (no entry). Run brain:buildSearchIndex to the end, then move the pointer again.`,
    });
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(b))!, { ragEntryIdV4: "e4-b" });
    });
    expect(await move("voyage4")).toMatchObject({ serving: "voyage4", changed: true, checked: 2 });

    // The rollback index must be as good: an old weight's importance, then old notes, refuse it.
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(a))!, { ragImportance: 0.4 });
    });
    expect((await move("voyage3")).message).toBe(
      `Not moved: approved source ${a} has no current voyage3 entry (an old weight's importance). Run brain:buildSearchIndex with {"index":"voyage3"} to the end, then move the pointer again.`
    );
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(a))!, { ragImportance: 1 });
    });
    vi.stubEnv("BRAIN_CONTEXTUAL", "1");
    expect((await move("voyage3")).message).toMatch(/no current voyage3 entry \(notes from an older prompt\)/);
    vi.stubEnv("BRAIN_CONTEXTUAL", "");

    // Not while a build pass runs, unless forced.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("brainSearchIndexState").unique();
      await ctx.db.patch(row!._id, { buildRunning: { startedAt: 1 } });
    });
    await expect(move("voyage3")).rejects.toThrow("A build pass is running.");
    expect(await move("voyage3", { force: true, reason: "emergency" })).toMatchObject({ serving: "voyage3", changed: true });
    expect(await move("voyage3")).toEqual({ serving: "voyage3", changed: false, checked: 0 });
    const reasons = (await t.run((ctx) => ctx.db.query("brainAuditLog").collect()))
      .filter((r) => r.action === "switch_index")
      .map((r) => r.reason);
    expect(reasons).toEqual([
      "Search moved from voyage3 (voyage-3-large) to voyage4 (voyage-4-large)",
      "Search moved from voyage4 (voyage-4-large) to voyage3 (voyage-3-large), forced: emergency",
    ]);
  });

  test("a check longer than one call keeps its place, and the next call goes on from there", async () => {
    const t = setup();
    // Cards alone: the check reads only cards. One more than a call checks.
    const total = MOVE_CHECK_BUDGET + 1;
    for (let start = 0; start < total; start += 1000) {
      await t.run(async (ctx) => {
        for (let i = start; i < Math.min(total, start + 1000); i++) {
          const sourceId = await ctx.db.insert("brainSources", {
            kind: "pd_pair", status: "approved", title: "x", industry: "manufacturing", writerTier: 1, docType: "pd",
            content: "x", ragKey: `k-${i}`, sourceHash: `h-${i}`, createdBy: "test", createdAt: i,
          });
          await ctx.db.insert("brainSourceCards", {
            sourceId, kind: "pd_pair", status: "approved", title: "x", industry: "manufacturing", writerTier: 1,
            docType: "pd", createdAt: i, ragEntryId: `e3-${i}`, ragImportance: 1, ragEntryIdV4: `e4-${i}`,
          });
        }
      });
    }
    await t.run((ctx) => ctx.db.insert("brainSourceCounts", { scope: "meta", key: "cards_ready", count: total }));
    const first = await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" });
    expect(first).toEqual({
      serving: "voyage3",
      changed: false,
      checked: MOVE_CHECK_BUDGET,
      message: `Not moved yet: checked ${MOVE_CHECK_BUDGET} approved sources so far and every one has a current voyage4 entry. Run this again to check the rest.`,
    });
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).toMatchObject({
      serving: "voyage4",
      changed: true,
      checked: total,
    });
    expect((await t.run((ctx) => ctx.db.query("brainSearchIndexState").unique()))?.moveCheck).toBeUndefined();
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

  test("with no index it queues one embed per source not current in either, deletes nothing, waits for its page, then counts and records", async () => {
    const t = setup();
    const { Workpool } = await import("@convex-dev/workpool");
    const enqueue = vi.spyOn(Workpool.prototype, "enqueueAction");
    await source(t, { ragEntryId: "e3-a", ragImportance: 1, ragEntryIdV4: "e4-a" });
    const missing = await source(t, { ragEntryId: "e3-b", ragImportance: 1 });
    // voyage4 is there, but voyage3 still carries an old weight as importance.
    const oldTier = await source(t, { ragEntryId: "e3-c", ragEntryIdV4: "e4-c", writerTier: 0.7 });
    await source(t, { status: "pending" });
    await backfillCards(t);

    expect(await t.mutation(internal.brain.buildSearchIndex, {})).toEqual({
      approved: 3, present: 1, queued: 2, missing: 0, waiting: false, done: false,
    });
    // One embed each, for every index it needs: the notes would be made once.
    expect(enqueue.mock.calls.map((call) => call[2])).toEqual([{ sourceId: missing }, { sourceId: oldTier }]);
    expect(await scheduled(t, "unlearnSource")).toEqual([]);
    expect((await t.run((ctx) => ctx.db.query("brainSearchIndexState").unique()))?.buildRunning).toBeTruthy();

    // The next step waits while its page's embeds are still in the pool.
    const [next] = await scheduled(t, "buildSearchIndex");
    expect(next.scheduledTime - Date.now()).toBeGreaterThan(BUILD_WAIT_MS - 1000);
    const args = next.args[0] as Record<string, unknown>;
    const status = vi.spyOn(Workpool.prototype, "statusBatch").mockResolvedValue([
      { state: "running", previousAttempts: 0 },
      { state: "finished" },
    ] as never);
    expect(await t.mutation(internal.brain.buildSearchIndex, args as never)).toMatchObject({ waiting: true, done: false });
    // A second start is refused while the pass runs, and so is the pointer.
    await expect(t.mutation(internal.brain.buildSearchIndex, {})).rejects.toThrow(/already running/);
    await expect(t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).rejects.toThrow(/build pass is running/);

    // Both finished: the missing one got its voyage4 entry; the old-tier one failed every retry.
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
    expect(state?.buildRunning).toBeUndefined();
    // voyage4 is whole, so the cutover goes; the rollback index is not, so moving back is refused.
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).toMatchObject({ changed: true });
    expect((await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage3" })).message).toContain(`${oldTier} has no current voyage3 entry (importance not recorded)`);

    // Run again: only the failed one is queued; once it lands, nothing is missing and the rollback goes.
    enqueue.mockClear();
    await t.mutation(internal.brain.buildSearchIndex, {});
    expect(enqueue.mock.calls.map((call) => call[2])).toEqual([{ sourceId: oldTier }]);
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(oldTier))!, { ragImportance: 1 });
    });
    const [again] = await scheduled(t, "buildSearchIndex");
    expect(await t.mutation(internal.brain.buildSearchIndex, again.args[0] as never)).toMatchObject({ missing: 0, done: true });
    enqueue.mockClear();
    expect(await t.mutation(internal.brain.buildSearchIndex, {})).toEqual({
      approved: 3, present: 3, queued: 0, missing: 0, waiting: false, done: true,
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage3" })).toMatchObject({ changed: true });
  });

  test("with an index it fills only that one: after the cutover a voyage3 gap is filled without deleting anything", async () => {
    const t = setup();
    const { Workpool } = await import("@convex-dev/workpool");
    const enqueue = vi.spyOn(Workpool.prototype, "enqueueAction");
    await source(t, { ragEntryId: "e3-a", ragImportance: 1, ragEntryIdV4: "e4-a" });
    // Its voyage3 add failed every retry after the cutover.
    const gap = await source(t, { ragEntryIdV4: "e4-b" });
    await backfillCards(t);
    await t.run((ctx) => ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 }));
    expect((await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage3" })).message).toContain(`${gap} has no current voyage3 entry (no entry)`);
    expect(await t.mutation(internal.brain.buildSearchIndex, { index: "voyage3" })).toMatchObject({ approved: 2, present: 1, queued: 1 });
    expect(enqueue.mock.calls.map((call) => call[2])).toEqual([{ sourceId: gap, indexes: ["voyage3"] }]);
    expect(await scheduled(t, "unlearnSource")).toEqual([]);
    await expect(t.mutation(internal.brain.buildSearchIndex, { index: "voyage4" })).rejects.toThrow(/already running/);
  });

  test("restart takes over a pass that stopped; the old pass's next step stops", async () => {
    const t = setup();
    await source(t, { ragEntryId: "e3-b", ragImportance: 1 });
    await backfillCards(t);
    await t.mutation(internal.brain.buildSearchIndex, {});
    const [stale] = await scheduled(t, "buildSearchIndex");
    await t.run((ctx) => ctx.scheduler.cancel(stale._id));
    vi.setSystemTime(Date.now() + 60_000);
    expect(await t.mutation(internal.brain.buildSearchIndex, { restart: true })).toMatchObject({ queued: 1, done: false });
    const { Workpool } = await import("@convex-dev/workpool");
    vi.spyOn(Workpool.prototype, "statusBatch").mockResolvedValue([{ state: "finished" }] as never);
    // The old pass's step finds another pass running and stops without writing.
    expect(await t.mutation(internal.brain.buildSearchIndex, stale.args[0] as never)).toMatchObject({ done: false, waiting: false });
    expect((await t.run((ctx) => ctx.db.query("brainSearchIndexState").unique()))?.lastBuild).toBeUndefined();
  });

  test("pages past one page of approved cards", async () => {
    const t = setup();
    for (let i = 0; i < BUILD_PAGE_SIZE + 3; i++) await source(t, { ragEntryId: `e3-${i}`, ragImportance: 1, ragEntryIdV4: `e4-${i}` });
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
    expect((await scheduled(t, "unlearnSource")).map((job) => job.args[0])).toEqual([{ ragEntryId: "e3", sourceId: id, index: "voyage3", requeued: true }]);
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
      ctx.db.insert("brainSearchIndexState", {
        key: "search", serving: "voyage4", servingSince: 1, changedBy: "test", changedAt: 1,
        lastCalibration: { at: 2, probes: 20, serving: "voyage4" },
      })
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
    // Its one write is the record that it ran (final review P2-2): the state row, nothing else.
    expect(await snapshot()).toEqual({ ...before, state: 1 });
    expect((await t.run((ctx) => ctx.db.query("brainSearchIndexState").unique()))?.lastCalibration).toMatchObject({ probes: 3, serving: "voyage3" });
    expect(report.probes).toBe(3);
    expect(report.thin).toBe(true);
    expect(report.note).toBe("Only 3 probes: not a basis for a floor. Keep the provisional floors and run this again after the first few hundred Brain checks.");
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

describe("review 51 fixes", () => {
  test("a pool retry uses the notes the failed attempt kept, and they are dropped once every add lands", async () => {
    vi.stubEnv("BRAIN_CONTEXTUAL", "1");
    const t = setup();
    const id = await source(t, { content: "Section one about the kiln.\n\nSection two about cold-cycle drift." });
    // voyage4 serves, so it is added first and fails before voyage3 has an entry to reuse.
    await t.run((ctx) => ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 }));
    vi.mocked(brainEmbeddingModelV4.doEmbed).mockRejectedValueOnce(new Error("voyage 429"));
    await expect(t.action(internal.ai.brain.ingest.embedSource, { sourceId: id })).rejects.toThrow();
    const paid = notesCreate.mock.calls.length;
    expect(paid).toBeGreaterThan(0);
    expect(await t.run((ctx) => ctx.db.query("brainChunkNotes").collect())).toHaveLength(1);
    expect((await row(t, id))?.ragEntryIdV4).toBeUndefined();

    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    expect(notesCreate.mock.calls.length).toBe(paid);
    const after = (await row(t, id))!;
    expect(after.ragEntryIdV4).toBeTruthy();
    expect(after.ragEntryId).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.query("brainChunkNotes").collect())).toEqual([]);
  });

  test("reusableNoteChunks returns null when the other index's chunks do not match, and the notes are made again", async () => {
    vi.stubEnv("BRAIN_CONTEXTUAL", "1");
    const t = setup();
    const id = await source(t, { content: "Section one about the kiln.\n\nSection two about cold-cycle drift." });
    // A voyage3 entry whose chunk text is not this source's text, recorded with current notes.
    const entryId = (await addTo(t, brain, "brain", id, 0.6, 2)).entryId;
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(id))!, { chunkNotesVersion: BRAIN_CHUNK_NOTES_VERSION });
    });
    const { defaultChunker } = await import("@convex-dev/rag");
    const raw = defaultChunker((await row(t, id))!.content);
    expect(await t.action((ctx: ActionCtx) => reusableNoteChunks(ctx, "voyage3", entryId, raw))).toBeNull();
    expect(await t.action((ctx: ActionCtx) => reusableNoteChunks(ctx, "voyage3", entryId, [...raw, "one more"]))).toBeNull();
    expect(await t.action((ctx: ActionCtx) => reusableNoteChunks(ctx, "voyage3", "not-there" as never, raw).catch(() => null))).toBeNull();

    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id, indexes: ["voyage4"] });
    expect(notesCreate).toHaveBeenCalledTimes(raw.length);
    expect((await row(t, id))?.ragEntryIdV4).toBeTruthy();
  });

  test("a large document goes through the component's batched path in both indexes", async () => {
    const t = setup();
    const content = Array.from({ length: 130 }, (_, i) => `Paragraph ${i}: ${"kiln drift under cold cycles ".repeat(25)}`).join("\n\n");
    const id = await source(t, { content });
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    const after = (await row(t, id))!;
    expect(after.ragEntryId).toBeTruthy();
    expect(after.ragEntryIdV4).toBeTruthy();
    await t.action(async (ctx) => {
      for (const [rag, entryId] of [[brain, after.ragEntryId], [brainV4, after.ragEntryIdV4]] as const) {
        expect((await rag.getEntry(ctx, { entryId: entryId as never }))?.status).toBe("ready");
        const chunks = await rag.listChunks(ctx, { entryId: entryId as never, paginationOpts: { cursor: null, numItems: 500 } });
        expect(chunks.page.length).toBeGreaterThanOrEqual(100);
        expect(chunks.page.every((chunk) => chunk.state === "ready")).toBe(true);
      }
    });
  });

  test("an embed in flight across the drop never makes the voyage3 namespace again, and the delete waits for live adds", async () => {
    const t = setup();
    const id = await source(t);
    await t.run((ctx) => ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 }));
    // The drop starts while this embed is adding to voyage4 (it read the state before).
    const realAdd = brainV4.add.bind(brainV4);
    vi.spyOn(brainV4, "add").mockImplementation(async (ctx, args) => {
      await t.run(async (inner) => {
        const row = await inner.db.query("brainSearchIndexState").unique();
        await inner.db.patch(row!._id, { oldIndexDropped: true });
      });
      return await realAdd(ctx, args as never);
    });
    const add3 = vi.spyOn(brain, "add");
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    expect(add3).not.toHaveBeenCalled();
    await t.action(async (ctx) => {
      expect(await brain.getNamespace(ctx, { namespace: "brain" })).toBeNull();
    });
    expect(await t.mutation(internal.ai.brain.rag.beginIndexWrite, { sourceId: id, index: "voyage3" })).toBeNull();

    // An add to voyage3 that began before the drop holds a lease: the delete waits for it.
    const lease = await t.run((ctx) => ctx.db.insert("brainIndexWrites", { index: "voyage3", sourceId: id, startedAt: Date.now() }));
    await expect(t.action(internal.brain.deleteOldSearchNamespace, {})).rejects.toThrow(/still adding to the voyage3 index/);
    // A lease older than an action can run is stale.
    await t.run((ctx) => ctx.db.patch(lease, { startedAt: Date.now() - INDEX_WRITE_LEASE_MS - 1 }));
    expect(await t.action(internal.brain.deleteOldSearchNamespace, {})).toEqual({ deleted: false });
  });

  test("a drop erasure that gives up is logged, and the namespace delete clears the id it left", async () => {
    const t = setup();
    const id = await source(t);
    await addTo(t, brain, "brain", id, 0.6, 2);
    await addTo(t, brainV4, "brain-v4", id, 0.6, 3);
    const entryId = (await row(t, id))!.ragEntryId!;
    await backfillCards(t);
    await t.run((ctx) =>
      ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", oldIndexDropped: true, changedBy: "test", changedAt: 1 })
    );
    const errors = vi.mocked(console.error);
    await t.mutation(internal.brain.recordUnlearnFailure, {
      ragEntryId: entryId, sourceId: id, index: "voyage3", droppedIndex: true, attempt: 5, error: "still failing",
    });
    expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).toContain(`erasing voyage3 entry ${entryId} of source ${id} failed 5 times`);
    expect(await scheduled(t, "unlearnSource")).toEqual([]);
    expect((await row(t, id))?.ragEntryId).toBe(entryId);

    expect(await t.action(internal.brain.deleteOldSearchNamespace, {})).toEqual({ deleted: true });
    expect((await scheduled(t, "unlearnSource")).map((job) => job.args[0])).toEqual([
      { ragEntryId: entryId, sourceId: id, index: "voyage3", droppedIndex: true },
    ]);
    await runUnlearns(t);
    const after = (await row(t, id))!;
    expect(after.ragEntryId).toBeUndefined();
    expect(after.ragEntryIdV4).toBeTruthy();
    expect(after.status).toBe("approved");
  });

  test("ingestOnComplete records nothing for a namespace that is not a Brain index", async () => {
    const t = setup();
    const id = await source(t);
    const src = (await row(t, id))!;
    await t.mutation(internal.ai.brain.rag.ingestOnComplete, {
      namespace: {
        namespaceId: "ns_other" as never, createdAt: 1, namespace: "cra-letters", status: "ready",
        filterNames: [], dimension: 1024, modelId: "voyage-4-large", version: 0,
      },
      entry: {
        key: src.ragKey, title: src.title, metadata: { sourceId: id }, entryId: "entry_other" as never, importance: 1,
        filterValues: [], contentHash: "h", status: "ready",
      },
    });
    const after = (await row(t, id))!;
    expect(after.ragEntryId).toBeUndefined();
    expect(after.ragEntryIdV4).toBeUndefined();
    expect(await scheduled(t, "unlearnSource")).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).toEqual([]);
  });

  test("calibration rides out a rerank 429", async () => {
    const t = setup();
    for (const [i, id] of [await source(t), await source(t)].entries()) {
      await addTo(t, brain, "brain", id, 0.5 + i * 0.1, 2 + i);
      await addTo(t, brainV4, "brain-v4", id, 0.6 + i * 0.1, 10 + i);
    }
    await backfillCards(t);
    const ok = async ({ documents }: { documents: { values: unknown[] } }) =>
      ({ ranking: documents.values.map((_, index) => ({ index, relevanceScore: 0.5 })), response: { body: {} } }) as never;
    vi.spyOn(brainRerankModel, "doRerank").mockImplementation(ok as never);
    const tooMany = () =>
      new APICallError({
        message: "rate limited",
        url: "https://api.voyageai.com/v1/rerank",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "retry-after-ms": "1" },
      });
    const next = vi.spyOn(brainRerankModelV4, "doRerank")
      .mockRejectedValueOnce(tooMany())
      .mockRejectedValueOnce(tooMany())
      .mockImplementation(ok as never);
    vi.useRealTimers();
    const report = await t.action(internal.brain.calibrateSearchIndexes, { probes: 2 });
    expect(report.probes).toBe(2);
    expect(next.mock.calls.length).toBeGreaterThan(2);
  });
});

describe("PR #51 Greptile fixes", () => {
  test("the pointer refuses to move, either way, before the card backfill has run to its end", async () => {
    const t = setup();
    await source(t, { ragEntryId: "e3", ragImportance: 1, ragEntryIdV4: "e4" });
    // No cards yet: an empty table must not read as every source current.
    await expect(t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).rejects.toThrow(/backfillBrainSourceCards/);
    await t.run((ctx) => ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 }));
    await expect(t.mutation(internal.brain.setServingSearchIndex, { index: "voyage3" })).rejects.toThrow(/backfillBrainSourceCards/);
    // A deliberate forced move skips it; after the backfill the live check runs.
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage3", force: true })).toMatchObject({ changed: true });
    await backfillCards(t);
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).toMatchObject({ changed: true, checked: 1 });
  });

  /** A legacy voyage3 entry made at importance 0.7, before importances were recorded. */
  async function legacySource(t: T, extra: Partial<Doc<"brainSources">> = {}) {
    const id = await source(t, { writerTier: 0.7, ...extra });
    const src = (await row(t, id))!;
    const { entryId } = await t.action(async (ctx) =>
      brain.add(ctx, {
        namespace: "brain",
        key: src.ragKey,
        title: src.title,
        importance: 0.7,
        metadata: { sourceId: id, industry: src.industry, writerTier: 0.7, docType: src.docType },
        filterValues: [
          { name: "industryApproved", value: { industry: src.industry, approved: true } },
          { name: "docType", value: src.docType },
        ],
        chunks: [{ text: src.content, embedding: vectorAt(0.6, 2) }],
      })
    );
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./ai/brain/rag");
      await patchBrainSource(ctx, (await ctx.db.get(id))!, { ragEntryId: entryId, ragEntryIdV4: "e4-legacy" });
    });
    return { id, entryId };
  }

  async function expectRefreshedAtOne(t: T, id: Id<"brainSources">, oldEntryId: string) {
    const after = (await row(t, id))!;
    expect(after.ragImportance).toBe(1);
    expect(after.ragEntryId).not.toBe(oldEntryId);
    await t.action(async (ctx) => {
      expect((await brain.getEntry(ctx, { entryId: after.ragEntryId as never }))?.importance).toBe(1);
    });
    // A later build finds it current and queues nothing.
    await backfillCards(t);
    expect(await t.mutation(internal.brain.buildSearchIndex, { index: "voyage3" })).toMatchObject({ queued: 0, done: true });
  }

  for (const notes of [false, true]) {
    test(`a reweight to 1 of a legacy entry refreshes its voyage3 vectors at importance 1 (notes ${notes ? "on" : "off"})`, async () => {
      if (notes) vi.stubEnv("BRAIN_CONTEXTUAL", "1");
      const t = setup();
      const admin = await withAdmin(t);
      const { id, entryId } = await legacySource(t, notes ? { chunkNotesVersion: BRAIN_CHUNK_NOTES_VERSION } : {});
      const { Workpool } = await import("@convex-dev/workpool");
      const enqueue = vi.spyOn(Workpool.prototype, "enqueueAction");
      // The tier is 1 by the time the embed reads the row.
      await admin.mutation(api.brain.reweightSource, { sourceId: id, writerTier: 1 });
      expect(enqueue.mock.calls.map((call) => call[2])).toEqual([{ sourceId: id }]);
      const add3 = vi.spyOn(brain, "add");
      await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
      expect(add3).toHaveBeenCalledTimes(1);
      await expectRefreshedAtOne(t, id, entryId);
    });

    test(`an edit after approval (and the re-tier job) that raises the tier refreshes a legacy entry too (notes ${notes ? "on" : "off"})`, async () => {
      if (notes) vi.stubEnv("BRAIN_CONTEXTUAL", "1");
      const t = setup();
      const { id, entryId } = await legacySource(t, notes ? { chunkNotesVersion: BRAIN_CHUNK_NOTES_VERSION } : {});
      const { relabelImportedSource } = await import("./brain");
      const result = await t.run(async (ctx) => relabelImportedSource(ctx, (await ctx.db.get(id))!, { writerTier: 1 }, "admin"));
      expect(result).toEqual({ changed: true, reembed: true });
      await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
      await expectRefreshedAtOne(t, id, entryId);
    });
  }
});

describe("final review of #48 to #51", () => {
  test("P2-1: the build waits for every unknown-origin old-page copy to be decided; Keep and revoke decide it", async () => {
    const t = setup();
    const admin = await withAdmin(t);
    const unknown = await source(t, { ragEntryId: "e3-u", ragImportance: 1, ragEntryIdV4: "e4-u" });
    const unlink = await source(t, { ragEntryId: "e3-l", ragImportance: 1, ragEntryIdV4: "e4-l" });
    const gone = await source(t, { status: "revoked" });
    await backfillCards(t);
    const itemId = await t.run((ctx) =>
      ctx.db.insert("ingestionItems", {
        driveItemId: "drive-old", path: "old/old.docx", name: "old.docx", docKind: "pd", size: 1, lastModifiedAt: 1,
        contentHash: "h-old", status: "pending_review", pairGroupKey: "old", updatedAt: 1,
      })
    );
    const { recordOldPageCopy } = await import("./brain");
    await t.run(async (ctx) => {
      await recordOldPageCopy(ctx, { sourceId: unknown, itemId, outcome: "unknown_origin", detail: "no_approval_time" });
      await recordOldPageCopy(ctx, { sourceId: unknown, itemId, outcome: "unknown_origin", detail: "no_approval_time" });
      await recordOldPageCopy(ctx, { sourceId: unlink, itemId, outcome: "unlink_only", detail: "made_before_this_approval" });
      // A copy no longer approved needs no decision.
      await recordOldPageCopy(ctx, { sourceId: gone, itemId, outcome: "unknown_origin", detail: "creator_or_time_differs" });
    });
    const listed = await admin.query(api.brain.listOldPageCopies, {});
    expect(listed?.copies.map((c) => [c.sourceId, c.outcome])).toEqual([[unknown, "unknown_origin"], [unlink, "unlink_only"]]);
    expect(await t.query(api.brain.listOldPageCopies, {})).toBeNull();

    await expect(t.mutation(internal.brain.buildSearchIndex, {})).rejects.toThrow(/still undecided/);
    // The owner may start anyway, on purpose.
    expect(await t.mutation(internal.brain.buildSearchIndex, { allowUnknownOrigin: true })).toMatchObject({ approved: 2 });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("brainSearchIndexState").unique();
      await ctx.db.patch(row!._id, { buildRunning: undefined });
    });

    // Keep decides it, once, with an audit row; an unlink-only copy never held the build.
    await admin.mutation(api.brain.keepOldPageCopy, { sourceId: unknown });
    await expect(admin.mutation(api.brain.keepOldPageCopy, { sourceId: unknown })).rejects.toThrow("This copy is already decided.");
    expect(await t.mutation(internal.brain.buildSearchIndex, {})).toMatchObject({ approved: 2 });
    const audit = (await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).filter((a) => a.action === "keep_old_page_copy");
    expect(audit).toHaveLength(1);

    // A revoke on /admin/brain decides it as removed.
    await admin.mutation(api.brain.revokeSource, { sourceId: unlink, reason: "Old page copy removed after review" });
    const rows = await t.run((ctx) => ctx.db.query("brainOldPageCopies").collect());
    expect(rows.map((r) => [r.sourceId, r.status]).sort()).toEqual([[unknown, "kept"], [unlink, "removed"]].sort());
    expect((await admin.query(api.brain.listOldPageCopies, {}))?.copies).toEqual([]);
  });

  test("P2-2: calibration records its run, says when the Brain is empty, and the drop waits for a report after the cutover", async () => {
    const t = setup();
    await backfillCards(t);
    await expect(t.action(internal.brain.calibrateSearchIndexes, {})).rejects.toThrow(
      "The Brain has no approved source yet, so there is nothing to calibrate. Keep the provisional floors, move the pointer, and run this again after the first few hundred Brain checks."
    );
    const id = await source(t, { ragEntryId: "e3", ragImportance: 1, ragEntryIdV4: "e4" });
    await backfillCards(t);
    expect(await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage4" })).toMatchObject({ changed: true });
    const state = await t.run((ctx) => ctx.db.query("brainSearchIndexState").unique());
    expect(state?.servingSince).toBeGreaterThan(0);
    const drop = () => t.mutation(internal.brain.dropOldSearchIndex, { confirm: "drop voyage3" });
    await expect(drop()).rejects.toThrow(/Run brain:calibrateSearchIndexes again first/);
    const setCalibration = (c: { at: number; probes: number; serving: "voyage3" | "voyage4" }) =>
      t.run(async (ctx) => ctx.db.patch(state!._id, { lastCalibration: c }));
    // Before the cutover, too few probes, or with voyage3 serving: not enough.
    await setCalibration({ at: state!.servingSince! - 1, probes: 30, serving: "voyage4" });
    await expect(drop()).rejects.toThrow(/again first/);
    await setCalibration({ at: state!.servingSince! + 1, probes: 19, serving: "voyage4" });
    await expect(drop()).rejects.toThrow(/at least 20 probes/);
    await setCalibration({ at: state!.servingSince! + 1, probes: 20, serving: "voyage3" });
    await expect(drop()).rejects.toThrow(/again first/);
    // P3-4: not while a build pass runs.
    await setCalibration({ at: state!.servingSince! + 1, probes: 20, serving: "voyage4" });
    await t.run((ctx) => ctx.db.patch(state!._id, { buildRunning: { startedAt: 5 } }));
    await expect(drop()).rejects.toThrow(/A build pass is running/);
    await t.run((ctx) => ctx.db.patch(state!._id, { buildRunning: undefined }));
    expect(await drop()).toMatchObject({ done: true });
    void id;
  });

  test("P2-2 / P3-7: the drop pauses between its steps", async () => {
    const t = setup();
    for (let i = 0; i < 101; i++) await source(t, { ragEntryId: `e3-${i}`, ragImportance: 1, ragEntryIdV4: `e4-${i}` });
    await backfillCards(t);
    await t.run((ctx) =>
      ctx.db.insert("brainSearchIndexState", {
        key: "search", serving: "voyage4", servingSince: 1, changedBy: "test", changedAt: 1,
        lastCalibration: { at: 2, probes: 25, serving: "voyage4" },
      })
    );
    expect(await t.mutation(internal.brain.dropOldSearchIndex, { confirm: "drop voyage3" })).toMatchObject({ done: false });
    const { DROP_STEP_DELAY_MS } = await import("./brain");
    const [next] = await scheduled(t, "dropOldSearchIndex");
    expect(next.scheduledTime - Date.now()).toBeGreaterThanOrEqual(DROP_STEP_DELAY_MS - 1000);
  });

  test("P3-1: with voyage3 serving, a retry that reuses voyage3's notes still drops the kept notes; a revoke deletes them", async () => {
    vi.stubEnv("BRAIN_CONTEXTUAL", "1");
    const t = setup();
    const admin = await withAdmin(t);
    const id = await source(t, { content: "Section one about the kiln.\n\nSection two about cold-cycle drift." });
    vi.mocked(brainEmbeddingModelV4.doEmbed).mockRejectedValueOnce(new Error("voyage 429"));
    await expect(t.action(internal.ai.brain.ingest.embedSource, { sourceId: id })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("brainChunkNotes").collect())).toHaveLength(1);
    const paid = notesCreate.mock.calls.length;
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    expect(notesCreate.mock.calls.length).toBe(paid);
    expect((await row(t, id))?.ragEntryIdV4).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.query("brainChunkNotes").collect())).toEqual([]);

    // An embed that failed and was then revoked leaves no kept notes either.
    const other = await source(t, { content: "Another section about the kiln.\n\nAnd its drift." });
    vi.mocked(brainEmbeddingModelV4.doEmbed).mockRejectedValueOnce(new Error("voyage 429"));
    await expect(t.action(internal.ai.brain.ingest.embedSource, { sourceId: other })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("brainChunkNotes").collect())).toHaveLength(1);
    await admin.mutation(api.brain.revokeSource, { sourceId: other });
    expect(await t.run((ctx) => ctx.db.query("brainChunkNotes").collect())).toEqual([]);
  });

  test("P3-7: notes that are all empty are never kept or reused, and kept notes are capped by count too", async () => {
    vi.stubEnv("BRAIN_CONTEXTUAL", "1");
    const t = setup();
    const id = await source(t, { content: "Section one about the kiln.\n\nSection two about cold-cycle drift." });
    await t.run((ctx) => ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 }));
    // The notes model is down on the first attempt; voyage4 fails too.
    notesCreate.mockRejectedValue(new Error("haiku down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(brainEmbeddingModelV4.doEmbed).mockRejectedValueOnce(new Error("voyage 429"));
    await expect(t.action(internal.ai.brain.ingest.embedSource, { sourceId: id })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("brainChunkNotes").collect())).toEqual([]);
    // A row of empty notes left by an earlier version is not reused either.
    await t.mutation(internal.ai.brain.rag.keepChunkNotes, { sourceId: id, notesVersion: BRAIN_CHUNK_NOTES_VERSION, notes: ["", ""] });
    expect(
      await t.query(internal.ai.brain.rag.keptChunkNotes, { sourceId: id, notesVersion: BRAIN_CHUNK_NOTES_VERSION, chunkCount: 2 })
    ).toBeNull();
    notesCreate.mockReset().mockResolvedValue({ content: [{ type: "text", text: "In the method section." }] });
    await t.action(internal.ai.brain.ingest.embedSource, { sourceId: id });
    expect(notesCreate).toHaveBeenCalled();

    const { keepableNotes, CHUNK_NOTES_MAX_COUNT } = await import("./ai/brain/rag");
    expect(keepableNotes(["a", ""])).toBe(true);
    expect(keepableNotes(["", ""])).toBe(false);
    expect(keepableNotes(new Array(CHUNK_NOTES_MAX_COUNT + 1).fill("a"))).toBe(false);
    expect(keepableNotes(new Array(CHUNK_NOTES_MAX_COUNT).fill("a"))).toBe(true);
  });

  test("P3-3: the full requeue's confirmed erasure clears the voyage3 id, so a failed refill cannot let a rollback through", async () => {
    const t = setup();
    const id = await source(t);
    await addTo(t, brain, "brain", id, 0.6, 2);
    await addTo(t, brainV4, "brain-v4", id, 0.6, 3);
    await backfillCards(t);
    await t.run((ctx) => ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", changedBy: "test", changedAt: 1 }));
    await t.mutation(internal.brain.requeueAllApprovedEmbeds, {});
    // The forced embed fails every attempt (it never runs here); the erasure is confirmed.
    await runUnlearns(t);
    expect((await row(t, id))?.ragEntryId).toBeUndefined();
    expect((await t.mutation(internal.brain.setServingSearchIndex, { index: "voyage3" })).message).toContain("(no entry)");
  });

  test("P3-5: the namespace delete removes every version of the old name and the expired leases", async () => {
    const t = setup();
    const id = await source(t);
    await addTo(t, brain, "brain", id, 0.6, 2);
    // An older shape change: a second version of "brain" (another model) marks the first replaced.
    await addTo(t, brainV4, "brain", id, 0.6, 3);
    const versions = async () =>
      t.run((ctx) => ctx.runQuery(components.rag.namespaces.listNamespaceVersions, { namespace: "brain", paginationOpts: { cursor: null, numItems: 10 } }));
    expect((await versions()).page).toHaveLength(2);
    await t.run((ctx) =>
      ctx.db.insert("brainSearchIndexState", { key: "search", serving: "voyage4", oldIndexDropped: true, changedBy: "test", changedAt: 1 })
    );
    await t.run((ctx) => ctx.db.insert("brainIndexWrites", { index: "voyage4", sourceId: id, startedAt: Date.now() - INDEX_WRITE_LEASE_MS - 1 }));
    const live = await t.run((ctx) => ctx.db.insert("brainIndexWrites", { index: "voyage4", sourceId: id, startedAt: Date.now() }));
    await backfillCards(t);
    expect(await t.action(internal.brain.deleteOldSearchNamespace, {})).toEqual({ deleted: true });
    expect((await versions()).page).toEqual([]);
    expect((await t.run((ctx) => ctx.db.query("brainIndexWrites").collect())).map((r) => r._id)).toEqual([live]);
  });
});
