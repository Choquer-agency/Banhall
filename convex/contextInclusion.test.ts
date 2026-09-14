/// <reference types="vite/client" />
// Story 4 (CAP-11, AD-30): per-document inclusion is recorded once per frozen
// `generationSources` row by `recordContextBudget` and read through the one
// query, `generations.getContextInclusion`.
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { buildTrustedContext, type ContextDoc } from "./ai/trustedContext";

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
  return report;
}

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

    const frozen = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
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

    const recorded = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
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
    const frozen = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
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

  it("12 MB of frozen sources: the whole transaction stays under the read limit and the document walk says it stopped (DW-133 review)", async () => {
    // Four 500,000-character transcripts plus fifty 200,000-character
    // documents freeze ~12 MB of generationSources. A document budget that
    // ignored those bytes pushed the query past 16 MiB and it threw before
    // it could report anything.
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
    expect(frozenIds).toHaveLength(54);
    for (const sourceId of frozenIds) {
      await t.run((ctx) => ctx.db.patch(sourceId, { inclusion: "included" }));
    }

    const inclusion = await authed.query(api.generations.getContextInclusion, { generationId });
    expect(inclusion).not.toBeNull();
    expect(inclusion!.recorded).toBe(true);
    expect(inclusion!.sourcesTruncated).toBe(false);
    expect(inclusion!.rows.filter((row) => row.kind === "transcript")).toHaveLength(4);
    // Every frozen document is listed from its source row; the walk over
    // projectDocuments could not finish inside the budget, so the total is a
    // lower bound and says so.
    expect(inclusion!.documentsTotal).toBeGreaterThanOrEqual(50);
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
