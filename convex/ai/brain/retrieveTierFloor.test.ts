/// <reference types="vite/client" />
// 2026-11-17: the relevance floor reads raw similarity, the writer tier ranks
// after it, and a company's own imported PDs never come back to it as
// exemplars. These run the real RAG component (vector search, importance
// math, hybrid ranking) in convex-test, with only Voyage's HTTP models
// stubbed. Every company here is made up.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import { brain, BRAIN_ENTRY_IMPORTANCE, BRAIN_NAMESPACE, insertBrainSource } from "./rag";
import { brainEmbeddingModel, brainRerankModel, BRAIN_EMBEDDING_DIMENSION } from "./embeddings";
import {
  BRAIN_MIN_VECTOR_SIMILARITY,
  BRAIN_OWN_COMPANY_SEARCH_LIMIT,
  BRAIN_SEARCH_LIMIT,
  blendWriterTier,
  rankWithoutRerank,
  searchBrainExemplars,
  type BrainExemplar,
} from "./retrieve";
import ragSchema from "../../../node_modules/@convex-dev/rag/src/component/schema.js";
import workpoolSchema from "../../../node_modules/@convex-dev/workpool/src/component/schema.js";

// Keyed by absolute path, so convex-test finds a module by its function handle.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, load]) => [new URL(path, import.meta.url).pathname, load])
);
const ragModules = import.meta.glob("../../../node_modules/@convex-dev/rag/src/component/**/*.ts");
const workpoolModules = import.meta.glob("../../../node_modules/@convex-dev/workpool/src/component/**/*.ts");

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

let axis = 2;
/** An approved source with one chunk at `cos` to the query, ingested as embedSource does. */
async function addSource(
  t: T,
  opts: { cos: number; tier: number; importance?: number; importItemId?: Id<"ingestionItems">; label: string }
): Promise<Id<"brainSources">> {
  const sourceId = await t.run((ctx) =>
    insertBrainSource(ctx, {
      kind: "pd_pair",
      status: "approved",
      title: "Past PD, FY2024",
      industry: "manufacturing",
      writerTier: opts.tier,
      docType: "pd",
      content: `private text ${opts.label}`,
      ragKey: `pd_pair:${opts.label}`,
      sourceHash: `hash-${opts.label}`,
      createdBy: "test",
      createdAt: 1,
      ...(opts.importItemId ? { importItemId: opts.importItemId, importContentHash: `bytes-${opts.label}` } : {}),
    })
  );
  if (opts.importItemId) {
    // Approve links the import file to its Brain source.
    await t.run((ctx) => ctx.db.patch(opts.importItemId!, { brainSourceId: sourceId }));
  }
  const vector = vectorAt(opts.cos, axis++);
  await t.action(async (ctx) => {
    await brain.add(ctx, {
      namespace: BRAIN_NAMESPACE,
      key: `pd_pair:${opts.label}`,
      title: "Past PD, FY2024",
      importance: opts.importance ?? BRAIN_ENTRY_IMPORTANCE,
      metadata: { sourceId, industry: "manufacturing", writerTier: opts.tier, docType: "pd" },
      filterValues: [
        { name: "industryApproved", value: { industry: "manufacturing", approved: true } },
        { name: "docType", value: "pd" },
      ],
      chunks: [{ text: `Passage ${opts.label} about kiln temperature control.`, embedding: vector }],
    });
  });
  return sourceId;
}

async function search(t: T, args: { k: number; projectId?: Id<"projects"> }) {
  return await t.action((ctx: ActionCtx) =>
    searchBrainExemplars(ctx, { query: "zzqx", k: args.k, ...(args.projectId ? { projectId: args.projectId } : {}) })
  );
}

