/// <reference types="vite/client" />
// Story 4: the Brief rail's reads and its one writer, `briefs.saveEntryEdit`.
// Reuses convex/ai/brief.test.ts's fixture pattern: a reserved generation with
// its own frozen transcript row, run through `generateReport` with the
// Anthropic SDK mocked so story 1's stage derives a real Brief.
import type Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { GenerationMessageParams } from "./ai/openrouterCore";

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: network.create };
  },
}));
const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

const TRANSCRIPT_TEXT =
  "The team built a custom control loop to stabilize output. Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured.";
const DERIVED_STORYLINE = "The team pursued a custom control loop to stabilize output.";

const analysisOutput = {
  company_context: "Test company",
  project_goal: "Resolve the control uncertainty",
  business_problem: "Existing control fails",
  scientific_technical_problem: "Response under load is unknown",
  technological_objective: "A repeatable control",
  work_performed: {},
  project_status: "completed",
};

const briefOutput = {
  storyline: DERIVED_STORYLINE,
  storylineClaims: [
    {
      text: "The team pursued a custom control loop.",
      quote: "The team built a custom control loop to stabilize output.",
    },
  ],
  claimExclusions: [
    {
      text: "Logo redesign is out of scope.",
      quote: "Marketing decided to redesign the logo",
      reason: "business_risk",
    },
  ],
  confidenceMap: [
    {
      text: "Response time under load is unresolved.",
      quote: "Response time under load was not measured.",
      confidence: "unresolved",
    },
  ],
  glossaryTerms: [{ term: "control loop" }],
};

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network disabled in test");
    })
  );
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name;
    const input =
      name === "submit_transcript_analysis"
        ? analysisOutput
        : name === "submit_generation_brief"
          ? briefOutput
          : { entries: [] };
    return {
      content: name
        ? [{ type: "tool_use", id: "tool-1", name, input }]
        : [{ type: "text", text: TRANSCRIPT_TEXT }],
      usage: { input_tokens: 10, output_tokens: 5 },
    } as unknown as Anthropic.Message;
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

async function makeGeneration(
  t: TestConvex,
  projectId: Id<"projects">,
  userId: Id<"users">
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: TRANSCRIPT_TEXT,
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "reserved",
      requestedAt: now,
      requestedBy: userId,
      startedAt: now,
      candidateMode: "single" as const,
      singleModelId: "claude-opus-4-8",
      previousProjectStatus: "draft",
      learningDigestIds: [],
    });
    await ctx.db.patch(projectId, { status: "generating", activeGenerationId: generationId });
    await ctx.db.insert("generationSources", {
      projectId,
      generationId,
      kind: "transcript",
      transcriptId,
      label: "Interview transcript",
      content: TRANSCRIPT_TEXT,
      contentHash: "story-4-hash",
      truncated: false,
      originalLength: TRANSCRIPT_TEXT.length,
      capturedAt: now,
    });
    return generationId;
  });
}

