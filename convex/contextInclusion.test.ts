/// <reference types="vite/client" />
// Story 4 (CAP-11, AD-30): per-document inclusion is recorded once per frozen
// `generationSources` row by `recordContextBudget` and read through the one
// query, `generations.getContextInclusion`.
import { withSourceTexts } from "./lib/sourceText";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { buildTrustedContext, type ContextDoc } from "./ai/trustedContext";
import { recordAnalyzerUse } from "./ai/pipeline";
import { copyRecoverySourceUses, MAX_PART_RECORDS_PER_RUN, MAX_SOURCE_USE_ENTRIES } from "./lib/generations/sourceUse";
import { MAX_FROZEN_SOURCE_ROWS } from "./lib/briefEvidence";
import type { ActionCtx } from "./_generated/server";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;
const authId = "inclusion-writer";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

// DW-133 review: the real 16 MiB read limit is enforced, so a query that
// would throw in production throws here too.
async function setup(options: { transcript?: boolean } = {}) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Inclusion project",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      ownerId: userId,
      shareToken: "inclusion-token",
      createdAt: now,
      updatedAt: now,
    });
    if (options.transcript !== false) {
      await ctx.db.insert("transcripts", {
        projectId,
        content: "Interview body about the control loop.",
        createdAt: now,
      });
    }
    return { userId, projectId };
  });
  return { t, authed: t.withIdentity({ subject: authId }), ...ids };
}

/** Feed recordContextBudget exactly as convex/ai/pipeline.ts's helper does. */
async function recordFromRealReport(t: TestConvex, generationId: Id<"generations">) {
  const input = await t.query(internal.generations.getGenerationInput, { generationId });
  expect(input).not.toBeNull();
  const documents: ContextDoc[] = input!.contextDocs.map((document) => ({
    category: "other",
    fileName: document.fileName,
    content: document.content,
    sourceId: document.sourceId,
  }));
  const { report } = buildTrustedContext({
    transcriptParts: input!.transcriptParts,
    documents,
    budget: input!.contextBudget,
  });
  await t.mutation(internal.generations.recordContextBudget, {
    generationId,
    budgetTokens: report.budget.totalTokens,
    maxDocuments: report.budget.maxDocuments,
    applied: report.sources.flatMap((source) =>
      source.sourceId
        ? [
            {
              sourceId: source.sourceId,
              included: source.included,
              includedLength: source.includedLength,
              truncated: source.truncated,
            },
          ]
        : []
    ),
  });
  // Phase D (step 2, review): the analyzer's record is written once its
  // request has answered, by the same helper the pipeline calls.
  await recordAnalyzerUse(actionCtxOf(t), generationId, report);
  return report;
}

/** The one action call recordAnalyzerUse makes, run against the test backend. */
function actionCtxOf(t: TestConvex): ActionCtx {
  return {
    runMutation: (reference: unknown, args: unknown) =>
      t.mutation(reference as typeof internal.generations.recordSourceUse, args as never),
  } as unknown as ActionCtx;
}

