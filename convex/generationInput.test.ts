/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import { mapClaimToPart } from "./lib/transcripts";
import { DEFAULT_CONTEXT_BUDGET } from "./ai/trustedContext";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;
const authId = "gen-input-writer";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

/** Typed domain-error code of a rejected call, or a marker for other outcomes. */
async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      return String((data as { code: unknown }).code);
    }
    return `UNTYPED: ${(error as Error).message}`;
  }
  return "NO_ERROR";
}

type Seed = { label?: string; position?: number; content: string };

async function setup(seeds: Seed[], documents: string[] = []) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Input project",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: "gen-input-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptIds: Id<"transcripts">[] = [];
    for (const [index, seed] of seeds.entries()) {
      transcriptIds.push(
        await ctx.db.insert("transcripts", {
          projectId,
          content: seed.content,
          createdAt: now + index,
          ...(seed.label === undefined ? {} : { label: seed.label }),
          ...(seed.position === undefined ? {} : { position: seed.position }),
        })
      );
    }
    for (const [index, content] of documents.entries()) {
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: `doc-${index}.txt`,
        fileType: "txt",
        content,
        source: "upload",
        uploadedBy: userId,
        createdAt: now,
      });
    }
    return { userId, projectId, transcriptIds };
  });
  return { t, authed: t.withIdentity({ subject: authId }), ...ids };
}

async function frozenSources(t: TestConvex, generationId: Id<"generations">) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
    ).filter((row) => row.kind === "transcript")
  );
}

/** (fileName, uploaderRole) of each contextDoc, with absence normalized. */
function contextDocRoles(
  input: { contextDocs: Array<{ fileName: string; uploaderRole?: string }> } | null
) {
  return (input?.contextDocs ?? []).map((d) => [d.fileName, d.uploaderRole ?? null]);
}

function generationInput(t: TestConvex, generationId: Id<"generations">) {
  return t.query(internal.generations.getGenerationInput, { generationId });
}

describe("reserveGeneration freezes the project's transcripts", () => {
  it("passes a single transcript through byte-for-byte (AC1)", async () => {
    const { t, authed, projectId, transcriptIds } = await setup([
      { content: "Only interview body" },
    ]);
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation).toMatchObject({
      transcriptId: transcriptIds[0],
      transcriptIds: [transcriptIds[0]],
      inputMode: "full",
    });
    const input = await generationInput(t, generationId);
    expect(input?.transcript).toBe("Only interview body");
    expect(input?.transcriptParts).toHaveLength(1);
    expect(input?.transcriptParts[0]).toMatchObject({
      content: "Only interview body",
      label: "Interview transcript",
    });
  });

  it("freezes one ordered row per transcript and joins them with headers (AC2)", async () => {
    const { t, authed, projectId, transcriptIds } = await setup([
      { label: "Third", position: 2, content: "Charlie body" },
      { label: "First", position: 0, content: "Alpha body" },
      { label: "Second", position: 1, content: "Bravo body" },
    ]);
    const [third, first, second] = transcriptIds;
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.transcriptIds).toEqual([first, second, third]);
    expect(generation?.transcriptId).toBe(first);

    const sources = await frozenSources(t, generationId);
    expect(sources.map((row) => row.transcriptId)).toEqual([first, second, third]);
    expect(sources.map((row) => row.label)).toEqual(["First", "Second", "Third"]);
    for (const row of sources) {
      expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.truncated).toBe(false);
      expect(row.originalLength).toBe(row.content.length);
    }
    expect(new Set(sources.map((row) => row.contentHash)).size).toBe(3);

    const input = await generationInput(t, generationId);
    expect(input?.transcript).toBe(
      "=== Transcript 1: First ===\nAlpha body\n\n" +
        "=== Transcript 2: Second ===\nBravo body\n\n" +
        "=== Transcript 3: Third ===\nCharlie body"
    );
    expect(input?.transcriptParts).toEqual(
      sources.map((row) => ({
        sourceId: row._id,
        contentHash: row.contentHash,
        content: row.content,
        label: row.label,
      }))
    );
  });

  it("truncates only the oversize row (edge case)", async () => {
    const long = "x".repeat(500_010);
    const { t, authed, projectId } = await setup([
      { label: "Short", position: 0, content: "short body" },
      { label: "Long", position: 1, content: long },
    ]);
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const sources = await frozenSources(t, generationId);
    expect(sources.map((row) => row.truncated)).toEqual([false, true]);
    expect(sources[1].content).toHaveLength(500_000);
    expect(sources[1].originalLength).toBe(500_010);
  });

  it("reserves a docs-only generation with no transcript at all (AC3)", async () => {
    const { t, authed, projectId } = await setup([], ["Context document body"]);
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.transcriptId).toBeUndefined();
    expect(generation?.transcriptIds).toEqual([]);
    const input = await generationInput(t, generationId);
    expect(input).not.toBeNull();
    expect(input?.transcript).toBe("");
    expect(input?.transcriptParts).toEqual([]);
    expect(input?.contextDocs).toHaveLength(1);
  });

  it("ignores an empty placeholder transcript row and reads the documents (AC3)", async () => {
    const { t, authed, projectId } = await setup(
      [{ content: "   " }],
      ["Context document body"]
    );
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.transcriptIds).toEqual([]);
    expect(await frozenSources(t, generationId)).toEqual([]);
  });

  it("rejects a project with neither a transcript nor a readable document (AC3)", async () => {
    const { authed, projectId } = await setup([]);
    expect(
      await errorCode(() =>
        authed.mutation(api.generations.requestGeneration, { projectId })
      )
    ).toBe("INVALID_INPUT");
  });
});

