/// <reference types="vite/client" />
// Story 4: the Brief rail's reads and its one writer, `briefs.saveEntryEdit`.
// Reuses convex/ai/brief.test.ts's fixture pattern: a reserved generation with
// its own frozen transcript row, run through `generateReport` with the
// Anthropic SDK mocked so story 1's stage derives a real Brief.
import type Anthropic from "@anthropic-ai/sdk";
import type { FunctionArgs } from "convex/server";
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

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!isUnknownArray(content)) return "";
  return content.map((block) => {
    if (
      block === null ||
      typeof block !== "object" ||
      !("type" in block) ||
      block.type !== "text" ||
      !("text" in block) ||
      typeof block.text !== "string"
    ) {
      return "";
    }
    return block.text;
  }).join("");
}

function requestText(
  params: GenerationMessageParams | Anthropic.MessageCreateParamsNonStreaming
): string {
  return params.messages.map((message) => {
    return contentText(message.content);
  }).join("\n");
}

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

async function insertQuestion(
  t: TestConvex,
  briefId: Id<"generationBriefs">,
  alternativeText = "The team discovered the loop's response under load was unknown."
) {
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
        alternativeText,
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
      runBriefVersionId: briefId,
      runBriefVersion: 1,
      latestBriefVersionId: briefId,
      appliesToNextGeneration: false,
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

    // A Seed run remains pinned to the Brief it started with. Newer edits are
    // explicit next-generation input while the active run is awaiting input.
    await t.run((ctx) => ctx.db.patch(generationId, {
      gatedWorkflow: "seeds",
      briefVersionId: briefId,
      status: "awaiting_input",
    }));

    const read = await asWriter.query(api.briefs.getBrief, { generationId });
    expect(read).toMatchObject({
      _id: editedId,
      generationBriefId: briefId,
      editedSinceGeneration: true,
      runBriefVersionId: briefId,
      runBriefVersion: 1,
      latestBriefVersionId: editedId,
      appliesToNextGeneration: true,
      regenerationDisabled: true,
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

  it("use_evidence refuses a stored alternative the Self-check clipped, and the other choices still work", async () => {
    // A question stored before clipped questions were withheld: its
    // alternative is a shortened fragment ending in the clip mark.
    const clipped = "The team discovered the loop's response under load was unknown, so the…";
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const questionId = await insertQuestion(t, briefId, clipped);
    const before = await briefCount(t, projectId);
    const entriesBefore = await entriesOf(t, briefId);
    expect(
      await errorCode(() =>
        asWriter.mutation(api.briefs.saveEntryEdit, {
          projectId,
          briefId,
          expectedBriefVersion: 1,
          entryId: questionId,
          resolvedBy: "use_evidence",
        })
      )
    ).toBe("INVALID_INPUT");
    expect(await briefCount(t, projectId)).toBe(before);
    expect(await entriesOf(t, briefId)).toEqual(entriesBefore);
    expect(await t.run((ctx) => ctx.db.get(briefId))).toMatchObject({
      storylineText: DERIVED_STORYLINE,
    });

    // The writer's own replacement text is theirs to choose.
    const ownId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionId,
      resolvedBy: "use_evidence",
      alternativeText: "The loop's response under load was unknown until the team measured it.",
    });
    expect(await t.run((ctx) => ctx.db.get(ownId))).toMatchObject({
      storylineText: "The loop's response under load was unknown until the team measured it.",
    });
  });

  it("use_evidence accepts a longer stored alternative that happens to end in an ellipsis", async () => {
    // Over the 96-byte clip limit, so the Self-check never clipped it: a
    // legacy question, or model text that ended with "…".
    const legacy =
      "The team discovered the loop's response under load was unknown, and measured it across three load bands…";
    expect(new TextEncoder().encode(legacy).length).toBeGreaterThan(96);
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const questionId = await insertQuestion(t, briefId, legacy);
    const resolvedId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionId,
      resolvedBy: "use_evidence",
    });
    expect(await t.run((ctx) => ctx.db.get(resolvedId))).toMatchObject({
      storylineText: legacy,
    });
  });

  it("keep_storyline still resolves a question whose stored alternative was clipped", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const questionId = await insertQuestion(t, briefId, "A shortened alternative…");
    const keptId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionId,
      resolvedBy: "keep_storyline",
    });
    expect(await t.run((ctx) => ctx.db.get(keptId))).toMatchObject({
      storylineText: DERIVED_STORYLINE,
    });
    const question = (await entriesOf(t, keptId)).find((entry) => entry.group === "storylineQuestion")!;
    expect(question.question?.resolvedBy).toBe("keep_storyline");
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

  it("atomically refuses a legacy edit when the combined Brief partitions exceed the legacy bound", async () => {
    const { t, asWriter, projectId, briefId } = await briefFixture();
    const questionId = await t.run(async (ctx) => {
      const evidence = (await ctx.db.query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
        .take(10)).find((row) => row.group === "confidenceMap");
      if (!evidence) throw new Error("Missing confidence evidence");
      for (let index = 0; index < 496; index += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId,
          projectId,
          group: "claimExclusion",
          text: `Legacy boundary guidance ${index + 1}.`,
          sourceId: evidence.sourceId,
          sourceContentHash: evidence.sourceContentHash,
          startOffset: evidence.startOffset,
          endOffset: evidence.endOffset,
          exactExcerpt: evidence.exactExcerpt,
          createdAt: 100 + index,
        });
      }
      return await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId,
        group: "storylineQuestion",
        text: "A generated question pushes the combined legacy view over its bound.",
        sourceId: evidence.sourceId,
        sourceContentHash: evidence.sourceContentHash,
        startOffset: evidence.startOffset,
        endOffset: evidence.endOffset,
        exactExcerpt: evidence.exactExcerpt,
        question: {
          questionText: "Should the legacy storyline change?",
          alternativeText: "Evidence says the legacy storyline should change.",
        },
        generatedOutput: true,
        createdAt: 1000,
      });
    });
    const before = await t.run(async (ctx) => ({
      briefs: await ctx.db.query("generationBriefs")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
      entries: await ctx.db.query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
        .take(502),
    }));
    expect(before.entries.filter((row) => row.generatedOutput === undefined)).toHaveLength(500);
    expect(before.entries.filter((row) => row.generatedOutput === true)).toHaveLength(1);
    expect(await errorCode(() => asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionId,
      resolvedBy: "use_evidence",
    }))).toBe("INVALID_STATE");
    const after = await t.run(async (ctx) => ({
      briefs: await ctx.db.query("generationBriefs")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
      entries: await ctx.db.query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
        .take(502),
    }));
    expect(after).toEqual(before);
  });

  it("reuses a partitioned Summary edit as complete legacy guidance without replacing the human resolution", async () => {
    const { t, asWriter, userId, projectId, generationId, briefId } = await briefFixture();
    const questionId = await t.run(async (ctx) => {
      await ctx.db.patch(generationId, { gatedWorkflow: "seeds" });
      const evidence = (await ctx.db.query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
        .take(10)).find((row) => row.group === "confidenceMap");
      if (!evidence) throw new Error("Missing confidence evidence");
      for (let index = 0; index < 496; index += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId,
          projectId,
          group: "claimExclusion",
          text: `Summary-only guidance ${index + 1}.`,
          sourceId: evidence.sourceId,
          sourceContentHash: evidence.sourceContentHash,
          startOffset: evidence.startOffset,
          endOffset: evidence.endOffset,
          exactExcerpt: evidence.exactExcerpt,
          createdAt: 100 + index,
        });
      }
      return await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId,
        group: "storylineQuestion",
        text: "Summary generated question.",
        sourceId: evidence.sourceId,
        sourceContentHash: evidence.sourceContentHash,
        startOffset: evidence.startOffset,
        endOffset: evidence.endOffset,
        exactExcerpt: evidence.exactExcerpt,
        question: {
          questionText: "Use the Summary evidence?",
          alternativeText: "Summary evidence changes the Storyline.",
        },
        generatedOutput: true,
        createdAt: 1000,
      });
    });
    const editedId = await asWriter.mutation(api.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionId,
      resolvedBy: "use_evidence",
    });
    const editedEntries = await entriesOf(t, editedId);
    expect(editedEntries.filter((row) => row.generatedOutput === true)).toHaveLength(1);
    const beforeReuse = await t.run(async (ctx) => ({
      briefs: await ctx.db.query("generationBriefs")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
      entries: await ctx.db.query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", editedId))
        .take(502),
    }));

    await t.run((ctx) => ctx.db.patch(projectId, {
      status: "review",
      activeGenerationId: undefined,
    }));
    const nextGenerationId = await makeGeneration(t, projectId, userId);
    network.create.mockClear();
    await t.action(internal.ai.pipeline.generateReport, { generationId: nextGenerationId });
    const next = await t.run((ctx) => ctx.db.get(nextGenerationId));
    expect(next?.briefId).toBe(editedId);
    expect(network.create.mock.calls.some(
      ([params]) => (params as GenerationMessageParams).tool_choice?.name === "submit_generation_brief"
    )).toBe(false);
    const afterReuse = await t.run(async (ctx) => ({
      briefs: await ctx.db.query("generationBriefs")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
      entries: await ctx.db.query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", editedId))
        .take(502),
    }));
    expect(afterReuse).toEqual(beforeReuse);
    const rendered = await t.query(internal.generations.renderBriefForGeneration, {
      generationId: nextGenerationId,
    });
    expect(rendered).toContain("Summary evidence changes the Storyline.");
    expect(rendered).toContain("Logo redesign is out of scope.");
    expect(rendered).toContain("Summary-only guidance 1.");
    expect(rendered).toContain("Summary-only guidance 496.");
    network.create.mockClear();
    const candidateJob = await t.run(async (ctx) => {
      const pending = (await ctx.db.system.query("_scheduled_functions").take(50)).find(
        (job) =>
          job.name === "ai/pipeline:generateCandidate" &&
          job.args[0]?.generationId === nextGenerationId &&
          job.state.kind === "pending"
      );
      if (pending) await ctx.scheduler.cancel(pending._id);
      return pending;
    });
    if (!candidateJob) throw new Error("Missing legacy candidate job");
    await t.action(
      internal.ai.pipeline.generateCandidate,
      candidateJob.args[0] as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>
    );
    const sectionJob = await t.run(async (ctx) => {
      const pending = (await ctx.db.system.query("_scheduled_functions").take(50)).find(
        (job) =>
          job.name === "ai/orderedGeneration:generateOrderedSection" &&
          job.args[0]?.generationId === nextGenerationId &&
          job.state.kind === "pending"
      );
      if (pending) await ctx.scheduler.cancel(pending._id);
      return pending;
    });
    if (!sectionJob) throw new Error("Missing legacy section job");
    await t.action(
      internal.ai.orderedGeneration.generateOrderedSection,
      sectionJob.args[0] as FunctionArgs<
        typeof internal.ai.orderedGeneration.generateOrderedSection
      >
    );
    const consumedRequests = network.create.mock.calls
      .map(([params]) => requestText(params));
    expect(consumedRequests.some((text) =>
      text.includes("Summary evidence changes the Storyline.") &&
      text.includes("Summary-only guidance 1.") &&
      text.includes("Summary-only guidance 496.")
    )).toBe(true);
    expect(editedEntries.find((row) => row.generatedOutput === true)).toMatchObject({
      sourceContentHash: "story-4-hash",
      question: {
        questionText: "Use the Summary evidence?",
        alternativeText: "Summary evidence changes the Storyline.",
        resolvedBy: "use_evidence",
      },
    });
  });
});
