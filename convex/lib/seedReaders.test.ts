/// <reference types="vite/client" />

import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredQuery,
} from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type {
  getOutline,
  getSubsection,
  getSummary,
  listBatches,
  regenerate,
  select,
} from "../seeds";
import {
  addDecisionSeed,
  decisionMutation,
  decisionFixture,
} from "../seedDecision.fixture";
import { emptyContextRevision, orderShownSet } from "./seedRevisions";
import { readCompleteFixture } from "../testFixtureRows";

const SEED_READER_FIXTURE_ROW_LIMIT = 10;

type QueryReferenceFromExport<Export> =
  Export extends RegisteredQuery<
    infer Visibility,
    infer Args,
    infer ReturnValue
  >
    ? FunctionReference<"query", Visibility, Args, Awaited<ReturnValue>>
    : never;

function queryReference<Export>(name: string) {
  type Reference = QueryReferenceFromExport<Export>;
  return makeFunctionReference<
    "query",
    FunctionArgs<Reference>,
    FunctionReturnType<Reference>
  >(name);
}

const getSummaryRef = queryReference<typeof getSummary>("seeds:getSummary");
const getOutlineRef = queryReference<typeof getOutline>("seeds:getOutline");
const listBatchesRef = queryReference<typeof listBatches>("seeds:listBatches");
const getSubsectionRef = queryReference<typeof getSubsection>(
  "seeds:getSubsection",
);
const regenerateRef = decisionMutation<typeof regenerate>("seeds:regenerate");
const selectRef = decisionMutation<typeof select>("seeds:select");
type SummaryResult = FunctionReturnType<typeof getSummaryRef>;
type BatchHistoryResult = FunctionReturnType<typeof listBatchesRef>;

async function insertBatch(
  fixture: Awaited<ReturnType<typeof decisionFixture>>,
  ordinal: number,
) {
  return await fixture.t.run(async (ctx) => {
    return await ctx.db.insert("seedBatches", {
      projectId: fixture.projectId,
      generationId: fixture.generationId,
      roleId: "company_context",
      operation: ordinal === 0 ? "open" : "regenerate",
      dedupeKey: `reader-batch-${ordinal}`,
      commandId: `reader-batch-${ordinal}`,
      attemptId: `reader-batch-${ordinal}`,
      consumedContextRevision: await emptyContextRevision(),
      briefVersionId: fixture.briefId,
      settingsHash: "settings",
      status: ordinal === 0 ? "shown" : "superseded",
      queuedAt: ordinal + 1,
      leaseExpiresAt: ordinal + 2,
      completedAt: ordinal + 2,
      model: "model",
      slot: "generation:seeds:company_context",
      promptVersion: "prompt",
      requestsReserved: 2,
      requestsMade: 1,
      settledAt: ordinal + 2,
    });
  });
}