beforeEach(() => {
  axis = 2;
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(brainEmbeddingModel, "doEmbed").mockResolvedValue({ embeddings: [QUERY], warnings: [] } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the relevance floor reads raw similarity", () => {
  test("a tier-0.4 entry on topic passes the floor; an off-topic one does not", async () => {
    const t = setup();
    const low = await addSource(t, { cos: 0.5, tier: 0.4, label: "low" });
    await addSource(t, { cos: 0.2, tier: 1, label: "off" });
    expect(0.4 * 0.5).toBeLessThan(BRAIN_MIN_VECTOR_SIMILARITY);
    const result = await search(t, { k: 4 });
    expect(result.degraded).toBe(false);
    expect(result.exemplars.map((e) => e.sourceId)).toEqual([low]);
    expect(result.exemplars[0].writerTier).toBe(0.4);
  });

  test("an entry still ingested with its tier as importance is hidden, as before (it needs a re-embed)", async () => {
    const t = setup();
    await addSource(t, { cos: 0.5, tier: 0.4, importance: 0.4, label: "legacy" });
    expect((await search(t, { k: 4 })).exemplars).toEqual([]);
  });

  test("at equal relevance the higher tier ranks first after rerank", async () => {
    const t = setup();
    const low = await addSource(t, { cos: 0.6, tier: 0.4, label: "low" });
    const gold = await addSource(t, { cos: 0.5, tier: 1, label: "gold" });
    const mid = await addSource(t, { cos: 0.55, tier: 0.7, label: "mid" });
    vi.spyOn(brainRerankModel, "doRerank").mockResolvedValue({
      ranking: [0, 1, 2].map((index) => ({ index, relevanceScore: 0.8 })),
      response: { body: {} },
    } as never);
    const result = await search(t, { k: 2 });
    expect(result.exemplars.map((e) => e.sourceId)).toEqual([gold, mid]);
    expect(result.exemplars[0].score).toBeCloseTo(0.8, 6);
    void low;
  });

  test("the tier comes from the source's card, so a reweight needs no re-embed", async () => {
    const t = setup();
    const a = await addSource(t, { cos: 0.6, tier: 0.4, label: "a" });
    const b = await addSource(t, { cos: 0.5, tier: 0.4, label: "b" });
    vi.spyOn(brainRerankModel, "doRerank").mockResolvedValue({
      ranking: [0, 1].map((index) => ({ index, relevanceScore: 0.8 })),
      response: { body: {} },
    } as never);
    // Same rerank score: search order decides at the same tier.
    expect((await search(t, { k: 1 })).exemplars.map((e) => e.sourceId)).toEqual([a]);
    await t.run(async (ctx) => {
      const { patchBrainSource } = await import("./rag");
      await patchBrainSource(ctx, (await ctx.db.get(b))!, { writerTier: 1 });
    });
    expect((await search(t, { k: 1 })).exemplars.map((e) => e.sourceId)).toEqual([b]);
  });
});

describe("the writer tier after the floor without rerank", () => {
  const ex = (entryId: string, searchScore: number, writerTier?: number): BrainExemplar => ({
    text: entryId,
    entryId,
    score: searchScore,
    searchScore,
    ...(writerTier !== undefined ? { writerTier } : {}),
  });

  test("positions are counted over the kept slate, the floor reads them, then the tier ranks", () => {
    // The component's scores were positions over more hits (some dropped
    // since): 0.5, 0.45 ... are recounted as 1, 0.8, 0.6, 0.4, 0.2.
    const ranked = rankWithoutRerank([
      ex("low", 0.5, 0.4),
      ex("gold", 0.45, 1),
      ex("a", 0.4),
      ex("b", 0.35),
      ex("tail", 0.3, 1),
    ]);
    expect(ranked.map((e) => e.entryId)).toEqual(["gold", "low", "a", "b"]);
    expect(ranked[0].score).toBeCloseTo(blendWriterTier(0.8, 1), 9);
    expect(ranked[1].score).toBeCloseTo(0.76, 9);
    // searchScore keeps the component's own score for provenance.
    expect(ranked[0].searchScore).toBe(0.45);
  });

  test("equal tiers keep search order; a missing tier reads as 0.4; one hit is at the top", () => {
    expect(rankWithoutRerank([ex("a", 0.5), ex("b", 0.5, 0.4)]).map((e) => e.entryId)).toEqual(["a", "b"]);
    expect(blendWriterTier(1, undefined)).toBeCloseTo(0.76, 9);
    expect(rankWithoutRerank([ex("only", 0.1)])).toHaveLength(1);
    expect(rankWithoutRerank([])).toEqual([]);
  });
});

describe("a company's own imported PDs are left out of its own exemplars", () => {
  async function company(t: T) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "own-writer", role: "writer" });
      const clientId = await ctx.db.insert("clients", {
        name: "Quillmere Analytics",
        nameKey: "quillmere analytics",
        formerNames: ["Quillmere Labs"],
        nameHistoryComplete: true,
        status: "active",
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      });
      const projectId = await ctx.db.insert("projects", {
        title: "Kiln controller",
        clientName: "Quillmere Analytics",
        clientId,
        dashboardCompanyKey: "quillmere analytics",
        status: "review",
        createdBy: userId,
        shareToken: "own-company-token",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherProjectId = await ctx.db.insert("projects", {
        title: "Dryer",
        clientName: "Harrowfield Farms",
        dashboardCompanyKey: "harrowfield farms",
        status: "review",
        createdBy: userId,
        shareToken: "other-company-token",
        createdAt: 1,
        updatedAt: 1,
      });
      return { projectId, otherProjectId };
    });
  }

  test("drafts drop them (the company's key and its former names), other companies still get them", async () => {
    const t = setup();
    const { projectId, otherProjectId } = await company(t);
    const [own, former, other] = await t.run(async (ctx) => {
      const mk = (companyKey: string, n: number) =>
        ctx.db.insert("ingestionItems", {
          driveItemId: `drive-${companyKey}-${n}`,
          path: `${companyKey}/2024`,
          name: `PD ${n}.docx`,
          clientName: companyKey,
          companyKey,
          docKind: "pd",
          size: 1,
          lastModifiedAt: 1,
          contentHash: `bytes-${companyKey}-${n}`,
          status: "approved",
          pairGroupKey: `${companyKey}::2024`,
          updatedAt: 1,
        });
      return [await mk("quillmere analytics", 1), await mk("quillmere labs", 2), await mk("harrowfield farms", 3)];
    });
    const ownSource = await addSource(t, { cos: 0.9, tier: 1, importItemId: own, label: "own" });
    const formerSource = await addSource(t, { cos: 0.85, tier: 1, importItemId: former, label: "former" });
    const otherSource = await addSource(t, { cos: 0.6, tier: 0.4, importItemId: other, label: "other" });
    const curated = await addSource(t, { cos: 0.55, tier: 0.7, label: "curated" });

    const forOwn = await search(t, { k: 4, projectId });
    expect(forOwn.exemplars.map((e) => e.sourceId).sort()).toEqual([otherSource, curated].sort());
    const forOther = await search(t, { k: 4, projectId: otherProjectId });
    expect(forOther.exemplars.map((e) => e.sourceId)).not.toContain(otherSource);
    expect(forOther.exemplars.map((e) => e.sourceId)).toEqual(expect.arrayContaining([ownSource, formerSource, curated]));
    const noProject = await search(t, { k: 4 });
    expect(noProject.exemplars).toHaveLength(4);
  });

  test("a company with no imported PDs in the Brain searches 30 hits, as before", async () => {
    const t = setup();
    const { projectId, otherProjectId } = await company(t);
    await addSource(t, { cos: 0.6, tier: 0.4, label: "curated" });
    const searchSpy = vi.spyOn(brain, "search");
    await search(t, { k: 4, projectId });
    await search(t, { k: 4, projectId: otherProjectId });
    await search(t, { k: 4 });
    expect(searchSpy.mock.calls.map(([, args]) => args.limit)).toEqual([BRAIN_SEARCH_LIMIT, BRAIN_SEARCH_LIMIT, BRAIN_SEARCH_LIMIT]);
    expect(await t.query(internal.brain.ownCompanyImports, { projectId })).toBeNull();
  });

  test("it fetches more hits so its own PDs do not crowd out others, and the slate stays 30", async () => {
    const t = setup();
    const { projectId } = await company(t);
    const ownItems = await t.run(async (ctx) => {
      const ids: Id<"ingestionItems">[] = [];
      for (let n = 0; n < 35; n++) {
        ids.push(
          await ctx.db.insert("ingestionItems", {
            driveItemId: `drive-own-${n}`,
            path: "quillmere analytics/2024",
            name: `PD ${n}.docx`,
            clientName: "quillmere analytics",
            companyKey: "quillmere analytics",
            docKind: "pd",
            size: 1,
            lastModifiedAt: 1,
            contentHash: `bytes-own-${n}`,
            status: "approved",
            pairGroupKey: "quillmere analytics::2024",
            updatedAt: 1,
          })
        );
      }
      return ids;
    });
    for (const [n, importItemId] of ownItems.entries()) {
      await addSource(t, { cos: 0.95 - n * 0.001, tier: 1, importItemId, label: `own-${n}` });
    }
    const others: Id<"brainSources">[] = [];
    for (let n = 0; n < 35; n++) others.push(await addSource(t, { cos: 0.6 - n * 0.001, tier: 0.4, label: `other-${n}` }));

    const rerank = vi.spyOn(brainRerankModel, "doRerank").mockImplementation(async ({ documents }) => ({
      ranking: documents.values.map((_: unknown, index: number) => ({ index, relevanceScore: 0.9 - index * 0.001 })),
      response: { body: {} },
    }) as never);
    const searchSpy = vi.spyOn(brain, "search");
    const result = await search(t, { k: 4, projectId });
    expect(searchSpy.mock.calls[0][1].limit).toBe(BRAIN_OWN_COMPANY_SEARCH_LIMIT);
    expect(BRAIN_OWN_COMPANY_SEARCH_LIMIT).toBeGreaterThan(BRAIN_SEARCH_LIMIT);
    const documents = rerank.mock.calls[0][0].documents.values as string[];
    expect(documents).toHaveLength(BRAIN_SEARCH_LIMIT);
    expect(documents.every((text) => text.includes("other-"))).toBe(true);
    expect(result.exemplars).toHaveLength(4);
    expect(result.exemplars.every((e) => others.includes(e.sourceId as Id<"brainSources">))).toBe(true);
  });
});

