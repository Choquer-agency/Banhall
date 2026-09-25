/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { sha256 } from "./lib/contracts";
import {
  listGenerationSeedProvenance,
  listGenerationSummaryItems,
  listSeedProvenanceInGeneration,
} from "./lib/generationIndexReads";
import { persistDeterministicFindings } from "./lib/qaFindings";
import {
  missingSectionRunTypedFields,
  sectionRunTypedFields,
  toSelfCheckSummaryData,
  toSlotCountsData,
  toTranscriptDigestStructuredData,
} from "./lib/sectionRunData";
import type { OrderedPayload } from "./lib/orderedChain";
import { buildTiptapDocument } from "./lib/tiptapReport";
import { readDigestStructured } from "./transcriptDigests";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});
const AUTH_ID = "typed-fields-writer";

const METRICS = {
  lines: 10,
  words: 90,
  paragraphs: 2,
  limit: 30,
  wordCap: 350,
  overLimit: false,
  rawLines: 10,
  rawWords: 90,
  overLimitWithGaps: false,
};
const QA = [{ check: "banned_word", message: 'Banned word "robust": the robust part' }];
const SELF_CHECK = {
  status: "repair_attempted",
  repairAttempted: true,
  failedChecks: 2,
  remainingFailures: 0,
  modelCheck: "ok",
  planCoverage: { status: "complete", applied: 3, total: 3 },
};
const SLOT_COUNTS = { "generation:section:242": 1, "generation:selfCheck:242": 1 };
const DIGEST_WINDOW = {
  participants: ["Dana (CTO)"],
  timeline: ["March 2024: prototype"],
  technologicalUncertainties: ["Whether the alloy resists fatigue"],
  hypotheses: ["Heat treatment helps"],
  experiments: [
    { problem: "Fatigue", approach: "Cycle test", result: "Cracks", conclusion: "Retry", dates: "2024" },
  ],
  resultsAndNumbers: ["12% failure rate"],
  namesAndSystems: ["Alloy 7"],
  keyQuotes: ["\"It cracked at 10k cycles\""],
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "writer", name: "Writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Typed fields",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      ownerId: userId,
      shareToken: "typed-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content: "Interview", createdAt: now });
    return { userId, projectId, transcriptId };
  });
  return { t, authed: t.withIdentity({ subject: AUTH_ID }), ...ids };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function insertGeneration(
  f: Fixture,
  fields: { candidateMode: "compare" | "single" | "iterative"; status: "running" | "awaiting_input" | "completed" }
) {
  return await f.t.run(async (ctx) => {
    const generationId = await ctx.db.insert("generations", {
      projectId: f.projectId,
      transcriptId: f.transcriptId,
      requestedBy: f.userId,
      startedAt: Date.now(),
      ...fields,
    });
    await ctx.db.patch(f.projectId, { activeGenerationId: generationId });
    return generationId;
  });
}

describe("strict typed conversion", () => {
  it("copies known shapes exactly", () => {
    expect(
      sectionRunTypedFields({
        metrics: JSON.stringify(METRICS),
        qa: JSON.stringify(QA),
        selfCheck: JSON.stringify(SELF_CHECK),
        slotCounts: JSON.stringify(SLOT_COUNTS),
      })
    ).toEqual({ metricsData: METRICS, qaData: QA, selfCheckData: SELF_CHECK, slotCountsData: SLOT_COUNTS });
    expect(toTranscriptDigestStructuredData([DIGEST_WINDOW])).toEqual([DIGEST_WINDOW]);
  });

  it("leaves unknown keys, wrong types and malformed JSON as strings only", () => {
    expect(sectionRunTypedFields({ metrics: "{not json" })).toEqual({});
    expect(sectionRunTypedFields({ metrics: JSON.stringify({ ...METRICS, extra: 1 }) })).toEqual({});
    expect(sectionRunTypedFields({ qa: JSON.stringify([{ check: "x" }]) })).toEqual({});
    expect(toSelfCheckSummaryData({ ...SELF_CHECK, status: "unknown" })).toBeUndefined();
    expect(toSlotCountsData({ _private: 1 })).toBeUndefined();
    expect(toSlotCountsData({ slot: "1" })).toBeUndefined();
    expect(toTranscriptDigestStructuredData([{ ...DIGEST_WINDOW, experiments: [{ problem: "x" }] }])).toBeUndefined();
  });

  it("backfills only the typed fields a row is missing", () => {
    const row = {
      metrics: JSON.stringify(METRICS),
      metricsData: METRICS,
      qa: JSON.stringify(QA),
      selfCheck: "{broken",
    } as unknown as Parameters<typeof missingSectionRunTypedFields>[0];
    expect(missingSectionRunTypedFields(row)).toEqual({ qaData: QA });
  });
});