describe("seed reader pagination", () => {
  it("denies anonymous reads while keeping authorized historical Seeds readable", async () => {
    const fixture = await decisionFixture();
    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.generationId, { status: "completed" }),
    );

    const historical: SummaryResult = await fixture.writer.query(
      getSummaryRef,
      {
        generationId: fixture.generationId,
        cursor: null,
        numItems: 10,
      },
    );
    expect(historical.frozen).toBe(false);

    await expect(
      fixture.t.query(getSummaryRef, {
        generationId: fixture.generationId,
        cursor: null,
        numItems: 10,
      }),
    ).rejects.toThrow();
  });

  it("paginates production-written selection keys in canonical Shown Set order", async () => {
    const fixture = await decisionFixture();
    const originalBatchId = await insertBatch(fixture, 0);
    const laterBatchId = await insertBatch(fixture, 1);
    const revisionBatchId = await insertBatch(fixture, 2);
    const seeds = await fixture.t.run(async (ctx) => {
      const firstOriginalId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: originalBatchId,
        roleId: "company_context",
        order: 0,
        bullets: ["First original."],
        tags: ["detailed"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      const secondOriginalId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: originalBatchId,
        roleId: "company_context",
        order: 1,
        bullets: ["Second original."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      const laterOriginalId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: laterBatchId,
        roleId: "company_context",
        order: 0,
        bullets: ["Later original."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      const firstRevisionId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: revisionBatchId,
        roleId: "company_context",
        order: 0,
        bullets: ["First revision."],
        tags: ["detailed"],
        support: "source_supported",
        originalSupport: "source_supported",
        revisionOfSeedId: firstOriginalId,
      });
      const secondRevisionId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: revisionBatchId,
        roleId: "company_context",
        order: 1,
        bullets: ["Second revision."],
        tags: ["detailed"],
        support: "source_supported",
        originalSupport: "source_supported",
        revisionOfSeedId: secondOriginalId,
      });
      return {
        firstOriginalId,
        secondOriginalId,
        laterOriginalId,
        firstRevisionId,
        secondRevisionId,
      };
    });

    let version = 0;
    for (const seedId of [
      seeds.secondRevisionId,
      seeds.laterOriginalId,
      seeds.secondOriginalId,
      seeds.firstRevisionId,
    ]) {
      const result = await fixture.writer.mutation(selectRef, {
        generationId: fixture.generationId,
        roleId: "company_context",
        expectedSeedStageVersion: version,
        seedId,
        selected: true,
      });
      version = result.seedStageVersion;
    }

    const selectedIds = new Set([
      seeds.secondRevisionId,
      seeds.laterOriginalId,
      seeds.secondOriginalId,
      seeds.firstRevisionId,
    ]);
    const expected = await fixture.t.run(async (ctx) => {
      const allSeeds = await readCompleteFixture({
        label: "seed reader seeds",
        maxRows: SEED_READER_FIXTURE_ROW_LIMIT,
        query: ctx.db
          .query("seeds")
          .withIndex("by_generationId_and_roleId", (q) =>
            q
              .eq("generationId", fixture.generationId)
              .eq("roleId", "company_context"),
          ),
      });
      const batches = await readCompleteFixture({
        label: "seed reader batches",
        maxRows: SEED_READER_FIXTURE_ROW_LIMIT,
        query: ctx.db
          .query("seedBatches")
          .withIndex("by_generationId_and_roleId", (q) =>
            q
              .eq("generationId", fixture.generationId)
              .eq("roleId", "company_context"),
          ),
      });
      return orderShownSet({ seeds: allSeeds, batches })
        .filter((seed) => selectedIds.has(seed._id))
        .map((seed) => seed._id);
    });

    const actual: Id<"seeds">[] = [];
    let cursor: string | null = null;
    let done = false;
    for (let pageNumber = 0; pageNumber < 30 && !done; pageNumber += 1) {
      const result: SummaryResult = await fixture.writer.query(getSummaryRef, {
        generationId: fixture.generationId,
        cursor,
        numItems: 2,
      });
      actual.push(...result.page.map((item) => item.seedId));
      cursor = result.continueCursor;
      done = result.isDone;
    }
    expect(done).toBe(true);
    expect(actual).toEqual(expected);
    expect(actual).toContain(seeds.firstRevisionId);
    expect(actual).not.toContain(seeds.firstOriginalId);
    expect(new Set(actual).size).toBe(expected.length);
  });

  it("paginates every frozen Summary item in stored order", async () => {
    const fixture = await decisionFixture();
    const { summaryVersionId, expectedOrders } = await fixture.t.run(
      async (ctx) => {
        const batchId = await ctx.db.insert("seedBatches", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          roleId: "company_context",
          operation: "open",
          dedupeKey: "frozen-reader",
          commandId: "frozen-reader",
          attemptId: "frozen-reader",
          consumedContextRevision: await emptyContextRevision(),
          briefVersionId: fixture.briefId,
          settingsHash: "settings",
          status: "shown",
          queuedAt: 1,
          leaseExpiresAt: 2,
          completedAt: 2,
          model: "model",
          slot: "generation:seeds:company_context",
          promptVersion: "prompt",
          requestsReserved: 2,
        });
        const seedId = await ctx.db.insert("seeds", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          batchId,
          roleId: "company_context",
          order: 0,
          bullets: ["Frozen item."],
          tags: ["technical"],
          support: "source_supported",
          originalSupport: "source_supported",
        });
        const summaryVersionId = await ctx.db.insert("summaryVersions", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          version: 1,
          originGenerationId: fixture.generationId,
          briefVersionId: fixture.briefId,
          settingsHash: "settings",
          skippedRoleIds: [],
          readiness: true,
          signedOffBy: fixture.userId,
          signedOffAt: 1,
        });
        const expectedOrders = Array.from({ length: 135 }, (_, index) => index);
        for (const order of expectedOrders) {
          await ctx.db.insert("summaryItems", {
            projectId: fixture.projectId,
            generationId: fixture.generationId,
            summaryVersionId,
            roleId: "company_context",
            kind: "standard",
            order,
            seedId,
            bullets: [`Frozen item ${order}.`],
            support: "source_supported",
            tags: ["technical"],
          });
        }
        return { summaryVersionId, expectedOrders };
      },
    );

    const actualOrders: number[] = [];
    let cursor: string | null = null;
    let done = false;
    for (let pageNumber = 0; pageNumber < 20 && !done; pageNumber += 1) {
      const result: SummaryResult = await fixture.writer.query(getSummaryRef, {
        generationId: fixture.generationId,
        versionId: summaryVersionId,
        cursor,
        numItems: 17,
      });
      expect(result.frozen).toBe(true);
      for (const item of result.page) {
        if (!("order" in item))
          throw new Error("Expected a frozen Summary item");
        actualOrders.push(item.order);
      }
      cursor = result.continueCursor;
      done = result.isDone;
    }
    expect(done).toBe(true);
    expect(actualOrders).toEqual(expectedOrders);
  });

  it("resumes inside a Batch page when a joined row exhausts the read budget", async () => {
    const fixture = await decisionFixture();
    const batchIds: Id<"seedBatches">[] = [];
    const largeExcerpt = "x".repeat(500_000);
    for (let ordinal = 0; ordinal < 3; ordinal += 1) {
      const batchId = await insertBatch(fixture, ordinal);
      batchIds.push(batchId);
      await fixture.t.run(async (ctx) => {
        const seedId = await ctx.db.insert("seeds", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          batchId,
          roleId: "company_context",
          order: 0,
          bullets: [`History ${ordinal}.`],
          tags: ["technical"],
          support: "source_supported",
          originalSupport: "source_supported",
        });
        for (let citation = 0; citation < 3; citation += 1) {
          await ctx.db.insert("seedProvenance", {
            seedId,
            projectId: fixture.projectId,
            generationId: fixture.generationId,
            sourceId: fixture.sourceId,
            sourceContentHash: "source-hash",
            startOffset: 0,
            endOffset: 1,
            exactExcerpt: largeExcerpt,
          });
        }
      });
    }

    const returned: Id<"seedBatches">[] = [];
    let cursor: string | null = null;
    let done = false;
    let sawTruncation = false;
    for (let pageNumber = 0; pageNumber < 6 && !done; pageNumber += 1) {
      const result: BatchHistoryResult = await fixture.writer.query(
        listBatchesRef,
        {
          generationId: fixture.generationId,
          roleId: "company_context",
          cursor,
          numItems: 3,
        },
      );
      returned.push(...result.page.map((row) => row.batch._id));
      sawTruncation ||= result.truncated;
      cursor = result.continueCursor;
      done = result.isDone;
    }
    expect(sawTruncation).toBe(true);
    expect(done).toBe(true);
    expect(returned).toEqual([...batchIds].reverse());
    expect(new Set(returned).size).toBe(batchIds.length);
  });

  it("rejects a partial Batch window after a new public dispatch", async () => {
    const fixture = await decisionFixture();
    const largeExcerpt = "x".repeat(500_000);
    for (let ordinal = 0; ordinal < 3; ordinal += 1) {
      const batchId = await insertBatch(fixture, ordinal);
      await fixture.t.run(async (ctx) => {
        const seedId = await ctx.db.insert("seeds", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          batchId,
          roleId: "company_context",
          order: 0,
          bullets: [`History ${ordinal}.`],
          tags: ["technical"],
          support: "source_supported",
          originalSupport: "source_supported",
        });
        for (let citation = 0; citation < 3; citation += 1) {
          await ctx.db.insert("seedProvenance", {
            seedId,
            projectId: fixture.projectId,
            generationId: fixture.generationId,
            sourceId: fixture.sourceId,
            sourceContentHash: "source-hash",
            startOffset: 0,
            endOffset: 1,
            exactExcerpt: largeExcerpt,
          });
        }
      });
    }

    const first: BatchHistoryResult = await fixture.writer.query(
      listBatchesRef,
      {
        generationId: fixture.generationId,
        roleId: "company_context",
        cursor: null,
        numItems: 3,
      },
    );
    expect(first.truncated).toBe(true);
    expect(first.isDone).toBe(false);

    const dispatched = await fixture.writer.mutation(regenerateRef, {
      generationId: fixture.generationId,
      roleId: "company_context",
      expectedSeedStageVersion: 0,
      commandId: "reader-new-dispatch",
    });
    expect(dispatched.kind).toBe("dispatched");
    await expect(
      fixture.writer.query(listBatchesRef, {
        generationId: fixture.generationId,
        roleId: "company_context",
        cursor: first.continueCursor,
        numItems: 3,
      }),
    ).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });
  });

  it("omits selected Seeds whose Batches were unread when the state budget ends", async () => {
    const fixture = await decisionFixture();
    const seed = await addDecisionSeed(fixture);
    await fixture.t.run(async (ctx) => {
      const largeBullet = "z".repeat(600_000);
      for (let index = 0; index < 7; index += 1) {
        const seedId = await ctx.db.insert("seeds", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          batchId: seed.batchId,
          roleId: "company_context",
          order: index + 1,
          bullets: [largeBullet],
          tags: ["technical"],
          support: "source_supported",
          originalSupport: "source_supported",
        });
        await ctx.db.insert("seedSelections", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          seedId,
          roleId: "company_context",
          selected: true,
          selectedAt: index,
          version: 1,
          orderKey: String(index).padStart(6, "0"),
        });
      }
    });

    const result = await fixture.writer.query(getSubsectionRef, {
      generationId: fixture.generationId,
      roleId: "company_context",
    });
    expect(result.truncated).toBe(true);
    expect(result.approvalChallenge).toBeNull();
    expect(result.items).toEqual([]);
  });

  it("rejects a genuinely missing Batch after a complete state read", async () => {
    const fixture = await decisionFixture();
    const seed = await addDecisionSeed(fixture);
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("seedSelections", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        seedId: seed.seedId,
        roleId: "company_context",
        selected: true,
        selectedAt: 1,
        version: 1,
        orderKey: "000000",
      });
      await ctx.db.delete(seed.batchId);
    });

    await expect(
      fixture.writer.query(getSubsectionRef, {
        generationId: fixture.generationId,
        roleId: "company_context",
      }),
    ).rejects.toMatchObject({ data: { code: "INVALID_STATE" } });
  });

  it("returns a truncated Subsection without an incomplete approval challenge", async () => {
    const fixture = await decisionFixture();
    const seed = await addDecisionSeed(fixture);
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("seedSelections", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        seedId: seed.seedId,
        roleId: "company_context",
        selected: true,
        selectedAt: 1,
        version: 1,
        orderKey: "000000",
      });
      const largeExcerpt = "y".repeat(600_000);
      for (let index = 0; index < 8; index += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId: fixture.briefId,
          projectId: fixture.projectId,
          group: "claimExclusion",
          text: `Excluded ${index}`,
          reason: "routine_engineering",
          sourceId: fixture.sourceId,
          sourceContentHash: "source-hash",
          startOffset: 0,
          endOffset: 1,
          exactExcerpt: largeExcerpt,
          createdAt: index,
        });
      }
    });

    const result = await fixture.writer.query(getSubsectionRef, {
      generationId: fixture.generationId,
      roleId: "company_context",
    });
    expect(result.truncated).toBe(true);
    expect(result.approvalChallenge).toBeNull();
    expect(result.items.map((item) => item.seedId)).toContain(seed.seedId);
  });
});

