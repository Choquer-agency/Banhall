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

async function setup() {
  const t = convexTest(schema, modules);
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
    await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview body about the control loop.",
      createdAt: now,
    });
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