describe("generationSectionRuns dual write and dual read", () => {
  it("completeSectionRun writes the typed copies next to the strings", async () => {
    const f = await setup();
    const generationId = await insertGeneration(f, { candidateMode: "iterative", status: "running" });
    await f.t.run(async (ctx) =>
      ctx.db.insert("generationSectionRuns", {
        generationId,
        projectId: f.projectId,
        section: "s242",
        status: "running",
        model: "model",
        label: "Model",
        attempt: 1,
        queuedAt: 1,
      })
    );
    await f.t.mutation(internal.generations.completeSectionRun, {
      generationId,
      section: "s242",
      draftText: "Draft",
      metrics: JSON.stringify(METRICS),
      qa: JSON.stringify(QA),
    });
    const [row] = await f.t.run(async (ctx) => ctx.db.query("generationSectionRuns").collect());
    expect(row.metrics).toBe(JSON.stringify(METRICS));
    expect(row.metricsData).toEqual(METRICS);
    expect(row.qaData).toEqual(QA);
  });

  it("completeOrderedSectionRun writes typed Self-check, metrics and slot counts", async () => {
    const f = await setup();
    const generationId = await insertGeneration(f, { candidateMode: "single", status: "running" });
    const candidateRunId = await f.t.run(async (ctx) => {
      const runId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId: f.projectId,
        model: "model",
        label: "Model",
        status: "running",
        queuedAt: 1,
        startedAt: 1,
      });
      for (const [index, section] of (["s242", "s244"] as const).entries()) {
        await ctx.db.insert("generationSectionRuns", {
          generationId,
          projectId: f.projectId,
          section,
          status: index === 0 ? "running" : "pending",
          model: "model",
          label: "Model",
          attempt: 1,
          candidateRunId: runId,
          orderIndex: index,
          queuedAt: 1,
        });
      }
      return runId;
    });
    const payload: OrderedPayload = {
      analysis: "{}",
      brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
      orderedContext: {
        profileState: "applied",
        categoryOutcomes: [],
        buildOrder: ["242", "244"],
        selfCheckRules: [],
      },
    };
    expect(
      await f.t.mutation(internal.generations.completeOrderedSectionRun, {
        generationId,
        candidateRunId,
        section: "242",
        draftText: "Draft",
        metrics: JSON.stringify(METRICS),
        selfCheck: JSON.stringify(SELF_CHECK),
        slotCounts: JSON.stringify(SLOT_COUNTS),
        notes: [],
        payload,
      })
    ).toBe(true);
    const row = await f.t.run(async (ctx) =>
      ctx.db
        .query("generationSectionRuns")
        .withIndex("by_candidateRunId_and_section", (q) =>
          q.eq("candidateRunId", candidateRunId).eq("section", "s242")
        )
        .unique()
    );
    expect(row?.status).toBe("drafted");
    expect(row?.selfCheck).toBe(JSON.stringify(SELF_CHECK));
    expect(row?.selfCheckData).toEqual(SELF_CHECK);
    expect(row?.slotCountsData).toEqual(SLOT_COUNTS);
    expect(row?.metricsData).toEqual(METRICS);
    const drafts = await f.t.query(internal.generations.getOrderedCandidateDrafts, {
      generationId,
      candidateRunId,
    });
    expect(drafts?.sections.length).toBe(2);
  });

  it("reads a legacy string-only row and a typed-only row the same way", async () => {
    const f = await setup();
    const legacyId = await insertGeneration(f, { candidateMode: "iterative", status: "awaiting_input" });
    const typedId = await insertGeneration(f, { candidateMode: "iterative", status: "awaiting_input" });
    await f.t.run(async (ctx) => {
      const base = {
        projectId: f.projectId,
        section: "s242" as const,
        status: "awaiting_review" as const,
        draftText: "Draft",
        model: "model",
        label: "Model",
        attempt: 1,
        queuedAt: 1,
      };
      await ctx.db.insert("generationSectionRuns", {
        ...base,
        generationId: legacyId,
        metrics: JSON.stringify(METRICS),
        qa: JSON.stringify(QA),
      });
      await ctx.db.insert("generationSectionRuns", {
        ...base,
        generationId: typedId,
        metricsData: METRICS,
        qaData: QA,
      });
    });
    const legacy = await f.authed.query(api.generations.getIterativeState, { generationId: legacyId });
    const typed = await f.authed.query(api.generations.getIterativeState, { generationId: typedId });
    expect(legacy?.sectionRuns[0].metrics).toMatchObject({ lines: 10, words: 90, overLimit: false });
    expect(typed?.sectionRuns[0].metrics).toEqual(legacy?.sectionRuns[0].metrics);
    expect(typed?.sectionRuns[0].qa).toEqual(QA);
    expect(legacy?.sectionRuns[0].qa).toEqual(QA);
  });

  it("serves the finalizer a JSON string for a typed-only ordered row", async () => {
    const f = await setup();
    const generationId = await insertGeneration(f, { candidateMode: "single", status: "running" });
    const candidateRunId = await f.t.run(async (ctx) => {
      const runId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId: f.projectId,
        model: "model",
        label: "Model",
        status: "running",
        queuedAt: 1,
      });
      await ctx.db.insert("generationSectionRuns", {
        generationId,
        projectId: f.projectId,
        section: "s242",
        status: "drafted",
        draftText: "Draft",
        model: "model",
        label: "Model",
        attempt: 1,
        candidateRunId: runId,
        orderIndex: 0,
        queuedAt: 1,
        selfCheckData: SELF_CHECK as never,
        slotCountsData: SLOT_COUNTS,
        metricsData: METRICS,
      });
      return runId;
    });
    const drafts = await f.t.query(internal.generations.getOrderedCandidateDrafts, {
      generationId,
      candidateRunId,
    });
    const section = drafts?.sections[0];
    expect(JSON.parse(section?.selfCheck ?? "null")).toEqual(SELF_CHECK);
    expect(JSON.parse(section?.slotCounts ?? "null")).toEqual(SLOT_COUNTS);
    expect(JSON.parse(section?.metrics ?? "null")).toEqual(METRICS);
  });

  it("backfills older rows once and is idempotent", async () => {
    vi.useFakeTimers();
    const f = await setup();
    const generationId = await insertGeneration(f, { candidateMode: "iterative", status: "awaiting_input" });
    await f.t.run(async (ctx) => {
      for (const [index, section] of (["s242", "s244", "s246"] as const).entries()) {
        await ctx.db.insert("generationSectionRuns", {
          generationId,
          projectId: f.projectId,
          section,
          status: "awaiting_review",
          model: "model",
          label: "Model",
          attempt: 1,
          queuedAt: 1,
          // The last row carries a string that does not convert strictly.
          metrics: index === 2 ? "{broken" : JSON.stringify(METRICS),
          qa: JSON.stringify(QA),
        });
      }
    });
    const dry = await f.t.mutation(internal.generations.backfillSectionRunData, { dryRun: true });
    expect(dry.patched).toBe(3);
    expect(
      (await f.t.run(async (ctx) => ctx.db.query("generationSectionRuns").collect())).every(
        (row) => row.qaData === undefined
      )
    ).toBe(true);

    const first = await f.t.mutation(internal.generations.backfillSectionRunData, { pageSize: 2 });
    expect(first.isDone).toBe(false);
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    vi.useRealTimers();
    const rows = await f.t.run(async (ctx) => ctx.db.query("generationSectionRuns").collect());
    expect(rows.every((row) => JSON.stringify(row.qaData) === JSON.stringify(QA))).toBe(true);
    expect(rows.filter((row) => row.metricsData !== undefined)).toHaveLength(2);
    expect(rows.find((row) => row.section === "s246")?.metrics).toBe("{broken");

    const again = await f.t.mutation(internal.generations.backfillSectionRunData, {});
    expect(again.patched).toBe(0);
  });
});