it("keeps all 130 live selections reachable beyond the separate 128-row prompt limit", async () => {
  const fixture = await decisionFixture();
  const expected: Id<"seeds">[] = [];
  // Valid five-Seed batches exercise a large carried Decision Set. Synthetic keys
  // isolate the pagination-size invariant; the test above verifies real writers.
  for (let ordinal = 0; ordinal < 26; ordinal += 1) {
    const batchId = await insertBatch(fixture, ordinal);
    const ids = await fixture.t.run(async (ctx) => {
      const batchSeeds: Id<"seeds">[] = [];
      for (let order = 0; order < 5; order += 1) {
        const seedId = await ctx.db.insert("seeds", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          batchId,
          roleId: "company_context",
          order,
          bullets: [`Selected idea ${ordinal * 5 + order}.`],
          tags: ["technical"],
          support: "writer_asserted",
          originalSupport: "writer_asserted",
        });
        await ctx.db.insert("seedSelections", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          roleId: "company_context",
          seedId,
          selected: true,
          selectedAt: 1,
          version: 1,
          orderKey: String(ordinal * 5 + order).padStart(5, "0"),
        });
        batchSeeds.push(seedId);
      }
      return batchSeeds;
    });
    expected.push(...ids);
  }
  const actual: Id<"seeds">[] = [];
  let cursor: string | null = null;
  let done = false;
  for (let pageNumber = 0; pageNumber < 100 && !done; pageNumber += 1) {
    const result: SummaryResult = await fixture.writer.query(getSummaryRef, {
      generationId: fixture.generationId,
      cursor,
      numItems: 37,
    });
    expect(result.frozen).toBe(false);
    actual.push(...result.page.map((item) => item.seedId));
    cursor = result.continueCursor;
    done = result.isDone;
  }
  expect(done).toBe(true);
  expect(actual).toHaveLength(130);
  expect(actual).toEqual(expected);
  expect(new Set(actual).size).toBe(130);
});