describe("a finished embed records its importance", () => {
  test("ingestOnComplete writes the entry's importance (1) and entry id on the source and its card", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const sourceId = await t.run((ctx) =>
        insertBrainSource(ctx, {
          kind: "pd_pair",
          status: "approved",
          title: "Past PD, FY2024",
          industry: "manufacturing",
          writerTier: 0.4,
          docType: "pd",
          content: "private text",
          ragKey: "pd_pair:recorded",
          sourceHash: "hash-recorded",
          createdBy: "test",
          createdAt: 1,
        })
      );
      await t.action(async (ctx) => {
        await brain.add(ctx, {
          namespace: BRAIN_NAMESPACE,
          key: "pd_pair:recorded",
          title: "Past PD, FY2024",
          importance: BRAIN_ENTRY_IMPORTANCE,
          metadata: { sourceId, industry: "manufacturing", writerTier: 0.4, docType: "pd" },
          filterValues: [
            { name: "industryApproved", value: { industry: "manufacturing", approved: true } },
            { name: "docType", value: "pd" },
          ],
          chunks: [{ text: "Passage about kiln control.", embedding: vectorAt(0.5, 2) }],
          onComplete: internal.ai.brain.rag.ingestOnComplete,
        });
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const { row, card } = await t.run(async (ctx) => ({
        row: await ctx.db.get(sourceId),
        card: await ctx.db.query("brainSourceCards").withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId)).unique(),
      }));
      expect(row?.ragImportance).toBe(1);
      expect(row?.ragEntryId).toBeTruthy();
      expect(card?.ragImportance).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("servableBrainSources", () => {
  test("drops revoked and unknown ids and returns each kept source's tier", async () => {
    const t = setup();
    const kept = await addSource(t, { cos: 0.5, tier: 0.7, label: "kept" });
    const revoked = await t.run((ctx) =>
      insertBrainSource(ctx, {
        kind: "pd_pair",
        status: "revoked",
        title: "Past PD",
        industry: "manufacturing",
        writerTier: 1,
        docType: "pd",
        content: "x",
        ragKey: "pd_pair:revoked",
        sourceHash: "hash-revoked",
        createdBy: "test",
        createdAt: 1,
      })
    );
    expect(
      await t.query(internal.brain.servableBrainSources, { sourceIds: [kept, revoked, "not-an-id"] })
    ).toEqual([{ sourceId: kept, writerTier: 0.7 }]);
  });
});