describe("transcriptDigests.structuredData", () => {
  it("writes the typed windows with new digests and backfills older ones idempotently", async () => {
    const f = await setup();
    const structured = JSON.stringify([DIGEST_WINDOW]);
    const newId = await f.t.mutation(internal.transcriptDigests.recordDigest, {
      transcriptId: f.transcriptId,
      projectId: f.projectId,
      sourceContentHash: "hash-new",
      content: "Digest",
      structured,
      model: "model",
      promptVersion: "v",
      originalLength: 9,
    });
    const legacyId = await f.t.run(async (ctx) =>
      ctx.db.insert("transcriptDigests", {
        transcriptId: f.transcriptId,
        projectId: f.projectId,
        sourceContentHash: "hash-old",
        condenseVersion: "old",
        content: "Digest",
        structured,
        model: "model",
        promptVersion: "v",
        charCount: 6,
        originalLength: 9,
        createdAt: 1,
      })
    );
    const before = await f.t.run(async (ctx) => ({
      fresh: await ctx.db.get(newId),
      legacy: await ctx.db.get(legacyId),
    }));
    expect(before.fresh?.structuredData).toEqual([DIGEST_WINDOW]);
    expect(before.legacy?.structuredData).toBeUndefined();
    // Dual read: the legacy row reads the same windows from its string.
    expect(readDigestStructured(before.legacy!)).toEqual([DIGEST_WINDOW]);

    const first = await f.t.mutation(internal.transcriptDigests.backfillStructuredData, {});
    expect(first).toMatchObject({ patched: 1, isDone: true });
    const legacy = await f.t.run(async (ctx) => ctx.db.get(legacyId));
    expect(legacy?.structuredData).toEqual([DIGEST_WINDOW]);
    const again = await f.t.mutation(internal.transcriptDigests.backfillStructuredData, {});
    expect(again.patched).toBe(0);
  });
});