describe("Seed DTO fields for the final UI (2026-09-24)", () => {
  it("sends approvedAt only while a step is approved", async () => {
    const fixture = await decisionFixture();
    await fixture.t.run(async (ctx) => {
      const approved = await ctx.db.get(fixture.subsectionIds.company_context!);
      await ctx.db.patch(approved!._id, {
        state: "approved",
        approvedAt: 1_234,
        approvedContextRevision: approved!.currentContextRevision,
        approvedSelectionRevision: approved!.selectionRevision,
      });
      // A step that left "approved" keeps the stored time; it is not sent.
      await ctx.db.patch(fixture.subsectionIds.goal_problem!, {
        state: "in_progress",
        approvedAt: 999,
      });
    });
    const outline = await fixture.writer.query(getOutlineRef, {
      generationId: fixture.generationId,
    });
    const byRole = new Map(outline.rows.map((row) => [row.roleId, row]));
    expect(byRole.get("company_context")?.approvedAt).toBe(1_234);
    expect(byRole.get("goal_problem")?.approvedAt).toBeNull();
    expect(byRole.get("workplan")?.approvedAt).toBeNull();
  });

  it("marks live Summary items edited from the writer's wording, not from support", async () => {
    const fixture = await decisionFixture();
    const batchId = await insertBatch(fixture, 0);
    const [editedId, plainId, assertedId] = await fixture.t.run(async (ctx) => {
      const ids: Id<"seeds">[] = [];
      for (const [order, support] of [
        [0, "source_supported"],
        [1, "source_supported"],
        // Generated as writer_asserted, never edited.
        [2, "writer_asserted"],
      ] as const) {
        const seedId = await ctx.db.insert("seeds", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          batchId,
          roleId: "company_context",
          order,
          bullets: [`Generated idea ${order}.`],
          tags: ["technical"],
          support,
          originalSupport: support,
        });
        await ctx.db.insert("seedSelections", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          roleId: "company_context",
          seedId,
          selected: true,
          selectedAt: 1,
          version: 1,
          orderKey: String(order).padStart(5, "0"),
          ...(order === 0
            ? { editedBullets: ["The writer's own words."], editedBy: fixture.userId, editedAt: 2 }
            : {}),
        });
        await ctx.db.insert("seedProvenance", {
          seedId,
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          sourceId: fixture.sourceId,
          sourceContentHash: "source-hash",
          startOffset: 0,
          endOffset: 1,
          exactExcerpt: `Quoted line ${order}.`,
        });
        ids.push(seedId);
      }
      return ids;
    });
    const items: Array<SummaryResult["page"][number]> = [];
    let cursor: string | null = null;
    let done = false;
    for (let pageNumber = 0; pageNumber < 20 && !done; pageNumber += 1) {
      const result: SummaryResult = await fixture.writer.query(getSummaryRef, {
        generationId: fixture.generationId,
        cursor,
        numItems: 10,
      });
      items.push(...result.page);
      cursor = result.continueCursor;
      done = result.isDone;
    }
    const edited = new Map(items.map((item) => [item.seedId, item.edited]));
    expect(edited.get(editedId)).toBe(true);
    expect(edited.get(plainId)).toBe(false);
    expect(edited.get(assertedId)).toBe(false);
    expect(items.find((item) => item.seedId === assertedId)?.support).toBe("writer_asserted");
    // Exact-quote underlines (decision 17): cited excerpts ride along, except
    // on a hand-edited item, which is the writer's own wording.
    const citations = new Map(items.map((item) => [item.seedId, item.provenance]));
    expect(citations.get(plainId)).toEqual([{ sourceId: fixture.sourceId, exactExcerpt: "Quoted line 1." }]);
    expect(citations.get(editedId)).toEqual([]);
  });

  it("marks frozen Summary items edited when their wording differs from the Seed", async () => {
    const fixture = await decisionFixture();
    const seed = await addDecisionSeed(fixture);
    const summaryVersionId = await fixture.t.run(async (ctx) => {
      const summaryVersionId = await ctx.db.insert("summaryVersions", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        version: 1,
        originGenerationId: fixture.generationId,
        briefVersionId: fixture.briefId,
        settingsHash: "settings",
        skippedRoleIds: [],
        readiness: true,
        signedOffBy: fixture.userId,
        signedOffAt: 1,
      });
      for (const [order, bullets] of [
        [0, ["Original frozen wording."]],
        [1, ["Rewritten by the writer."]],
      ] as const) {
        await ctx.db.insert("summaryItems", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          summaryVersionId,
          roleId: "company_context",
          kind: "standard",
          order,
          seedId: seed.seedId,
          bullets: [...bullets],
          support: order === 0 ? "source_supported" : "writer_asserted",
          tags: ["technical"],
        });
      }
      return summaryVersionId;
    });
    const result: SummaryResult = await fixture.writer.query(getSummaryRef, {
      generationId: fixture.generationId,
      versionId: summaryVersionId,
      cursor: null,
      numItems: 10,
    });
    expect(result.frozen).toBe(true);
    expect(result.page.map((item) => item.edited)).toEqual([false, true]);
  });

  it("trusts a frozen item's stored edit flag over a wording match", async () => {
    const fixture = await decisionFixture();
    const seed = await addDecisionSeed(fixture);
    const summaryVersionId = await fixture.t.run(async (ctx) => {
      await ctx.db.insert("seedProvenance", {
        seedId: seed.seedId,
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        sourceId: fixture.sourceId,
        sourceContentHash: "source-hash",
        startOffset: 0,
        endOffset: 1,
        exactExcerpt: "Original frozen wording.",
      });
      const summaryVersionId = await ctx.db.insert("summaryVersions", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        version: 1,
        originGenerationId: fixture.generationId,
        briefVersionId: fixture.briefId,
        settingsHash: "settings",
        skippedRoleIds: [],
        readiness: true,
        signedOffBy: fixture.userId,
        signedOffAt: 1,
      });
      // Same text as the Seed in all three rows; only the stored flag
      // differs (the third row predates the flag).
      for (const [order, edited] of [[0, true], [1, false], [2, undefined]] as const) {
        await ctx.db.insert("summaryItems", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          summaryVersionId,
          roleId: "company_context",
          kind: "standard",
          order,
          seedId: seed.seedId,
          bullets: ["Original frozen wording."],
          support: edited ? "writer_asserted" : "source_supported",
          tags: ["technical"],
          ...(edited === undefined ? {} : { edited }),
        });
      }
      return summaryVersionId;
    });
    const result: SummaryResult = await fixture.writer.query(getSummaryRef, {
      generationId: fixture.generationId,
      versionId: summaryVersionId,
      cursor: null,
      numItems: 10,
    });
    expect(result.page.map((item) => item.edited)).toEqual([true, false, false]);
    expect(result.page.map((item) => item.provenance.length)).toEqual([0, 1, 1]);
  });

  it("keeps a fourth citation on live and frozen Summary items", async () => {
    const fixture = await decisionFixture();
    const seed = await addDecisionSeed(fixture);
    const excerpts = [
      "First short quote.",
      "Second short quote.",
      "Third short quote.",
      "Original frozen wording.",
    ];
    const summaryVersionId = await fixture.t.run(async (ctx) => {
      await ctx.db.insert("seedSelections", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        roleId: "company_context",
        seedId: seed.seedId,
        selected: true,
        selectedAt: 1,
        version: 1,
        orderKey: "00000",
      });
      for (const [index, exactExcerpt] of excerpts.entries()) {
        await ctx.db.insert("seedProvenance", {
          seedId: seed.seedId,
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          sourceId: fixture.sourceId,
          sourceContentHash: "source-hash",
          startOffset: index,
          endOffset: index + 1,
          exactExcerpt,
        });
      }
      const summaryVersionId = await ctx.db.insert("summaryVersions", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        version: 1,
        originGenerationId: fixture.generationId,
        briefVersionId: fixture.briefId,
        settingsHash: "settings",
        skippedRoleIds: [],
        readiness: true,
        signedOffBy: fixture.userId,
        signedOffAt: 1,
      });
      await ctx.db.insert("summaryItems", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        summaryVersionId,
        roleId: "company_context",
        kind: "standard",
        order: 0,
        seedId: seed.seedId,
        // The displayed phrase is exactly the fourth citation.
        bullets: ["Original frozen wording."],
        support: "source_supported",
        tags: ["technical"],
        edited: false,
      });
      return summaryVersionId;
    });
    const live: SummaryResult = await fixture.writer.query(getSummaryRef, {
      generationId: fixture.generationId,
      cursor: null,
      numItems: 10,
    });
    const frozen: SummaryResult = await fixture.writer.query(getSummaryRef, {
      generationId: fixture.generationId,
      versionId: summaryVersionId,
      cursor: null,
      numItems: 10,
    });
    for (const result of [live, frozen]) {
      const item = result.page.find((candidate) => candidate.seedId === seed.seedId);
      expect(item?.bullets).toEqual(["Original frozen wording."]);
      expect(item?.provenance.map((citation) => citation.exactExcerpt)).toEqual(excerpts);
      expect(item?.provenanceTruncated).toBe(false);
    }
  });
});