describe("what each step read, in the Inputs band (Phase D, step 2)", () => {
  it("the analyzer's record and a Seed Batch's show on their rows", async () => {
    const { t, authed, projectId } = await setup();
    for (let index = 0; index < 13; index += 1) {
      await authed.mutation(api.documents.uploadDocument, {
        projectId, fileName: `attachment-${index}.txt`, fileType: "txt", content: `Readable internal document number ${index}.`,
      });
    }
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    await recordFromRealReport(t, generationId);
    const frozen = await t.run(async (ctx) =>
      withSourceTexts(ctx, await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect())
    );
    const last = frozen.filter((row) => row.kind === "project_document").at(-1)!;
    await t.mutation(internal.generations.recordSourceUse, {
      generationId, step: "seeds", run: "batch-1",
      uses: [{ sourceId: last._id, sent: 10, total: 40, unit: "bytes" }],
    });
    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    const row = inclusion!.rows.find((entry) => entry.key === `source:${last._id}`)!;
    // The 13th file is past the analyzer's cap of 12: it was left out there, read in part by the Batch.
    expect(row.uses).toEqual([
      { step: "analyzer", runs: 1, read: 0, whole: false },
      { step: "seeds", runs: 1, read: 1, whole: false, share: 0.25 },
    ]);
    const first = inclusion!.rows.find((entry) => entry.kind === "document")!;
    expect(first.uses).toEqual([{ step: "analyzer", runs: 1, read: 1, whole: true }]);
  });

  it("a record that cannot be written never fails the analyzer (review)", async () => {
    const { t, authed, projectId } = await setup();
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    const input = await t.query(internal.generations.getGenerationInput, { generationId });
    const { report } = buildTrustedContext({
      transcriptParts: input!.transcriptParts,
      documents: [],
      budget: input!.contextBudget,
    });
    const failing = {
      runMutation: () => Promise.reject(new Error("write refused")),
    } as unknown as ActionCtx;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordAnalyzerUse(failing, generationId, report)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Analyzer source use not recorded", expect.stringContaining("write refused"));
    warn.mockRestore();
  });

  it("reads each step on its own, so one step's many rows never hide another's (review, re-check)", async () => {
    const { t, authed, projectId } = await setup();
    await authed.mutation(api.documents.uploadDocument, {
      projectId, fileName: "notes.txt", fileType: "txt", content: "Readable internal notes.",
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    const document = await t.run(async (ctx) =>
      ((await withSourceTexts(ctx, await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect())))
        .find((row) => row.kind === "project_document")!
    );
    // More Seed rows than the old shared read of 6,000, written first; the
    // facts check's last.
    for (let batch = 0; batch < 7; batch += 1) {
      await t.run(async (ctx) => {
        for (let index = 0; index < 1_000; index += 1) {
          await ctx.db.insert("generationSourceUse", {
            generationId, projectId, step: "seeds", run: `role-${batch}-${index}`, sourceId: document._id,
            state: "whole", sent: 10, total: 10, unit: "bytes", at: index,
          });
        }
      });
    }
    await t.mutation(internal.generations.recordSourceUse, {
      generationId, step: "facts_check", run: "line:242",
      uses: [{ sourceId: document._id, sent: 10, total: 10, unit: "bytes" }],
    });
    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    const row = inclusion!.rows.find((entry) => entry.key === `source:${document._id}`)!;
    expect(row.uses).toEqual([
      { step: "seeds", runs: 2_500, read: 2_500, whole: true },
      { step: "facts_check", runs: 1, read: 1, whole: true },
    ]);
    // The Seed records were cut short, and the band says so.
    expect(inclusion!.usesTruncated).toBe(true);
  });

  it("a run that reads no more of a row than before adds no record (re-check)", async () => {
    const { t, authed, projectId } = await setup();
    await authed.mutation(api.documents.uploadDocument, {
      projectId, fileName: "notes.txt", fileType: "txt", content: "Readable internal notes.",
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    const document = await t.run(async (ctx) =>
      ((await withSourceTexts(ctx, await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect())))
        .find((row) => row.kind === "project_document")!
    );
    const record = (sent: number) =>
      t.mutation(internal.generations.recordSourceUse, {
        generationId, step: "seeds", run: "company_context",
        uses: [{ sourceId: document._id, sent, total: 10, unit: "bytes" }],
      });
    await record(4);
    await record(4);
    await record(0);
    await record(10);
    await record(10);
    const rows = await t.run((ctx) =>
      ctx.db.query("generationSourceUse").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(rows.map((row) => row.state)).toEqual(["part", "whole"]);
  });

  it("a read in part keeps the excerpts it sent, and the band says how much (Phase D, step 1)", async () => {
    const { t, authed, projectId } = await setup();
    await authed.mutation(api.documents.uploadDocument, {
      projectId, fileName: "notes.txt", fileType: "txt", content: "Readable internal notes.",
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    const document = await t.run(async (ctx) =>
      ((await withSourceTexts(ctx, await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect())))
        .find((row) => row.kind === "project_document")!
    );
    const record = (run: string, sent: number, ranges?: Array<{ start: number; end: number }>) =>
      t.mutation(internal.generations.recordSourceUse, {
        generationId, step: "facts_check", run,
        uses: [{ sourceId: document._id, sent, total: 40, unit: "bytes", ...(ranges ? { ranges } : {}) }],
      });
    await record("line:242", 8, [{ start: 0, end: 4 }, { start: 10, end: 14 }]);
    // The same excerpts again add nothing; other excerpts add a record.
    await record("line:242", 8, [{ start: 0, end: 4 }, { start: 10, end: 14 }]);
    await record("line:242", 12, [{ start: 20, end: 32 }]);
    // A read in part with no excerpts known adds nothing after one.
    await record("line:242", 12);
    // Excerpts out of order, or more than a record keeps, are not kept.
    await record("line:244", 6, [{ start: 10, end: 14 }, { start: 0, end: 4 }]);
    await record("line:246", 9, Array.from({ length: 257 }, (_, index) => ({ start: index * 2, end: index * 2 + 1 })));
    // A whole read keeps none.
    await record("line:248", 40, [{ start: 0, end: 40 }]);
    // At most 4 records in part of one row in one run, each with other parts (review).
    for (let start = 0; start < 6; start += 1) await record("line:250", 3, [{ start, end: start + 3 }]);
    const rows = await t.run((ctx) =>
      ctx.db.query("generationSourceUse").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(rows.map((row) => [row.run, row.state, row.ranges ?? null])).toEqual([
      ["line:242", "part", [{ start: 0, end: 4 }, { start: 10, end: 14 }]],
      ["line:242", "part", [{ start: 20, end: 32 }]],
      ["line:244", "part", null],
      ["line:246", "part", null],
      ["line:248", "whole", null],
      ...[0, 1, 2, 3].map((start) => ["line:250", "part", [{ start, end: start + 3 }]]),
    ]);
    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    const row = inclusion!.rows.find((entry) => entry.key === `source:${document._id}`)!;
    // One Line read it whole, so the step shows no share.
    expect(row.uses).toEqual([{ step: "facts_check", runs: 5, read: 5, whole: false }]);
    await t.run(async (ctx) => {
      for (const use of rows.filter((entry) => entry.run === "line:248")) await ctx.db.delete(use._id);
    });
    const after = await authed.query(api.generations.getContextInclusion, { generationId });
    // The widest Line read 30% (line 242's second record), in one excerpt.
    expect(after!.rows.find((entry) => entry.key === `source:${document._id}`)!.uses).toEqual([
      { step: "facts_check", runs: 4, read: 4, whole: false, share: 0.3, parts: 1 },
    ]);
  });

  it("one run's records of every frozen row fit the writer's read of earlier records (review, round 2)", () => {
    // Left out, the reads in part, and whole: the most records one run keeps of a row.
    expect(MAX_FROZEN_SOURCE_ROWS * (2 + MAX_PART_RECORDS_PER_RUN)).toBeLessThanOrEqual(MAX_SOURCE_USE_ENTRIES * 4);
  });

  it("a reused Brief's and a Summary recovery's copies keep the excerpts (Phase D, step 1)", async () => {
    const { t, authed, projectId } = await setup();
    await authed.mutation(api.documents.uploadDocument, {
      projectId, fileName: "notes.txt", fileType: "txt", content: "Readable internal notes.",
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    const document = await t.run(async (ctx) =>
      ((await withSourceTexts(ctx, await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect())))
        .find((row) => row.kind === "project_document")!
    );
    const ranges = [{ start: 2, end: 9 }, { start: 12, end: 20 }];
    await t.mutation(internal.generations.recordSourceUse, {
      generationId, step: "brief",
      uses: [{ sourceId: document._id, contentHash: document.contentHash, sent: 15, total: 24, unit: "chars", ranges }],
    });
    const { recovery, copy } = await t.run(async (ctx) => {
      const recovery = await ctx.db.insert("generations", {
        projectId, status: "reserved", requestedBy: (await ctx.db.get(generationId))!.requestedBy, startedAt: 1,
      });
      const copy = await ctx.db.insert("generationSources", {
        generationId: recovery, projectId, kind: "project_document", label: document.label, content: document.content,
        contentHash: document.contentHash, truncated: false, originalLength: document.originalLength, capturedAt: 1,
      });
      await copyRecoverySourceUses(ctx, generationId, { _id: recovery, projectId }, new Map([[document._id, copy]]));
      return { recovery, copy };
    });
    const briefId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId, generationId, inputsHash: "brief-inputs", version: 1, origin: "derived", storylineText: "Storyline.", createdAt: 1,
      })
    );
    const reused = await t.run(async (ctx) =>
      ctx.db.insert("generations", { projectId, status: "reserved", requestedBy: (await ctx.db.get(generationId))!.requestedBy, startedAt: 2 })
    );
    const reusedRow = await t.run((ctx) =>
      ctx.db.insert("generationSources", {
        generationId: reused, projectId, kind: "project_document", label: document.label, content: document.content,
        contentHash: document.contentHash, truncated: false, originalLength: document.originalLength, capturedAt: 2,
      })
    );
    await t.mutation(internal.generations.copyBriefSourceUse, {
      generationId: reused, briefId, sources: [{ sourceId: reusedRow, contentHash: document.contentHash! }],
    });
    const copies = await t.run(async (ctx) => [
      ...(await ctx.db.query("generationSourceUse").withIndex("by_generationId", (q) => q.eq("generationId", recovery)).collect()),
      ...(await ctx.db.query("generationSourceUse").withIndex("by_generationId", (q) => q.eq("generationId", reused)).collect()),
    ]);
    expect(copies.map((row) => [row.sourceId, row.run ?? null, row.ranges])).toEqual([
      [copy, null, ranges],
      [reusedRow, "reused", ranges],
    ]);
  });

  it("a Summary recovery that cannot copy every record says so on its band (re-check)", async () => {
    const { t, authed, projectId } = await setup();
    await authed.mutation(api.documents.uploadDocument, {
      projectId, fileName: "notes.txt", fileType: "txt", content: "Readable internal notes.",
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    const document = await t.run(async (ctx) =>
      ((await withSourceTexts(ctx, await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect())))
        .find((row) => row.kind === "project_document")!
    );
    for (let batch = 0; batch < 3; batch += 1) {
      await t.run(async (ctx) => {
        for (let index = 0; index < 1_000; index += 1) {
          await ctx.db.insert("generationSourceUse", {
            generationId, projectId, step: "seeds", run: `role-${batch}-${index}`, sourceId: document._id,
            state: "whole", sent: 10, total: 10, unit: "bytes", at: index,
          });
        }
      });
    }
    const copied = await t.run(async (ctx) => {
      const recovery = await ctx.db.insert("generations", {
        projectId, status: "reserved", requestedBy: (await ctx.db.get(generationId))!.requestedBy, startedAt: 1,
      });
      const copy = await ctx.db.insert("generationSources", {
        generationId: recovery, projectId, kind: "project_document", label: document.label, content: document.content,
        contentHash: document.contentHash, truncated: false, originalLength: document.originalLength, capturedAt: 1,
      });
      const result = await copyRecoverySourceUses(ctx, generationId, { _id: recovery, projectId }, new Map([[document._id, copy]]));
      const rows = await ctx.db.query("generationSourceUse").withIndex("by_generationId", (q) => q.eq("generationId", recovery)).collect();
      return { result, rows: rows.length };
    });
    expect(copied).toEqual({ result: { truncated: true }, rows: 2_500 });
  });
});

describe("getContextInclusion (story 4)", () => {
  it("40 uploaded documents: all frozen, 12 in context under cap 12, inclusion stored per row", async () => {
    const { t, authed, projectId } = await setup();
    for (let index = 0; index < 40; index += 1) {
      await authed.mutation(api.documents.uploadDocument, {
        projectId,
        fileName: `attachment-${index}.txt`,
        fileType: "txt",
        content: `Readable internal document number ${index}.`,
      });
    }
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });

    const frozen = await t.run(async (ctx) =>
      withSourceTexts(ctx, await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect())
    );
    expect(frozen.filter((row) => row.kind === "project_document")).toHaveLength(40);

    await recordFromRealReport(t, generationId);

    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion).not.toBeNull();
    expect(inclusion!.recorded).toBe(true);
    expect(inclusion!.cap).toBe(12);
    expect(inclusion!.documentsInContext).toBe(12);
    expect(inclusion!.documentsTotal).toBe(40);
    expect(inclusion!.rows[0]).toMatchObject({ kind: "transcript", inclusion: "included" });
    const documentRows = inclusion!.rows.filter((row) => row.kind === "document");
    expect(documentRows).toHaveLength(40);
    expect(documentRows.filter((row) => row.inclusion === "included")).toHaveLength(12);
    expect(documentRows.filter((row) => row.inclusion === "not_included")).toHaveLength(28);

    const recorded = await t.run(async (ctx) =>
      withSourceTexts(ctx, await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect())
    );
    for (const row of recorded) {
      expect(row.inclusion).toBeDefined();
      expect(row.contextBudget?.maxDocuments).toBe(12);
    }
    expect(
      recorded.filter((row) => row.kind === "project_document" && row.inclusion === "included")
    ).toHaveLength(12);
  });

  it("lists a readable document the reservation never captured, in the counts", async () => {
    const { t, authed, projectId } = await setup();
    // reserveGeneration freezes a bounded number of documents; the ones past
    // that bound must still appear, never vanish from the band.
    for (let index = 0; index < 51; index += 1) {
      await authed.mutation(api.documents.uploadDocument, {
        projectId,
        fileName: `attachment-${index}.txt`,
        fileType: "txt",
        content: `Readable internal document number ${index}.`,
      });
    }
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    const frozen = await t.run(async (ctx) =>
      withSourceTexts(ctx, await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect())
    );
    expect(frozen.filter((row) => row.kind === "project_document")).toHaveLength(50);

    await recordFromRealReport(t, generationId);
    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion!.documentsTotal).toBe(51);
    const uncaptured = inclusion!.rows.filter((row) => row.reason === "not_captured");
    expect(uncaptured).toHaveLength(1);
    expect(uncaptured[0]).toMatchObject({ label: "attachment-50.txt", inclusion: "not_included" });
  });

  it("101 documents: every attached document is counted, past the old 100-row fetch bound (DW-133)", async () => {
    const { t, authed, projectId, userId } = await setup();
    await t.run(async (ctx) => {
      const now = Date.now() - 1_000;
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("projectDocuments", {
          projectId,
          fileName: `attachment-${index}.txt`,
          fileType: "txt",
          content: `Readable internal document number ${index}.`,
          source: "upload",
          uploadedBy: userId,
          createdAt: now + index,
        });
      }
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    await recordFromRealReport(t, generationId);

    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion!.documentsTotal).toBe(101);
    expect(inclusion!.documentsTruncated).toBe(false);
    const documentRows = inclusion!.rows.filter((row) => row.kind === "document");
    expect(documentRows).toHaveLength(101);
    // The reservation froze 50; the other 51 are listed as not captured, the
    // last of them included — nothing past row 100 vanishes.
    expect(documentRows.filter((row) => row.reason === "not_captured")).toHaveLength(51);
    expect(documentRows.at(-1)).toMatchObject({
      label: "attachment-100.txt",
      inclusion: "not_included",
      reason: "not_captured",
    });
  });

  it("says so when the document read budget stops the listing short (DW-133)", async () => {
    const { t, authed, projectId, userId } = await setup();
    // Seventeen archived documents of 900,000 characters (15.3 MB): the
    // reservation skips them (no frozen copies) but still reads them under
    // the 16 MiB limit, while the query's 14 MiB budget cannot list them all.
    const now = Date.now() - 1_000;
    for (let index = 0; index < 17; index += 1) {
      await t.run((ctx) =>
        ctx.db.insert("projectDocuments", {
          projectId,
          fileName: `large-${index}.txt`,
          fileType: "txt",
          content: "x".repeat(900_000),
          source: "upload",
          uploadedBy: userId,
          archived: true,
          createdAt: now + index,
        })
      );
    }
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    await recordFromRealReport(t, generationId);

    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion!.sourcesTruncated).toBe(false);
    expect(inclusion!.documentsTruncated).toBe(true);
    expect(inclusion!.documentsTotal).toBeGreaterThan(0);
    expect(inclusion!.documentsTotal).toBeLessThan(17);
    // The rows that were read are still listed with their real reason.
    expect(inclusion!.rows.filter((row) => row.reason === "archived")).toHaveLength(
      inclusion!.documentsTotal
    );
  });

  it("four long transcripts and fifty large files: the whole transaction stays under the read limit and every file is listed (DW-133 review)", async () => {
    // Four 500,000-character transcripts plus fifty 200,000-character
    // documents froze ~12 MB of generationSources before the frozen total
    // held a project's own files (F5 stress run, 2026-10-27). A document
    // budget that ignored those bytes pushed the query past 16 MiB and it
    // threw before it could report anything.
    const { t, authed, projectId, userId } = await setup({ transcript: false });
    await t.run(async (ctx) => {
      const now = Date.now() - 1_000;
      for (let index = 0; index < 4; index += 1) {
        await ctx.db.insert("transcripts", { projectId, content: "a".repeat(500_000), createdAt: now + index });
      }
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("projectDocuments", {
          projectId,
          fileName: `doc-${index}.txt`,
          fileType: "txt",
          content: "d".repeat(200_000),
          source: "upload",
          uploadedBy: userId,
          createdAt: now + index,
        });
      }
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    // Record the outcome row by row in small transactions: recordContextBudget's
    // own get+patch loop over 12 MB of rows is a separate limit question the
    // pipeline owns, and this case is about the read query alone.
    const frozenIds = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
        .then((rows) => rows.map((row) => row._id))
    );
    // F5 stress run, 2026-10-27: the files stop at the frozen total, so the
    // four transcripts (2,000,000 bytes) leave room for 5 of the 50 files;
    // the other 45 are listed as not captured.
    expect(frozenIds).toHaveLength(4 + 5);
    for (const sourceId of frozenIds) {
      await t.run((ctx) => ctx.db.patch(sourceId, { inclusion: "included" }));
    }

    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion).not.toBeNull();
    expect(inclusion!.recorded).toBe(true);
    expect(inclusion!.sourcesTruncated).toBe(false);
    expect(inclusion!.rows.filter((row) => row.kind === "transcript")).toHaveLength(4);
    // Every frozen document is listed from its source row. B1, second part
    // (2026-10-27): the draft's rows now refer to their text instead of
    // holding ~12 MB of copies, so the walk over projectDocuments finishes
    // inside the budget and the total is exact.
    expect(inclusion!.documentsTotal).toBe(50);
    expect(inclusion!.documentsTruncated).toBe(false);
    expect(inclusion!.rows.filter((row) => row.reason === "not_captured")).toHaveLength(45);
  });

  it("an older draft's 12 MB of frozen rows holding their own text: the transaction stays under the read limit, and a stopped walk says so (DW-133 review)", async () => {
    // Drafts frozen before B1's second part (2026-10-27) carry each row's
    // text on the row, and before the frozen total held a project's own
    // files (F5 stress run, 2026-10-27) they could freeze about 12 MB:
    // four 500,000-character transcripts and fifty 200,000-character files.
    const { t, authed, projectId, userId } = await setup({ transcript: false });
    // One row per transaction: the rows together pass a transaction's writes.
    const now = Date.now() - 1_000;
    const generationId = await t.run((ctx) => ctx.db.insert("generations", { projectId, status: "completed", startedAt: now + 100 }));
    for (let index = 0; index < 4; index += 1) {
      await t.run(async (ctx) => {
        const content = "a".repeat(500_000);
        await ctx.db.insert("generationSources", {
          generationId, projectId, kind: "transcript", label: `Transcript ${index}`, content, contentHash: `t-${index}`,
          truncated: false, originalLength: content.length, capturedAt: now, inclusion: "included",
        });
      });
    }
    for (let index = 0; index < 50; index += 1) {
      await t.run(async (ctx) => {
        const projectDocumentId = await ctx.db.insert("projectDocuments", {
          projectId, fileName: `doc-${index}.txt`, fileType: "txt", content: "d".repeat(200_000), source: "upload",
          uploadedBy: userId, createdAt: now + index,
        });
        await ctx.db.insert("generationSources", {
          generationId, projectId, kind: "project_document", label: `other:doc-${index}.txt`, projectDocumentId,
          content: "d".repeat(200_000), contentHash: `d-${index}`, truncated: false, originalLength: 200_000, capturedAt: now,
          inclusion: "included",
        });
      });
    }
    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion).not.toBeNull();
    expect(inclusion!.sourcesTruncated).toBe(false);
    expect(inclusion!.rows.filter((row) => row.kind === "transcript")).toHaveLength(4);
    // Every frozen file is listed from its row; the walk over the project's
    // files, whose rows hold their text too, stops at the budget and says so.
    expect(inclusion!.rows.filter((row) => row.kind === "document" && row.reason === undefined)).toHaveLength(50);
    expect(inclusion!.documentsTruncated).toBe(true);
  });

  it("bounds the frozen sources themselves when they alone would exceed the budget, and says so (DW-133 review)", async () => {
    const { t, authed, projectId } = await setup();
    const generationId = await t.run((ctx) =>
      ctx.db.insert("generations", { projectId, status: "completed", startedAt: Date.now() })
    );
    // Twenty 900,000-character transcript rows: 18 MB, past the 16 MiB limit.
    for (let index = 0; index < 20; index += 1) {
      await t.run((ctx) =>
        ctx.db.insert("generationSources", {
          generationId,
          projectId,
          kind: "transcript",
          label: `Transcript ${index}`,
          content: "t".repeat(900_000),
          contentHash: `hash-${index}`,
          truncated: false,
          originalLength: 900_000,
          capturedAt: Date.now(),
          inclusion: "included",
        })
      );
    }
    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion).not.toBeNull();
    expect(inclusion!.recorded).toBe(true);
    expect(inclusion!.sourcesTruncated).toBe(true);
    // Without the full source set, unfrozen documents cannot be told apart
    // from frozen ones, so the document listing is reported as cut short too.
    expect(inclusion!.documentsTruncated).toBe(true);
    expect(inclusion!.rows.length).toBeGreaterThan(0);
    expect(inclusion!.rows.length).toBeLessThan(20);
  });

  it("charges the analyzer settings rows before walking sources, so large settings cannot push the query over the limit (DW-133 review 2)", async () => {
    const { t, authed, projectId, userId } = await setup();
    // Four ~1,000,000-byte settings whose whitespace-padded values still
    // parse as positive integers, plus thirteen ~1,000,000-byte frozen
    // sources: every document is valid on its own, and together they exceed
    // 16 MiB unless the settings are budgeted with everything else.
    const keys = [
      "ai.analyzerContextBudgetTokens",
      "ai.analyzerTranscriptBudgetTokens",
      "ai.analyzerDocumentBudgetTokens",
      "ai.analyzerMaxContextDocuments",
    ];
    for (const key of keys) {
      await t.run((ctx) =>
        ctx.db.insert("appSettings", {
          key,
          value: `${" ".repeat(999_990)}12${" ".repeat(8)}`,
          updatedBy: userId,
          updatedAt: Date.now(),
        })
      );
    }
    const generationId = await t.run((ctx) =>
      ctx.db.insert("generations", { projectId, status: "completed", startedAt: Date.now() })
    );
    for (let index = 0; index < 13; index += 1) {
      await t.run((ctx) =>
        ctx.db.insert("generationSources", {
          generationId,
          projectId,
          kind: "transcript",
          label: `Transcript ${index}`,
          content: "t".repeat(1_000_000),
          contentHash: `hash-${index}`,
          truncated: false,
          originalLength: 1_000_000,
          capturedAt: Date.now(),
          inclusion: "included",
        })
      );
    }
    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion).not.toBeNull();
    // The padded settings still parse: the cap is the admin's 12.
    expect(inclusion!.cap).toBe(12);
    expect(inclusion!.sourcesTruncated).toBe(true);
    expect(inclusion!.documentsTruncated).toBe(true);
    expect(inclusion!.rows.length).toBeGreaterThan(0);
    expect(inclusion!.rows.length).toBeLessThan(13);
  });

  it("returns null to an outsider", async () => {
    const { t, authed, projectId } = await setup();
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    expect(await t.query(api.generations.getContextInclusion, { generationId })).toBeNull();
    await t.run((ctx) => ctx.db.insert("users", { authId: "anonymous-visitor", isAnonymous: true }));
    const anonymous = t.withIdentity({ subject: "anonymous-visitor" });
    expect(await anonymous.query(api.generations.getContextInclusion, { generationId })).toBeNull();
  });

  it("lists archived and unreadable documents as not included, and a legacy row with no status", async () => {
    const { t, authed, projectId, userId } = await setup();
    await t.run(async (ctx) => {
      const now = Date.now() - 1_000;
      const base = { projectId, fileType: "txt" as const, source: "upload", uploadedBy: userId, createdAt: now };
      await ctx.db.insert("projectDocuments", { ...base, fileName: "kept.txt", content: "Readable text." });
      await ctx.db.insert("projectDocuments", { ...base, fileName: "old.txt", content: "Archived text.", archived: true });
      await ctx.db.insert("projectDocuments", { ...base, fileName: "scan.pdf", content: "   " });
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, { projectId });
    // Attached after the reservation: not part of this generation's inputs.
    await t.run((ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "later.txt",
        fileType: "txt",
        content: "Added later.",
        source: "upload",
        uploadedBy: userId,
        createdAt: Date.now() + 60_000,
      })
    );

    // Before any budget is recorded, every frozen row reads as no status and
    // the generation counts as legacy — the Brief is absent, not empty.
    const legacy = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(legacy!.recorded).toBe(false);
    expect(legacy!.rows.map((row) => [row.label, row.inclusion, row.reason ?? null])).toEqual([
      ["Interview transcript", null, null],
      ["kept.txt", null, null],
      ["old.txt", "not_included", "archived"],
      ["scan.pdf", "not_included", "unreadable"],
    ]);

    await recordFromRealReport(t, generationId);
    const recorded = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(recorded!.recorded).toBe(true);
    expect(recorded!.rows.map((row) => row.inclusion)).toEqual([
      "included",
      "included",
      "not_included",
      "not_included",
    ]);
    expect(recorded!.documentsInContext).toBe(1);
    expect(recorded!.documentsTotal).toBe(3);
  });
});