describe("index-backed reads", () => {
  it("getModelComments reads one model's comments newest first through its index", async () => {
    const f = await setup();
    const generationId = await insertGeneration(f, { candidateMode: "compare", status: "completed" });
    await f.t.run(async (ctx) => {
      const candidateId = await ctx.db.insert("reportCandidates", {
        projectId: f.projectId,
        generationId,
        model: "model-a",
        label: "A",
        content: "x",
        agentOutputs: "{}",
        createdAt: 1,
      });
      const row = (model: string, updatedAt: number, comment?: string) =>
        ctx.db.insert("candidateScores", {
          projectId: f.projectId,
          generationId,
          candidateId,
          optionPosition: 1,
          model,
          label: model,
          userId: f.userId,
          score: updatedAt,
          ...(comment ? { comment } : {}),
          createdAt: updatedAt,
          updatedAt,
        });
      await row("model-a", 1, "oldest");
      await row("model-a", 3, "newest");
      await row("model-a", 2);
      await row("model-b", 4, "other model");
      for (let index = 0; index < 55; index += 1) await row("model-c", 100 + index, `c${index}`);
    });
    expect(await f.t.query(internal.generations.getModelComments, { model: "model-a" })).toEqual([
      { comment: "newest", score: 3 },
      { comment: "oldest", score: 1 },
    ]);
    const capped = await f.t.query(internal.generations.getModelComments, { model: "model-c" });
    expect(capped).toHaveLength(50);
    expect(capped[0].comment).toBe("c54");
  });

  it("reads Seed provenance and Summary items by generation", async () => {
    const f = await setup();
    const [first, second] = [
      await insertGeneration(f, { candidateMode: "iterative", status: "awaiting_input" }),
      await insertGeneration(f, { candidateMode: "iterative", status: "awaiting_input" }),
    ];
    const seeded = await f.t.run(async (ctx) => {
      const out: Record<string, { seedId: Id<"seeds"> }> = {};
      for (const generationId of [first, second]) {
        const sourceId = await ctx.db.insert("generationSources", {
          generationId,
          projectId: f.projectId,
          kind: "transcript",
          label: "T",
          content: "quote",
          contentHash: await sha256("quote"),
          truncated: false,
          originalLength: 5,
          capturedAt: 1,
        });
        const briefVersionId = await ctx.db.insert("generationBriefs", {
          projectId: f.projectId,
          generationId,
          inputsHash: "h",
          version: 1,
          origin: "derived",
          storylineText: "",
          droppedEntryCount: 0,
          createdAt: 1,
        });
        const batchId = await ctx.db.insert("seedBatches", {
          projectId: f.projectId,
          generationId,
          roleId: "goal_problem",
          operation: "open",
          dedupeKey: `open:${generationId}`,
          commandId: "command",
          attemptId: "attempt",
          consumedContextRevision: "revision",
          briefVersionId,
          settingsHash: "settings",
          status: "shown",
          queuedAt: 1,
          leaseExpiresAt: 2,
          model: "model",
          slot: "seed",
          promptVersion: "v",
          requestsReserved: 1,
        });
        const seedId = await ctx.db.insert("seeds", {
          projectId: f.projectId,
          generationId,
          batchId,
          roleId: "goal_problem",
          order: 0,
          bullets: ["b"],
          tags: [],
          support: "source_supported",
          originalSupport: "source_supported",
        });
        await ctx.db.insert("seedProvenance", {
          seedId,
          projectId: f.projectId,
          generationId,
          sourceId,
          sourceContentHash: await sha256("quote"),
          startOffset: 0,
          endOffset: 5,
          exactExcerpt: "quote",
        });
        const summaryVersionId = await ctx.db.insert("summaryVersions", {
          projectId: f.projectId,
          generationId,
          version: 1,
          originGenerationId: generationId,
          briefVersionId,
          reportTitle: "T",
          settingsHash: "s",
          skippedRoleIds: [],
          readiness: true,
          signedOffBy: f.userId,
          signedOffAt: 1,
        });
        await ctx.db.insert("summaryItems", {
          projectId: f.projectId,
          generationId,
          summaryVersionId,
          roleId: "goal_problem",
          kind: "standard",
          order: 0,
          seedId,
          bullets: ["b"],
          support: "source_supported",
          tags: [],
        });
        out[generationId] = { seedId };
      }
      return out;
    });
    const reads = await f.t.run(async (ctx) => ({
      provenance: await listGenerationSeedProvenance(ctx, first, 10),
      scoped: await listSeedProvenanceInGeneration(ctx, second, seeded[first].seedId, 10),
      items: await listGenerationSummaryItems(ctx, second, 10),
      capped: await listGenerationSummaryItems(ctx, first, 0),
    }));
    expect(reads.provenance.rows.map((row) => row.generationId)).toEqual([first]);
    expect(reads.provenance.complete).toBe(true);
    expect(reads.scoped.rows).toEqual([]);
    expect(reads.items.rows.map((row) => row.generationId)).toEqual([second]);
    expect(reads.capped).toEqual({ rows: [], complete: false });
  });

  it("carries an established methodology failure forward through the check index", async () => {
    const f = await setup();
    const content = JSON.stringify(buildTiptapDocument("T", "Uncertain because unknown.", "Work", "Advance"));
    const reportId = await f.t.run(async (ctx) =>
      ctx.db.insert("reports", {
        projectId: f.projectId,
        content,
        contentHash: await sha256(content),
        revisionNumber: 0,
        version: 1,
        generatedAt: 1,
        updatedAt: 1,
      })
    );
    await f.t.run(async (ctx) => {
      await ctx.db.insert("qaFindings", {
        section: "report",
        reportId,
        revisionNumber: 0,
        contentHash: await sha256(content),
        check: "cra_methodology",
        message: "uncertainties_distinguished",
        blocking: true,
      });
      // The same bytes at a later revision (a restoration).
      await ctx.db.patch(reportId, { revisionNumber: 4 });
      await persistDeterministicFindings(ctx, reportId);
    });
    const rows = await f.t.run(async (ctx) => ctx.db.query("qaFindings").collect());
    const methodology = rows.filter((row) => row.check === "cra_methodology");
    expect(methodology.map((row) => [row.revisionNumber, row.message]).sort()).toEqual([
      [0, "uncertainties_distinguished"],
      [4, "uncertainties_distinguished"],
    ]);
  });
});