describe("requestGeneration reads the project's transcripts (AC5)", () => {
  it("reserves from the project alone", async () => {
    const { t, authed, projectId, transcriptIds } = await setup([
      { content: "Interview body" },
    ]);
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.transcriptIds).toEqual(transcriptIds);
  });
});

describe("retries re-freeze from the project's current transcripts (AC5)", () => {
  it("retryGeneration picks up a transcript added after the failure", async () => {
    const { t, authed, projectId, transcriptIds } = await setup([
      { label: "First", position: 0, content: "Alpha body" },
    ]);
    const failedId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("generations", {
        projectId,
        transcriptId: transcriptIds[0],
        status: "failed",
        requestedBy: (await ctx.db.query("users").first())!._id,
        candidateMode: "single",
        singleModelId: "claude-sonnet-5",
        previousProjectStatus: "draft",
        candidatesDone: 0,
        candidatesFailed: 1,
        startedAt: now,
      });
      // Added after the failure, and the original row is deleted: a retry that
      // still read failed.transcriptId could not survive either change.
      await ctx.db.insert("transcripts", {
        projectId,
        label: "Second",
        position: 1,
        content: "Bravo body",
        createdAt: now + 1,
      });
      await ctx.db.delete(transcriptIds[0]);
      return id;
    });
    const retryId = await authed.mutation(api.generations.retryGeneration, {
      generationId: failedId,
    });
    const sources = await frozenSources(t, retryId);
    expect(sources.map((row) => row.content)).toEqual(["Bravo body"]);
    const input = await generationInput(t, retryId);
    expect(input?.transcript).toBe("Bravo body");
  });

  it("retryFailedCandidates re-freezes the whole current set", async () => {
    const { t, authed, projectId, transcriptIds } = await setup([
      { label: "First", position: 0, content: "Alpha body" },
    ]);
    const partialId = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = (await ctx.db.query("users").first())!._id;
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId: transcriptIds[0],
        status: "awaiting_selection",
        requestedBy: userId,
        candidateMode: "compare",
        compareModelIds: ["claude-sonnet-5", "google/gemini-3.1-pro-preview"],
        previousProjectStatus: "draft",
        candidatesDone: 1,
        candidatesFailed: 1,
        startedAt: now,
      });
      await ctx.db.patch(projectId, {
        activeGenerationId: generationId,
        status: "generating",
      });
      const candidateId = await ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        content: "Ready candidate",
        agentOutputs: "{}",
        createdAt: now,
      });
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "succeeded",
        candidateId,
        queuedAt: now,
        completedAt: now,
      });
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "failed",
        queuedAt: now,
        completedAt: now,
      });
      await ctx.db.insert("transcripts", {
        projectId,
        label: "Second",
        position: 1,
        content: "Bravo body",
        createdAt: now + 1,
      });
      return generationId;
    });
    const retryId = await authed.mutation(api.generations.retryFailedCandidates, {
      generationId: partialId,
    });
    const sources = await frozenSources(t, retryId);
    expect(sources.map((row) => row.label)).toEqual(["First", "Second"]);
  });
});