async function briefFixture() {
  const t = convexTest(schema, modules);
  const { userId, projectId } = await t.run(async (ctx) => {
    const now = Date.now();
    // admin: "all"-level report.editProse regardless of ownership.
    const userId = await ctx.db.insert("users", { authId: "brief-writer", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Control experiment",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: `briefs-token-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, projectId };
  });
  const generationId = await makeGeneration(t, projectId, userId);
  await t.action(internal.ai.pipeline.generateReport, { generationId });
  const generation = await t.run((ctx) => ctx.db.get(generationId));
  const briefId = generation!.briefId!;
  expect(briefId).toBeDefined();
  const asWriter = t.withIdentity({ subject: "brief-writer" });
  return { t, asWriter, userId, projectId, generationId, briefId };
}

async function entriesOf(t: TestConvex, briefId: Id<"generationBriefs">) {
  return await t.run((ctx) =>
    ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
      .collect()
  );
}

async function briefCount(t: TestConvex, projectId: Id<"projects">) {
  return (
    await t.run((ctx) =>
      ctx.db
        .query("generationBriefs")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    )
  ).length;
}

async function insertQuestion(t: TestConvex, briefId: Id<"generationBriefs">) {
  return await t.run(async (ctx) => {
    const brief = (await ctx.db.get(briefId))!;
    const evidence = (
      await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
        .collect()
    ).find((entry) => entry.group === "confidenceMap")!;
    return await ctx.db.insert("generationBriefEntries", {
      briefId,
      projectId: brief.projectId,
      group: "storylineQuestion",
      text: "Section 244 shows the loop failed under load.",
      sourceId: evidence.sourceId,
      sourceContentHash: evidence.sourceContentHash,
      startOffset: evidence.startOffset,
      endOffset: evidence.endOffset,
      exactExcerpt: evidence.exactExcerpt,
      question: {
        questionText: "Does the section's evidence override the Storyline?",
        alternativeText: "The team discovered the loop's response under load was unknown.",
      },
      createdAt: Date.now(),
    });
  });
}

describe("briefs reads (story 4)", () => {
  it("returns null to an outsider", async () => {
    const { t, generationId, briefId } = await briefFixture();
    expect(await t.query(api.briefs.getBrief, { generationId })).toBeNull();
    expect(await t.query(api.briefs.listBriefEntries, { briefId })).toBeNull();
  });

  it("answers a Brief that does not exist exactly as it answers an outsider", async () => {
    const { t, asWriter, projectId } = await briefFixture();
    const goneId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("generationBriefs", {
        projectId,
        generationId: (await ctx.db.query("generations").first())!._id,
        inputsHash: "gone",
        version: 1,
        origin: "derived",
        storylineText: "Deleted before the read.",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    // An insider cannot tell a fabricated id from a real one they may not see.
    expect(await asWriter.query(api.briefs.listBriefEntries, { briefId: goneId })).toBeNull();
    expect(await t.query(api.briefs.listBriefEntries, { briefId: goneId })).toBeNull();
  });

  it("returns the generation's own version, with sources joined and canEdit", async () => {
    const { asWriter, generationId, briefId } = await briefFixture();
    const read = await asWriter.query(api.briefs.getBrief, { generationId });
    expect(read).toMatchObject({
      _id: briefId,
      generationBriefId: briefId,
      editedSinceGeneration: false,
      canEdit: true,
      storylineOrigin: "derived",
      storylineText: DERIVED_STORYLINE,
    });
    for (const entry of read!.entries) {
      expect(entry.source).toEqual({ label: "Interview transcript", kind: "transcript" });
    }
  });

  it("canEdit is false for a user lacking report.editProse on the project", async () => {
    const { t, projectId, generationId, briefId } = await briefFixture();
    await t.run((ctx) => ctx.db.insert("users", { authId: "consultant", role: "writer" }));
    const consultant = t.withIdentity({ subject: "consultant" });
    const read = await consultant.query(api.briefs.getBrief, { generationId });
    expect(read?.canEdit).toBe(false);
    // The server still enforces requireReportEditAccess.
    expect(
      await errorCode(() =>
        consultant.mutation(api.briefs.saveEntryEdit, {
          projectId,
          briefId,
          expectedBriefVersion: 1,
          editedStorylineText: "A consultant's Storyline.",
        })
      )
    ).toBe("NOT_AUTHORIZED");
  });
});

describe("briefs.saveEntryEdit (story 4)", () => {
  it("edits the Storyline verbatim as a new version, and getBrief then shows that version", async () => {
    const { t, asWriter, projectId, generationId, briefId } = await briefFixture();
    const text = "  Writers proved a feedback controller holds output under varying load.\n";
    const editedId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      editedStorylineText: text,
    });
    expect(editedId).not.toBe(briefId);
    const edited = await t.run((ctx) => ctx.db.get(editedId));
    expect(edited).toMatchObject({
      version: 2,
      origin: "edited",
      storylineOrigin: "edited",
      storylineText: text,
    });
    expect(edited!.editMagnitude!.storylineEditDistance).toBeGreaterThan(0);
    expect(edited!.editMagnitude!.changedEntriesCount).toBe(0);
    // Rows are never mutated: version 1 still reads as derived.
    expect((await t.run((ctx) => ctx.db.get(briefId)))!.storylineText).toBe(DERIVED_STORYLINE);

    const read = await asWriter.query(api.briefs.getBrief, { generationId });
    expect(read).toMatchObject({
      _id: editedId,
      generationBriefId: briefId,
      editedSinceGeneration: true,
      storylineOrigin: "edited",
    });

    // A save against the now-stale version is fenced.
    expect(
      await errorCode(() =>
        asWriter.mutation(api.briefs.saveEntryEdit, {
          projectId,
          briefId,
          expectedBriefVersion: 1,
          editedStorylineText: "Another edit against the stale version.",
        })
      )
    ).toBe("BRIEF_STALE");
  });

  it("supplying a Storyline into an empty one records origin writer; empty text is rejected", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    // Test setup only: a Brief whose derivation produced no Storyline.
    await t.run((ctx) => ctx.db.patch(briefId, { storylineText: "" }));
    expect(
      await errorCode(() =>
        asWriter.mutation(api.briefs.saveEntryEdit, {
          projectId,
          briefId,
          expectedBriefVersion: 1,
          editedStorylineText: "   ",
        })
      )
    ).toBe("INVALID_INPUT");
    const suppliedId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      editedStorylineText: "The writer's own Storyline.",
    });
    expect(await t.run((ctx) => ctx.db.get(suppliedId))).toMatchObject({
      storylineOrigin: "writer",
      storylineText: "The writer's own Storyline.",
    });
  });

  it("editing a claim copies it with edited: true and leaves storylineText and the reason chip", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const entries = await entriesOf(t, briefId);
    const claim = entries.find((entry) => entry.group === "storyline")!;
    const claimEditId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: claim._id,
      editedText: "The team pursued a custom feedback controller.",
    });
    const claimEdit = await t.run((ctx) => ctx.db.get(claimEditId));
    expect(claimEdit).toMatchObject({ storylineText: DERIVED_STORYLINE, storylineOrigin: "derived" });
    expect(claimEdit!.editMagnitude).toEqual({ changedEntriesCount: 1, storylineEditDistance: 0 });
    const copied = await entriesOf(t, claimEditId);
    expect(copied).toHaveLength(entries.length);
    const editedClaim = copied.find((entry) => entry.group === "storyline")!;
    expect(editedClaim).toMatchObject({
      text: "The team pursued a custom feedback controller.",
      edited: true,
      sourceId: claim.sourceId,
      exactExcerpt: claim.exactExcerpt,
    });
    for (const other of copied.filter((entry) => entry.group !== "storyline")) {
      expect(other.edited).toBeUndefined();
    }

    const exclusion = copied.find((entry) => entry.group === "claimExclusion")!;
    const exclusionEditId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId: claimEditId,
      expectedBriefVersion: 2,
      entryId: exclusion._id,
      editedText: "The logo redesign is a marketing matter.",
    });
    const editedExclusion = (await entriesOf(t, exclusionEditId)).find(
      (entry) => entry.group === "claimExclusion"
    )!;
    expect(editedExclusion).toMatchObject({
      text: "The logo redesign is a marketing matter.",
      reason: "business_risk",
      edited: true,
    });
  });

  it("use_evidence sets storylineText to the question's alternative and resolves it", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const questionId = await insertQuestion(t, briefId);
    const resolvedId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionId,
      resolvedBy: "use_evidence",
    });
    const resolved = await t.run((ctx) => ctx.db.get(resolvedId));
    expect(resolved).toMatchObject({
      storylineText: "The team discovered the loop's response under load was unknown.",
      storylineOrigin: "edited",
    });
    const question = (await entriesOf(t, resolvedId)).find((entry) => entry.group === "storylineQuestion")!;
    expect(question.question?.resolvedBy).toBe("use_evidence");
  });

  it("use_evidence into an empty Storyline is edited, never the writer's own", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const questionId = await insertQuestion(t, briefId);
    // Test setup only: a Brief whose derivation produced no Storyline.
    await t.run((ctx) => ctx.db.patch(briefId, { storylineText: "" }));
    const resolvedId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionId,
      resolvedBy: "use_evidence",
    });
    expect(await t.run((ctx) => ctx.db.get(resolvedId))).toMatchObject({
      storylineText: "The team discovered the loop's response under load was unknown.",
      storylineOrigin: "edited",
    });
  });

  it("keep_storyline resolves the question and leaves the Storyline", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const questionId = await insertQuestion(t, briefId);
    const keptId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionId,
      resolvedBy: "keep_storyline",
    });
    expect(keptId).not.toBe(briefId);
    const kept = await t.run((ctx) => ctx.db.get(keptId));
    expect(kept).toMatchObject({ storylineText: DERIVED_STORYLINE, storylineOrigin: "derived" });
    const question = (await entriesOf(t, keptId)).find((entry) => entry.group === "storylineQuestion")!;
    expect(question.question?.resolvedBy).toBe("keep_storyline");
  });

  it("an unchanged save inserts nothing and returns the current briefId", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const before = await briefCount(t, projectId);
    const claim = (await entriesOf(t, briefId)).find((entry) => entry.group === "storyline")!;
    expect(
      await asWriter.mutation(api.briefs.saveEntryEdit, {
        projectId,
        briefId,
        expectedBriefVersion: 1,
        entryId: claim._id,
        editedText: claim.text,
      })
    ).toBe(briefId);
    expect(
      await asWriter.mutation(api.briefs.saveEntryEdit, {
        projectId,
        briefId,
        expectedBriefVersion: 1,
        editedStorylineText: DERIVED_STORYLINE,
      })
    ).toBe(briefId);
    expect(await briefCount(t, projectId)).toBe(before);
  });

  it("rejects empty entry text", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const claim = (await entriesOf(t, briefId)).find((entry) => entry.group === "glossaryTerm")!;
    expect(
      await errorCode(() =>
        asWriter.mutation(api.briefs.saveEntryEdit, {
          projectId,
          briefId,
          expectedBriefVersion: 1,
          entryId: claim._id,
          editedText: "",
        })
      )
    ).toBe("INVALID_INPUT");
  });

  it("the next generation with the same inputsHash reuses the edited version, rendered verbatim", async () => {
    const { t, asWriter, userId, projectId, briefId } = await briefFixture();
    const text = "Writers proved a feedback controller holds output under varying load.";
    const editedId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      editedStorylineText: text,
    });

    await t.run((ctx) => ctx.db.patch(projectId, { status: "review", activeGenerationId: undefined }));
    const nextGenerationId = await makeGeneration(t, projectId, userId);
    await t.action(internal.ai.pipeline.generateReport, { generationId: nextGenerationId });
    const next = await t.run((ctx) => ctx.db.get(nextGenerationId));
    expect(next?.briefId).toBe(editedId);
    const rendered = await t.query(internal.generations.renderBriefForGeneration, {
      generationId: nextGenerationId,
    });
    expect(rendered).toContain(text);
    expect(rendered).not.toContain(DERIVED_STORYLINE);

    // The rail for the new generation shows the same version, not "edited since".
    const read = await asWriter.query(api.briefs.getBrief, { generationId: nextGenerationId });
    expect(read).toMatchObject({ _id: editedId, editedSinceGeneration: false });
  });
});