describe("claims cite the part they came from (AC4)", () => {
  it("createProvenance accepts a citation built by mapClaimToPart against the second part", async () => {
    const { t, authed, projectId } = await setup([
      { label: "First", position: 0, content: "Alpha body about widgets" },
      { label: "Second", position: 1, content: "Bravo body about the novel cure step" },
    ]);
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const input = await generationInput(t, generationId);
    const quote = "the novel cure step";
    const citation = mapClaimToPart(input!.transcriptParts, { sourceQuote: quote });
    const sources = await frozenSources(t, generationId);
    expect(citation).toEqual({
      generationSourceId: sources[1]._id,
      sourceContentHash: sources[1].contentHash,
      exactExcerpt: quote,
      startOffset: sources[1].content.indexOf(quote),
      endOffset: sources[1].content.indexOf(quote) + quote.length,
    });

    const claimText = "The team ran the novel cure step under vacuum.";
    const provenanceId = await t.mutation(internal.reports.createProvenance, {
      projectId,
      generationId,
      content: JSON.stringify({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: claimText }] },
        ],
      }),
      claims: [
        {
          claimId: "c1",
          section: "242",
          material: true,
          claimText,
          claimTextHash: await sha256(claimText),
          state: "needs_review",
          sources: [citation!],
        },
      ],
    });
    const provenance = await t.run((ctx) => ctx.db.get(provenanceId));
    expect(provenance?.claims[0].sources[0].generationSourceId).toBe(sources[1]._id);
  });
});


/**
 * Story 2: the analyzer's context budget. `getGenerationInput` hands the
 * action the ids and the resolved budget; `recordContextBudget` writes the
 * outcome back onto the frozen rows without touching a capture-time fact.
 */
describe("the analyzer context budget travels with the frozen input", () => {
  async function settingsAdmin(t: TestConvex) {
    return await t.run((ctx) =>
      ctx.db.insert("users", { authId: "budget-admin", role: "admin" })
    );
  }

  it("returns a sourceId per context doc and the default budget", async () => {
    const { t, authed, projectId } = await setup(
      [{ content: "Interview body" }],
      ["Context document body"]
    );
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const input = await generationInput(t, generationId);
    expect(input?.contextBudget).toEqual(DEFAULT_CONTEXT_BUDGET);
    const rows = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("generationSources")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .collect()
      ).filter((row) => row.kind === "project_document")
    );
    expect(input?.contextDocs).toHaveLength(1);
    expect(input?.contextDocs[0]).toMatchObject({
      sourceId: rows[0]._id,
      fileName: "doc-0.txt",
      category: "other",
      content: "Context document body",
    });
  });

  it("freezes the uploader role onto the source row and surfaces it (CAP-3)", async () => {
    const { t, authed, projectId } = await setup([{ content: "Interview body" }]);
    // Two writer's-notes rows that differ only in whether an internal uploader
    // role was recorded. Trust must be pinned to the reservation, so the frozen
    // row has to carry the role forward; the legacy row must stay roleless and
    // reach the analyzer as client evidence.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "attributed.md",
        fileType: "txt",
        content: "Internal direction.",
        category: "writer_notes",
        source: "upload",
        uploadedBy: "writer@banhall.com",
        uploaderRole: "manager",
        createdAt: now,
      });
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "legacy.md",
        fileType: "txt",
        content: "Unattributed direction.",
        category: "writer_notes",
        source: "upload",
        uploadedBy: "writer@banhall.com",
        createdAt: now + 1,
      });
    });
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const rows = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("generationSources")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .collect()
      ).filter((row) => row.kind === "project_document")
    );
    expect(
      rows.map((row) => [row.label, row.uploaderRole ?? null])
    ).toEqual([
      ["writer_notes:attributed.md", "manager"],
      ["writer_notes:legacy.md", null],
    ]);
    expect(
      contextDocRoles(await generationInput(t, generationId))
    ).toEqual([
      ["attributed.md", "manager"],
      ["legacy.md", null],
    ]);
  });

  it("takes admin overrides per field and ignores unparseable ones", async () => {
    const { t, authed, projectId } = await setup([{ content: "Interview body" }]);
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const adminId = await settingsAdmin(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const [key, value] of [
        ["ai.analyzerContextBudgetTokens", "90000"],
        ["ai.analyzerTranscriptBudgetTokens", "abc"],
        ["ai.analyzerDocumentBudgetTokens", "-5"],
        ["ai.analyzerMaxContextDocuments", "3"],
      ] as const) {
        await ctx.db.insert("appSettings", {
          key,
          value,
          updatedBy: adminId,
          updatedAt: now,
        });
      }
    });
    const input = await generationInput(t, generationId);
    expect(input?.contextBudget).toEqual({
      totalTokens: 90_000,
      transcriptTokens: DEFAULT_CONTEXT_BUDGET.transcriptTokens,
      perDocumentTokens: DEFAULT_CONTEXT_BUDGET.perDocumentTokens,
      maxDocuments: 3,
    });
  });

  it("records the budget outcome without rewriting any capture-time fact", async () => {
    const { t, authed, projectId } = await setup(
      [{ label: "First", position: 0, content: "Alpha body" }],
      ["Context document body"]
    );
    const generationId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const before = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
    );
    const transcriptRow = before.find((row) => row.kind === "transcript")!;
    const documentRow = before.find((row) => row.kind === "project_document")!;

    await t.mutation(internal.generations.recordContextBudget, {
      generationId,
      budgetTokens: 150_000,
      applied: [
        {
          sourceId: transcriptRow._id,
          included: true,
          includedLength: 7,
          truncated: true,
        },
      ],
    });

    const after = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
    );
    const patched = after.find((row) => row._id === transcriptRow._id)!;
    const untouched = after.find((row) => row._id === documentRow._id)!;
    expect(patched.contextBudget).toEqual({
      budgetTokens: 150_000,
      included: true,
      includedLength: 7,
      truncated: true,
    });
    expect(patched.content).toBe(transcriptRow.content);
    expect(patched.contentHash).toBe(transcriptRow.contentHash);
    expect(patched.truncated).toBe(transcriptRow.truncated);
    expect(patched.originalLength).toBe(transcriptRow.originalLength);
    expect(untouched.contextBudget).toBeUndefined();
  });

  it("skips a source id that belongs to another generation", async () => {
    const { t, authed, projectId } = await setup([{ content: "Alpha body" }]);
    const firstId = await authed.mutation(api.generations.requestGeneration, {
      projectId,
    });
    const foreign = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("generationSources")
          .withIndex("by_generationId", (q) => q.eq("generationId", firstId))
          .collect()
      )[0]
    );
    const otherGenerationId = await t.run(async (ctx) =>
      ctx.db.insert("generations", {
        projectId,
        status: "running",
        requestedBy: (await ctx.db.query("users").first())!._id,
        candidateMode: "single",
        singleModelId: "claude-sonnet-5",
        candidatesDone: 0,
        candidatesFailed: 0,
        startedAt: Date.now(),
      })
    );
    await expect(
      t.mutation(internal.generations.recordContextBudget, {
        generationId: otherGenerationId,
        budgetTokens: 150_000,
        applied: [
          {
            sourceId: foreign._id,
            included: true,
            includedLength: 1,
            truncated: false,
          },
        ],
      })
    ).resolves.toBeNull();
    const row = await t.run((ctx) => ctx.db.get(foreign._id));
    expect(row?.contextBudget).toBeUndefined();
  });
});
