/// <reference types="vite/client" />

// Story 1 (CAP-1/2/4): Generation Brief storage and derivation stage.
//
// The stage (`deriveOrReuseBrief`, convex/ai/brief.ts) is a plain "use node"
// helper — not a registered Convex function — called directly from
// `pipeline.ts`'s `generateReport`, exactly once per generation, right after
// the shared analyzer call. So it's exercised here the same way
// `pipeline.compare.test.ts` exercises the shared analyzer: through
// `internal.ai.pipeline.generateReport` with the Anthropic SDK mocked.
//
// Its writes go through `internal.generations.persistDerivedBrief` /
// `stampGenerationBriefId` (not `internal.ai.brief.*`) — see the comment
// above those functions in `convex/generations.ts` for why: this worktree's
// `convex/_generated/api.d.ts` cannot be regenerated (no live deployment),
// and referencing a brand-new file through `internal.*` would break
// `tsc -p convex/tsconfig.json --noEmit` today. `generations.ts` and
// `reports.ts` are already-generated modules, so new exports on them
// typecheck without a codegen refresh. Confirmed by grep: `generationBriefs`
// and `generationBriefEntries` are inserted in exactly two files —
// `convex/generations.ts` (this stage's `persistDerivedBrief`) and
// `convex/briefs.ts` (`saveEntryEdit`) — the "exactly two writers" rule
// (AD-23) at the stage level, even though the write itself lives in a
// different file than the orchestration for the reason above.

import type Anthropic from "@anthropic-ai/sdk";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
// `convex/briefs.ts` is a brand-new file `_generated/api.d.ts` cannot know
// about without a live-deployment codegen refresh (unavailable in this
// worktree — see the comment atop this file). `anyApi` is Convex's own
// escape hatch for exactly this: at runtime `api`/`internal` from
// `_generated/api.js` already ARE `anyApi` (see that file), so this reaches
// the real, currently-uncodegen'd `briefs.ts` functions with no loss of
// fidelity — only the static type gets looser for these calls.
import { anyApi, getFunctionName, type FunctionReference } from "convex/server";
import { convexToJson, type Value } from "convex/values";
import type { Id } from "../_generated/dataModel";
// DW-107: the one definition of each Brief read bound lives in
// `convex/generations.ts`, so the overflow tests below cannot drift from it.
import {
  BRIEF_BASELINE_PAGE_BYTES,
  BRIEF_CONSUMER_READ_BYTES,
  MAX_BRIEF_ENTRY_ROWS,
  MAX_BRIEF_SOURCE_ROWS,
} from "../generations";
import schema from "../schema";
import {
  BRIEF_PUBLISH_ATTEMPTS,
  publishDerivedBrief,
  type BriefPublishCtx,
} from "./brief";
import type { GenerationMessageParams } from "./openrouterCore";
import { describeBriefOutcome } from "../lib/briefRender";

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: network.create };
  },
}));
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ])
);

const analysisOutput = {
  company_context: "Test company",
  project_goal: "Resolve the control uncertainty",
  business_problem: "Existing control fails",
  scientific_technical_problem: "Response under load is unknown",
  technological_objective: "A repeatable control",
  work_performed: {},
  project_status: "completed",
};

const TRANSCRIPT_TEXT =
  "The team built a custom control loop to stabilize output. The algorithms were evaluated under load. Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured.";

const briefOutput = (opts: { includeBadQuote?: boolean } = {}) => ({
  storyline: "The team pursued a custom control loop to stabilize output.",
  storylineClaims: [
    {
      text: "The team pursued a custom control loop.",
      quote: "The team built a custom control loop to stabilize output.",
    },
    ...(opts.includeBadQuote
      ? [{ text: "A claim with no real citation.", quote: "this exact text never appears anywhere" }]
      : []),
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
  glossaryTerms: [
    { term: "algorithm", inflections: ["algorithms"] },
    { term: "control loop" },
  ],
});

function mockNetwork(opts: { includeBadQuote?: boolean } = {}) {
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name;
    const input =
      name === "submit_transcript_analysis"
        ? analysisOutput
        : name === "submit_generation_brief"
          ? briefOutput(opts)
          : { entries: [] };
    return {
      content: name
        ? [{ type: "tool_use", id: "tool-1", name, input }]
        : [{ type: "text", text: TRANSCRIPT_TEXT }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  });
}

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
  mockNetwork();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function briefCalls() {
  return network.create.mock.calls.filter(
    ([params]) => params.tool_choice?.name === "submit_generation_brief"
  );
}

async function makeProject(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    // admin: guarantees "all"-level report.editProse regardless of project
    // ownership, so saveEntryEdit tests don't also have to set up ownership.
    const userId = await ctx.db.insert("users", { authId: "brief-writer", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Control experiment",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: `brief-token-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, projectId };
  });
}

/** Mirrors `pipeline.compare.test.ts`'s fixture: a reserved generation with
 * its own frozen `generationSources` row, independent of `requestGeneration`
 * so the exact frozen content/hash is controlled per test. */
async function makeGeneration(
  t: ReturnType<typeof convexTest>,
  projectId: Id<"projects">,
  userId: Id<"users">,
  content: string,
  contentHash: string
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content, createdAt: now });
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
      content,
      contentHash,
      truncated: false,
      originalLength: content.length,
      capturedAt: now,
    });
    return generationId;
  });
}

describe("Generation Brief derivation (story 1, CAP-1/2/4)", () => {
  it("derives Storyline, Claim Exclusions, Confidence Map and Glossary Terms, each citing a frozen source", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "hash-1");

    await t.action(internal.ai.pipeline.generateReport, { generationId });

    expect(briefCalls()).toHaveLength(1);
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.briefId).toBeDefined();

    const brief = await t.run((ctx) => ctx.db.get(generation!.briefId!));
    expect(brief).toMatchObject({
      projectId,
      generationId,
      origin: "derived",
      version: 1,
      storylineText: briefOutput().storyline,
    });

    const entries = await t.run((ctx) =>
      ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", brief!._id))
        .collect()
    );
    const byGroup = (group: string) => entries.filter((e) => e.group === group);
    expect(byGroup("storyline")).toHaveLength(1);
    expect(byGroup("claimExclusion")).toHaveLength(1);
    expect(byGroup("claimExclusion")[0]).toMatchObject({ reason: "business_risk" });
    expect(byGroup("confidenceMap")).toHaveLength(1);
    expect(byGroup("confidenceMap")[0]).toMatchObject({ confidence: "unresolved" });
    expect(byGroup("glossaryTerm")).toHaveLength(2);
    const glossaryEntry = byGroup("glossaryTerm").find(
      (entry) => entry.exactExcerpt === "algorithms"
    )!;
    expect(glossaryEntry.text).toBe("algorithm");
    expect(glossaryEntry.exactExcerpt).toBe("algorithms");
    expect(glossaryEntry.startOffset).toBe(TRANSCRIPT_TEXT.indexOf("algorithms"));
    expect(glossaryEntry.endOffset).toBe(
      TRANSCRIPT_TEXT.indexOf("algorithms") + "algorithms".length
    );
    const glossarySource = await t.run((ctx) => ctx.db.get(glossaryEntry.sourceId));
    expect(
      glossarySource!.content.slice(glossaryEntry.startOffset, glossaryEntry.endOffset)
    ).toBe("algorithms");
    const exactGlossaryEntry = byGroup("glossaryTerm").find(
      (entry) => entry.exactExcerpt === "control loop"
    )!;
    expect(exactGlossaryEntry.text).toBe("control loop");
    const exactGlossarySource = await t.run((ctx) => ctx.db.get(exactGlossaryEntry.sourceId));
    expect(
      exactGlossarySource!.content.slice(
        exactGlossaryEntry.startOffset,
        exactGlossaryEntry.endOffset
      )
    ).toBe("control loop");

    // Every entry cites its source byte-for-byte.
    for (const entry of entries) {
      const source = await t.run((ctx) => ctx.db.get(entry.sourceId));
      expect(source).toBeDefined();
      expect(source!.contentHash).toBe(entry.sourceContentHash);
      expect(source!.content.slice(entry.startOffset, entry.endOffset)).toBe(entry.exactExcerpt);
    }
  });

  it("classifies a flagged glossary candidate via the same call's own quote — no second model call", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    // "control loop" never appears verbatim (or as an obvious inflection)
    // anywhere in this text — matchGlossaryTerms finds zero occurrences, so
    // the rule-based matcher flags it — but the evidence does express the
    // same concept as "closed feedback mechanism".
    const text =
      "The team relied on a closed feedback mechanism to hold output steady. Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured.";
    network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
      const name = params.tool_choice?.name;
      const input =
        name === "submit_transcript_analysis"
          ? analysisOutput
          : name === "submit_generation_brief"
            ? {
                storyline: "The team pursued a control loop to hold output steady.",
                storylineClaims: [
                  { text: "Control loop pursued.", quote: "The team relied on a closed feedback mechanism to hold output steady." },
                ],
                claimExclusions: [
                  { text: "Logo redesign is out of scope.", quote: "Marketing decided to redesign the logo", reason: "business_risk" },
                ],
                confidenceMap: [
                  { text: "Response time under load is unresolved.", quote: "Response time under load was not measured.", confidence: "unresolved" },
                ],
                glossaryTerms: [
                  // Flagged (no rule-based match) + classified via quote.
                  { term: "control loop", quote: "closed feedback mechanism" },
                  // Flagged, and the model's own classification quote is
                  // fabricated (not present verbatim) — dropped and counted,
                  // same as any other citation that fails byte-match.
                  { term: "hysteresis compensation", quote: "this exact phrase never appears anywhere" },
                ],
              }
            : { entries: [] };
      return {
        content: name ? [{ type: "tool_use", id: "tool-1", name, input }] : [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });

    const generationId = await makeGeneration(t, projectId, userId, text, "classify-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId });

    // Classification rode the same structured call — no second model call.
    expect(briefCalls()).toHaveLength(1);

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    const brief = await t.run((ctx) => ctx.db.get(generation!.briefId!));
    expect(brief?.droppedEntryCount).toBe(1); // the fabricated-quote candidate

    const entries = await t.run((ctx) =>
      ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", brief!._id))
        .collect()
    );
    const glossaryEntries = entries.filter((e) => e.group === "glossaryTerm");
    expect(glossaryEntries).toHaveLength(1);
    const [classified] = glossaryEntries;
    // The entry names the canonical term, not the raw synonym quote.
    expect(classified.text).toBe("control loop");
    expect(classified.exactExcerpt).toBe("closed feedback mechanism");
    const source = await t.run((ctx) => ctx.db.get(classified.sourceId));
    expect(source!.content.slice(classified.startOffset, classified.endOffset)).toBe(
      "closed feedback mechanism"
    );
    expect(entries.some((e) => e.text === "hysteresis compensation")).toBe(false);
  });

  it("dedupes two flagged glossary candidates that share a canonical term (case-insensitive)", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    // "control loop" never appears verbatim (or as an obvious inflection)
    // anywhere in this text, so the rule-based matcher flags it — same setup
    // as the classification test above, but the model echoes the same
    // canonical term twice (case-varied), as it can when a concept comes up
    // more than once in its own reasoning.
    const text =
      "The team relied on a closed feedback mechanism to hold output steady. Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured.";
    network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
      const name = params.tool_choice?.name;
      const input =
        name === "submit_transcript_analysis"
          ? analysisOutput
          : name === "submit_generation_brief"
            ? {
                storyline: "The team pursued a control loop to hold output steady.",
                storylineClaims: [
                  { text: "Control loop pursued.", quote: "The team relied on a closed feedback mechanism to hold output steady." },
                ],
                claimExclusions: [
                  { text: "Logo redesign is out of scope.", quote: "Marketing decided to redesign the logo", reason: "business_risk" },
                ],
                confidenceMap: [
                  { text: "Response time under load is unresolved.", quote: "Response time under load was not measured.", confidence: "unresolved" },
                ],
                glossaryTerms: [
                  { term: "control loop", quote: "closed feedback mechanism" },
                  // Same canonical term, different casing — must not become a
                  // second entry.
                  { term: "Control Loop", quote: "closed feedback mechanism" },
                ],
              }
            : { entries: [] };
      return {
        content: name ? [{ type: "tool_use", id: "tool-1", name, input }] : [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });

    const generationId = await makeGeneration(t, projectId, userId, text, "dedup-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId });

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    const brief = await t.run((ctx) => ctx.db.get(generation!.briefId!));
    const entries = await t.run((ctx) =>
      ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", brief!._id))
        .collect()
    );
    const glossaryEntries = entries.filter((e) => e.group === "glossaryTerm");
    expect(glossaryEntries).toHaveLength(1);
  });

  it("drops an entry whose citation fails byte-match and counts the drop on the Brief", async () => {
    mockNetwork({ includeBadQuote: true });
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "hash-2");

    await t.action(internal.ai.pipeline.generateReport, { generationId });

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    const brief = await t.run((ctx) => ctx.db.get(generation!.briefId!));
    expect(brief?.droppedEntryCount).toBe(1);

    const storylineEntries = await t.run((ctx) =>
      ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", brief!._id))
        .collect()
    ).then((rows) => rows.filter((r) => r.group === "storyline"));
    // Only the citable storyline claim survives — the fabricated quote never did.
    expect(storylineEntries).toHaveLength(1);
    expect(storylineEntries.some((e) => e.text === "A claim with no real citation.")).toBe(false);
  });

  it("reuses the stored Brief for identical inputs — no second derivation call", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const firstGenerationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "shared-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId: firstGenerationId });
    expect(briefCalls()).toHaveLength(1);
    const firstBriefId = (await t.run((ctx) => ctx.db.get(firstGenerationId)))?.briefId;
    expect(firstBriefId).toBeDefined();

    // A second, independent generation under the same project with byte-
    // identical frozen content (same hash) reuses the Brief with no new call.
    await t.run((ctx) => ctx.db.patch(projectId, { status: "review", activeGenerationId: undefined }));
    const secondGenerationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "shared-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId: secondGenerationId });

    expect(briefCalls()).toHaveLength(1); // still just the one derivation call
    const secondBriefId = (await t.run((ctx) => ctx.db.get(secondGenerationId)))?.briefId;
    expect(secondBriefId).toBe(firstBriefId);
  });

  it("re-derives on changed inputs and stamps change: added | unchanged | removed", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    // The transcript stays byte-identical across v1 and v2 (same content,
    // same contentHash) — only its entries can key-match as "unchanged".
    const sharedTranscript =
      "Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured. The legacy control loop and its algorithms remained active throughout.";
    const firstGenerationId = await makeGeneration(t, projectId, userId, sharedTranscript, "shared-transcript-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId: firstGenerationId });
    expect(briefCalls()).toHaveLength(1);

    // v2 adds a second frozen source (a document) — inputsHash changes even
    // though the transcript itself didn't, forcing a re-derivation — and the
    // model drops the Glossary term and proposes a Storyline claim quoting
    // only the new document.
    const newDocument = "A new feedback controller replaced the legacy design in March.";
    network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
      const name = params.tool_choice?.name;
      const input =
        name === "submit_transcript_analysis"
          ? analysisOutput
          : name === "submit_generation_brief"
            ? {
                storyline: "A new feedback controller replaced the legacy design.",
                storylineClaims: [
                  { text: "New controller replaced the legacy design.", quote: newDocument },
                ],
                claimExclusions: [
                  { text: "Logo redesign is out of scope.", quote: "Marketing decided to redesign the logo", reason: "business_risk" },
                ],
                confidenceMap: [
                  { text: "Response time under load is unresolved.", quote: "Response time under load was not measured.", confidence: "unresolved" },
                ],
                glossaryTerms: [],
              }
            : { entries: [] };
      return {
        content: name ? [{ type: "tool_use", id: "tool-1", name, input }] : [{ type: "text", text: sharedTranscript }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });

    const secondGenerationId = await t.run(async (ctx) => {
      const now = Date.now();
      const transcriptId = await ctx.db.insert("transcripts", { projectId, content: sharedTranscript, createdAt: now });
      const generationId = await ctx.db.insert("generations", {
        projectId, transcriptId, transcriptIds: [transcriptId], status: "reserved",
        requestedAt: now, requestedBy: userId, startedAt: now,
        candidateMode: "single" as const, singleModelId: "claude-opus-4-8",
        previousProjectStatus: "draft", learningDigestIds: [],
      });
      await ctx.db.patch(projectId, { status: "generating", activeGenerationId: generationId });
      await ctx.db.insert("generationSources", {
        projectId, generationId, kind: "transcript", transcriptId,
        label: "Interview transcript", content: sharedTranscript, contentHash: "shared-transcript-hash",
        truncated: false, originalLength: sharedTranscript.length, capturedAt: now,
      });
      await ctx.db.insert("generationSources", {
        projectId, generationId, kind: "project_document",
        label: "background:new-note.txt", content: newDocument, contentHash: "new-document-hash",
        truncated: false, originalLength: newDocument.length, capturedAt: now,
      });
      return generationId;
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId: secondGenerationId });
    // network.create was reset (new mockImplementation above) when the v2
    // mock was installed, so this counts only v2's own derivation call.
    expect(briefCalls()).toHaveLength(1);

    const secondBriefId = (await t.run((ctx) => ctx.db.get(secondGenerationId)))?.briefId!;
    const entries = await t.run((ctx) =>
      ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", secondBriefId))
        .collect()
    );
    const claimExclusion = entries.find((e) => e.group === "claimExclusion");
    expect(claimExclusion?.change).toBe("unchanged");
    const confidenceMap = entries.find((e) => e.group === "confidenceMap");
    expect(confidenceMap?.change).toBe("unchanged");
    const storyline = entries.find((e) => e.group === "storyline");
    expect(storyline?.change).toBe("added");
    // The glossary term from v1 ("algorithm") isn't in v2's model output —
    // it shows up as a removed marker on the new version.
    const removed = entries.filter((e) => e.change === "removed");
    expect(removed).toContainEqual(
      expect.objectContaining({
        group: "glossaryTerm",
        text: "algorithm",
        exactExcerpt: "algorithms",
      })
    );
  });

  it("renderBriefForGeneration omits a re-derivation's change: removed entries from the section prompt", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "removed-hash");
    // A re-derived Brief (version 2) directly in storage: one live and one
    // change: "removed" row in every group the renderer emits.
    await t.run(async (ctx) => {
      const now = Date.now();
      const source = (
        await ctx.db
          .query("generationSources")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .collect()
      )[0];
      const briefId = await ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "removed-inputs-hash",
        version: 2,
        origin: "derived",
        storylineText: "The team pursued a custom control loop to stabilize output.",
        createdAt: now,
      });
      await ctx.db.patch(generationId, { briefId });
      const citation = {
        briefId,
        projectId,
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        startOffset: 0,
        endOffset: 8,
        exactExcerpt: source.content.slice(0, 8),
        createdAt: now,
      };
      // The block renders storylineText, not storyline claim rows, so the
      // three rendered groups carry the assertions.
      const rows = [
        { group: "claimExclusion", text: "LIVE exclusion", reason: "business_risk", change: "added" },
        { group: "claimExclusion", text: "REMOVED exclusion", reason: "business_risk", change: "removed" },
        { group: "confidenceMap", text: "LIVE confidence fact", confidence: "unresolved", change: "unchanged" },
        { group: "confidenceMap", text: "REMOVED confidence fact", confidence: "unresolved", change: "removed" },
        { group: "glossaryTerm", text: "LIVE term", change: "unchanged" },
        { group: "glossaryTerm", text: "REMOVED term", change: "removed" },
      ] as const;
      for (const row of rows) {
        await ctx.db.insert("generationBriefEntries", { ...citation, ...row });
      }
    });

    const rendered = (await t.query(internal.generations.renderBriefForGeneration, {
      generationId,
    })) as string;
    expect(rendered).toContain("LIVE exclusion");
    expect(rendered).toContain("LIVE confidence fact");
    expect(rendered).toContain("LIVE term");
    // Removed markers are history for the diff UI, not guidance in force.
    expect(rendered).not.toContain("REMOVED");
  });

  it("stores a writer-supplied Storyline verbatim with origin=writer; other groups still derive", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await t.run(async (ctx) => {
      const now = Date.now();
      const transcriptId = await ctx.db.insert("transcripts", { projectId, content: TRANSCRIPT_TEXT, createdAt: now });
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
        projectId, generationId, kind: "transcript", transcriptId,
        label: "Interview transcript", content: TRANSCRIPT_TEXT, contentHash: "writer-hash",
        truncated: false, originalLength: TRANSCRIPT_TEXT.length, capturedAt: now,
      });
      const storyline = "Writer's own account of the project, verbatim.";
      await ctx.db.insert("generationSources", {
        projectId, generationId, kind: "writer_storyline",
        label: "Writer-supplied Storyline", content: storyline, contentHash: "storyline-hash",
        truncated: false, originalLength: storyline.length, capturedAt: now,
      });
      return generationId;
    });

    await t.action(internal.ai.pipeline.generateReport, { generationId });

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    const brief = await t.run((ctx) => ctx.db.get(generation!.briefId!));
    expect(brief).toMatchObject({
      origin: "writer",
      storylineText: "Writer's own account of the project, verbatim.",
    });
    const entries = await t.run((ctx) =>
      ctx.db.query("generationBriefEntries").withIndex("by_briefId", (q) => q.eq("briefId", brief!._id)).collect()
    );
    // No cited Storyline entries — a writer Storyline is never validated or parsed.
    expect(entries.some((e) => e.group === "storyline")).toBe(false);
    // Other groups are still derived from the (non-writer) evidence.
    expect(entries.some((e) => e.group === "claimExclusion")).toBe(true);
  });

  it("persistDerivedBrief drops a candidate entry whose source belongs to a different project/generation", async () => {
    // Direct unit test of convex/generations.ts:persistDerivedBrief's
    // tenant-scoping check (parity with reports.createProvenance). Not
    // reachable through deriveOrReuseBrief's normal flow — its own
    // evidenceSources are already scoped to this generationId by
    // getGenerationSourcesForBrief — so this exercises the mutation's own
    // defense-in-depth check directly, the way reports.test.ts tests
    // createProvenance's ownership check.
    const t = convexTest(schema, modules);
    const { userId: ownUserId, projectId: ownProjectId } = await makeProject(t);
    const ownGenerationId = await makeGeneration(t, ownProjectId, ownUserId, TRANSCRIPT_TEXT, "own-hash");

    const { userId: otherUserId, projectId: otherProjectId } = await makeProject(t);
    const otherGenerationId = await makeGeneration(
      t,
      otherProjectId,
      otherUserId,
      "Unrelated content belonging to a different client entirely.",
      "other-hash"
    );
    const otherSource = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", otherGenerationId))
        .first()
    );

    const briefId = await t.mutation(internal.generations.persistDerivedBrief, {
      projectId: ownProjectId,
      generationId: ownGenerationId,
      inputsHash: "own-hash",
      origin: "derived",
      storylineText: "A storyline for the owning project.",
      entries: [
        {
          group: "storyline",
          text: "A claim citing another client's source.",
          sourceId: otherSource!._id,
          sourceContentHash: otherSource!.contentHash,
          startOffset: 0,
          endOffset: otherSource!.content.length,
          exactExcerpt: otherSource!.content,
        },
      ],
      // The owning project has no Brief yet, so the fence expects none.
      baselineBriefId: null,
      baselineRetained: [],
      baselineRemoved: [],
    });
    if (!briefId) throw new Error("the fence refused a project with no Brief");

    const brief = await t.run((ctx) => ctx.db.get(briefId));
    expect(brief?.droppedEntryCount).toBe(1);
    const entries = await t.run((ctx) =>
      ctx.db.query("generationBriefEntries").withIndex("by_briefId", (q) => q.eq("briefId", briefId)).collect()
    );
    expect(entries).toHaveLength(0);
  });

  it("persistDerivedBrief drops a candidate entry whose source belongs to a different generation in the same project", async () => {
    // Isolates the `generationId` half of the tenant-scoping check from the
    // `projectId` half: the sibling test above differs in both fields at
    // once, so a regression that dropped only the generationId comparison
    // (while leaving the projectId comparison intact) would still pass it —
    // the projectId mismatch alone would still trip the guard. Two
    // generations in the same project give a source with a matching
    // projectId but a different generationId, exercising that comparison on
    // its own.
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const ownGenerationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "own-hash-2");
    const siblingGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      "Sibling generation content, same project, different generation.",
      "sibling-hash"
    );
    const siblingSource = await t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", siblingGenerationId))
        .first()
    );

    const briefId = await t.mutation(internal.generations.persistDerivedBrief, {
      projectId,
      generationId: ownGenerationId,
      inputsHash: "own-hash-2",
      origin: "derived",
      storylineText: "A storyline for the owning generation.",
      entries: [
        {
          group: "storyline",
          text: "A claim citing a sibling generation's source.",
          sourceId: siblingSource!._id,
          sourceContentHash: siblingSource!.contentHash,
          startOffset: 0,
          endOffset: siblingSource!.content.length,
          exactExcerpt: siblingSource!.content,
        },
      ],
      // The project has no Brief yet, so the fence expects none.
      baselineBriefId: null,
      baselineRetained: [],
      baselineRemoved: [],
    });
    if (!briefId) throw new Error("the fence refused a project with no Brief");

    const brief = await t.run((ctx) => ctx.db.get(briefId));
    expect(brief?.droppedEntryCount).toBe(1);
    const entries = await t.run((ctx) =>
      ctx.db.query("generationBriefEntries").withIndex("by_briefId", (q) => q.eq("briefId", briefId)).collect()
    );
    expect(entries).toHaveLength(0);
  });
});

describe("Generation Brief editing and questions (briefs.ts, story 1 shape / story 4 writer)", () => {
  async function briefFixture(t: ReturnType<typeof convexTest>) {
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "edit-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    const briefId = generation!.briefId!;
    return { userId, projectId, generationId, briefId };
  }

  it("saveEntryEdit creates version N+1 with origin=edited and editMagnitude", async () => {
    const t = convexTest(schema, modules);
    const { userId, briefId, projectId } = await briefFixture(t);
    const entries = await t.run((ctx) =>
      ctx.db.query("generationBriefEntries").withIndex("by_briefId", (q) => q.eq("briefId", briefId)).collect()
    );
    const storylineEntry = entries.find((e) => e.group === "storyline")!;

    const asWriter = t.withIdentity({ subject: "brief-writer" });
    const editedBriefId = (await asWriter.mutation(anyApi.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: storylineEntry._id,
      editedText: "The writer's corrected Storyline claim.",
    })) as Id<"generationBriefs">;
    expect(editedBriefId).not.toBe(briefId);

    const edited = await t.run((ctx) => ctx.db.get(editedBriefId));
    expect(edited).toMatchObject({ origin: "edited", version: 2 });
    expect(edited?.editMagnitude?.changedEntriesCount).toBe(1);
    // Story 4: editing a Storyline *claim* changes that claim only; the
    // Brief-level Storyline (`storylineText`) is untouched.
    expect(edited?.storylineText).toBe(briefOutput().storyline);

    // Stale-version edit is refused.
    await expect(
      asWriter.mutation(anyApi.briefs.saveEntryEdit, {
        projectId,
        briefId,
        expectedBriefVersion: 1,
        entryId: storylineEntry._id,
        editedText: "Another edit against the now-stale version.",
      })
    ).rejects.toThrow();
  });

  it("storylineQuestion entries round-trip and saveEntryEdit resolves them", async () => {
    const t = convexTest(schema, modules);
    const { userId, briefId, projectId } = await briefFixture(t);
    // Story 2's Self-check raises these — simulated here directly, since
    // this story only defines the shape and its resolution.
    const questionEntryId = await t.run(async (ctx) => {
      const brief = (await ctx.db.get(briefId as Id<"generationBriefs">))!;
      const source = (
        await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", brief.generationId)).collect()
      )[0];
      return await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId: brief.projectId,
        group: "storylineQuestion",
        text: "Section evidence contradicts the derived Storyline.",
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        startOffset: 0,
        endOffset: 1,
        exactExcerpt: source.content.slice(0, 1),
        question: { questionText: "Does the evidence override the Storyline claim?" },
        createdAt: Date.now(),
      });
    });

    const asWriter = t.withIdentity({ subject: "brief-writer" });
    const resolvedBriefId = (await asWriter.mutation(anyApi.briefs.saveEntryEdit, {
      projectId,
      briefId,
      expectedBriefVersion: 1,
      entryId: questionEntryId,
      resolvedBy: "use_evidence",
      alternativeText: "The evidence-based alternative Storyline claim.",
    })) as Id<"generationBriefs">;

    const resolvedEntries = await t.run((ctx) =>
      ctx.db.query("generationBriefEntries").withIndex("by_briefId", (q) => q.eq("briefId", resolvedBriefId)).collect()
    );
    const resolvedQuestion = resolvedEntries.find((e) => e.group === "storylineQuestion")!;
    expect(resolvedQuestion.question?.resolvedBy).toBe("use_evidence");
    expect(resolvedQuestion.question?.alternativeText).toBe("The evidence-based alternative Storyline claim.");
  });

  it("getBrief and listBriefEntries read the stored Brief for the UI panel", async () => {
    const t = convexTest(schema, modules);
    const { generationId, briefId } = await briefFixture(t);
    // Story 4: both reads require project access.
    const asWriter = t.withIdentity({ subject: "brief-writer" });
    const read = await asWriter.query(anyApi.briefs.getBrief, { generationId });
    expect(read?._id).toBe(briefId);
    expect(read?.entries.length).toBeGreaterThan(0);

    // Story 4: null is reserved for an outsider and for a Brief that does
    // not exist; an insider reading a real Brief still gets the array.
    const entries = await asWriter.query(anyApi.briefs.listBriefEntries, { briefId });
    expect(entries).not.toBeNull();
    expect(entries!.length).toBe(read!.entries.length);
  });

  it("getBrief and listBriefEntries return null to an unauthenticated caller and to a non-internal user", async () => {
    const t = convexTest(schema, modules);
    const { generationId, briefId } = await briefFixture(t);
    // A mapped user with no internal role is not an internal actor
    // (getInternalProjectAccessOrNull), exactly like anonymous auth.
    await t.run((ctx) => ctx.db.insert("users", { authId: "brief-outsider" }));

    // Unauthenticated: a valid id alone must not read project content.
    expect(await t.query(anyApi.briefs.getBrief, { generationId })).toBeNull();
    expect(await t.query(anyApi.briefs.listBriefEntries, { briefId })).toBeNull();

    // Authenticated but outside the internal roster.
    const asOutsider = t.withIdentity({ subject: "brief-outsider" });
    expect(await asOutsider.query(anyApi.briefs.getBrief, { generationId })).toBeNull();
    expect(await asOutsider.query(anyApi.briefs.listBriefEntries, { briefId })).toBeNull();
  });
});

// ─── DW-107/DW-118: Brief read completeness and diff-baseline integrity ──────
//
// Two defects the story-1 suite above never exercised:
//
// DW-107 — every Brief read in `convex/generations.ts` was silently bounded
// (`.take(200)` for frozen sources, `.take(500)` for entries), so an
// over-cap project would derive from, diff against, or draft from a silent
// prefix with no signal. Now no read yields a prefix: the source read refuses
// with INVALID_STATE above its bound (under the derivation's fail-open catch),
// the two generation consumers omit an over-bound Brief whole, and the diff
// baseline is read completely, page by page, and published under a fence
// (`ai/brief.ts:publishDerivedBrief`), so an over-bound newest Brief never
// blocks the next derivation.
//
// DW-118 — `persistDerivedBrief` diffed against *every* previous row, so the
// previous version's own `change: "removed"` markers were re-diffed (and the
// marker re-inserted) on every later version, and its `storylineQuestion`
// rows came back as bogus "removed" evidence. `renderBriefForGeneration`
// filtered only by `group`, so those historical markers reached the
// one-shot/iterative section prompts even though `loadBriefCheck` already
// skipped them.

/** `convexTest` bound to this app's schema. The bare
 * `ReturnType<typeof convexTest>` loses the schema, so a helper typed with it
 * cannot name a real index (`ctx.db.query` falls back to the system tables) —
 * which is why the older helpers in this file `.collect()` and filter in
 * memory instead. */
type TestApp = TestConvex<typeof schema>;

/** The code of the ConvexError a call throws, or a sentinel. */
async function domainErrorOf(call: () => Promise<unknown>) {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      return {
        code: String((data as { code: unknown }).code),
        message: String((data as { message?: unknown }).message ?? ""),
      };
    }
    return { code: "UNTYPED", message: (error as Error).message };
  }
  return { code: "NO_ERROR", message: "" };
}

async function briefSourceOf(
  t: TestApp,
  generationId: Id<"generations">
) {
  const source = await t.run((ctx) =>
    ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .first()
  );
  if (!source) throw new Error("frozen source missing");
  return source;
}

/** A candidate entry citing `quote` verbatim inside the frozen source. */
function candidateEntry(
  source: { _id: Id<"generationSources">; content: string; contentHash: string },
  group: "storyline" | "claimExclusion" | "confidenceMap" | "glossaryTerm",
  quote: string,
  extra: { reason?: "business_risk"; confidence?: "unresolved" } = {}
) {
  const startOffset = source.content.indexOf(quote);
  if (startOffset === -1) throw new Error(`quote not in frozen source: ${quote}`);
  return {
    group,
    text: quote,
    sourceId: source._id,
    sourceContentHash: source.contentHash,
    startOffset,
    endOffset: startOffset + quote.length,
    exactExcerpt: quote,
    ...extra,
  };
}

// The ordered chain single/compare candidates run (AD-24): one scheduled
// candidate action, one per section in Build Order, then finalize. Same job
// names `promptProgram.test.ts:209-212` drives.
const CANDIDATE_JOB = "ai/pipeline:generateCandidate";
const SECTION_JOB = "ai/orderedGeneration:generateOrderedSection";
const FINALIZE_JOB = "ai/orderedGeneration:finalizeOrderedCandidate";

/** Run the whole scheduled chain to exhaustion, one job at a time. */
async function drainGeneration(t: TestApp) {
  for (let round = 0; round < 60; round += 1) {
    const [job] = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (row) =>
          row.state.kind === "pending" &&
          [CANDIDATE_JOB, SECTION_JOB, FINALIZE_JOB].includes(row.name)
      )
    );
    if (!job) return;
    await t.run((ctx) => ctx.scheduler.cancel(job._id));
    const args = job.args[0] as never;
    if (job.name === CANDIDATE_JOB) {
      await t.action(internal.ai.pipeline.generateCandidate, args);
    } else if (job.name === SECTION_JOB) {
      await t.action(internal.ai.orderedGeneration.generateOrderedSection, args);
    } else {
      await t.action(internal.ai.orderedGeneration.finalizeOrderedCandidate, args);
    }
  }
  throw new Error("the generation chain did not drain");
}

async function entriesOf(
  t: TestApp,
  briefId: Id<"generationBriefs">
) {
  return await t.run((ctx) =>
    ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
      .collect()
  );
}

/** One call the publish path made through `briefPublishCtx`. */
type BriefStageCall = { name: string; args: Record<string, unknown>; result?: unknown };

/**
 * `publishDerivedBrief`'s ctx over this test's backend: each call becomes its
 * own `t.query`/`t.mutation` transaction, exactly as `ctx.runQuery` /
 * `ctx.runMutation` are from the action. Every call is recorded, and `before`
 * runs ahead of each one — a case uses it to publish a concurrent version or
 * fail a page read at a precise step.
 */
function briefPublishCtx(
  t: TestApp,
  before?: (call: BriefStageCall, calls: BriefStageCall[]) => Promise<void>
) {
  const calls: BriefStageCall[] = [];
  const run = async (
    kind: "query" | "mutation",
    reference: FunctionReference<"query" | "mutation", "public" | "internal">,
    args: Record<string, unknown> = {}
  ) => {
    const call: BriefStageCall = { name: getFunctionName(reference), args };
    calls.push(call);
    await before?.(call, calls);
    const result =
      kind === "query"
        ? await t.query(reference as FunctionReference<"query", "internal">, args as never)
        : await t.mutation(reference as FunctionReference<"mutation", "internal">, args as never);
    call.result = result;
    return result;
  };
  const ctx = {
    runQuery: (reference, ...args) =>
      run("query", reference, args[0] as Record<string, unknown> | undefined),
    runMutation: (reference, ...args) =>
      run("mutation", reference, args[0] as Record<string, unknown> | undefined),
  } as BriefPublishCtx;
  return { ctx, calls };
}

const PAGE_QUERY = "generations:getBriefDiffBaselinePage";
const PERSIST_MUTATION = "generations:persistDerivedBrief";

describe("Generation Brief publication idempotency (DW-112)", () => {
  it("publishes one first version when two same-key derivations reach persistence together", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const inputsHash = "concurrent-first-publication";
    const firstGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "shared-source-hash"
    );
    const secondGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "shared-source-hash"
    );
    const firstSource = await briefSourceOf(t, firstGenerationId);
    const secondSource = await briefSourceOf(t, secondGenerationId);

    const observed = await Promise.all([
      t.query(internal.generations.findReusableBrief, { projectId, inputsHash }),
      t.query(internal.generations.findReusableBrief, { projectId, inputsHash }),
    ]);
    expect(observed).toEqual([null, null]);

    let releasePersistence: () => void = () => {};
    const bothAtPersistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    let publishersAtPersistence = 0;
    const synchronizePersistence = async (call: BriefStageCall) => {
      if (call.name !== PERSIST_MUTATION) return;
      publishersAtPersistence += 1;
      if (publishersAtPersistence === 2) releasePersistence();
      await bothAtPersistence;
    };
    const firstCtx = briefPublishCtx(t, synchronizePersistence).ctx;
    const secondCtx = briefPublishCtx(t, synchronizePersistence).ctx;
    const publish = (
      ctx: BriefPublishCtx,
      generationId: Id<"generations">,
      source: Awaited<ReturnType<typeof briefSourceOf>>
    ) =>
      publishDerivedBrief(ctx, {
        projectId,
        generationId,
        inputsHash,
        origin: "derived",
        storylineText: `Storyline proposed by ${generationId}.`,
        entries: [candidateEntry(source, "glossaryTerm", "control loop")],
      });

    const [firstResult, secondResult] = await Promise.all([
      publish(firstCtx, firstGenerationId, firstSource),
      publish(secondCtx, secondGenerationId, secondSource),
    ]);

    expect(secondResult).toBe(firstResult);
    const stored = await t.run((ctx) =>
      ctx.db
        .query("generationBriefs")
        .withIndex("by_projectId_and_inputsHash", (q) =>
          q.eq("projectId", projectId).eq("inputsHash", inputsHash)
        )
        .collect()
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ _id: firstResult, version: 1 });
    expect(await entriesOf(t, firstResult)).toHaveLength(1);
    const generations = await Promise.all([
      t.run((ctx) => ctx.db.get(firstGenerationId)),
      t.run((ctx) => ctx.db.get(secondGenerationId)),
    ]);
    expect(generations.map((generation) => generation?.briefId)).toEqual([
      firstResult,
      firstResult,
    ]);
  });

  it("adopts the first publication when it becomes the current baseline before the second baseline read", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const inputsHash = "current-same-key-baseline";
    const firstGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "first-current-baseline-source"
    );
    const secondGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "second-current-baseline-source"
    );
    const firstSource = await briefSourceOf(t, firstGenerationId);
    const secondSource = await briefSourceOf(t, secondGenerationId);

    const reuseMisses = await Promise.all([
      t.query(internal.generations.findReusableBrief, { projectId, inputsHash }),
      t.query(internal.generations.findReusableBrief, { projectId, inputsHash }),
    ]);
    expect(reuseMisses).toEqual([null, null]);

    const firstPublish = {
      projectId,
      generationId: firstGenerationId,
      inputsHash,
      origin: "derived" as const,
      storylineText: "The first publisher's authoritative storyline.",
      entries: [candidateEntry(firstSource, "glossaryTerm", "control loop")],
    };
    const secondPublish = {
      projectId,
      generationId: secondGenerationId,
      inputsHash,
      origin: "derived" as const,
      storylineText: "The second publisher's losing storyline.",
      entries: [candidateEntry(secondSource, "claimExclusion", "redesign the logo")],
    };

    const firstAdapter = briefPublishCtx(t);
    const firstResult = await publishDerivedBrief(firstAdapter.ctx, firstPublish);
    const authoritativeSnapshot = await t.run(async (ctx) => ({
      briefs: await ctx.db.query("generationBriefs").collect(),
      entries: await ctx.db.query("generationBriefEntries").collect(),
    }));
    expect(authoritativeSnapshot.briefs).toHaveLength(1);
    expect(authoritativeSnapshot.entries).toHaveLength(1);

    const secondAdapter = briefPublishCtx(t);
    const secondResult = await publishDerivedBrief(secondAdapter.ctx, secondPublish);
    const secondPersistence = secondAdapter.calls.filter(
      (call) => call.name === PERSIST_MUTATION
    );
    expect(secondPersistence).toHaveLength(1);
    expect(secondPersistence[0]).toMatchObject({
      args: { baselineBriefId: firstResult },
      result: firstResult,
    });
    expect(secondResult).toBe(firstResult);
    expect(
      await t.run(async (ctx) => ({
        briefs: await ctx.db.query("generationBriefs").collect(),
        entries: await ctx.db.query("generationBriefEntries").collect(),
      }))
    ).toEqual(authoritativeSnapshot);

    const generationsAfterAdoption = await Promise.all([
      t.run((ctx) => ctx.db.get(firstGenerationId)),
      t.run((ctx) => ctx.db.get(secondGenerationId)),
    ]);
    expect(generationsAfterAdoption.map((generation) => generation?.briefId)).toEqual([
      firstResult,
      firstResult,
    ]);

    const replayAdapter = briefPublishCtx(t);
    const replayResult = await publishDerivedBrief(replayAdapter.ctx, secondPublish);
    const replayPersistence = replayAdapter.calls.filter(
      (call) => call.name === PERSIST_MUTATION
    );
    expect(replayPersistence).toHaveLength(1);
    expect(replayPersistence[0]).toMatchObject({
      args: { baselineBriefId: firstResult },
      result: firstResult,
    });
    expect(replayResult).toBe(firstResult);
    expect(
      await t.run(async (ctx) => ({
        briefs: await ctx.db.query("generationBriefs").collect(),
        entries: await ctx.db.query("generationBriefEntries").collect(),
      }))
    ).toEqual(authoritativeSnapshot);
    expect((await t.run((ctx) => ctx.db.get(secondGenerationId)))?.briefId).toBe(
      firstResult
    );
  });

  it("adopts the latest same-key Brief before a stale project fence or candidate processing", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const inputsHash = "already-published-key";
    const priorGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "prior-source-hash"
    );
    const targetGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "target-source-hash"
    );
    const priorSource = await briefSourceOf(t, priorGenerationId);
    const targetSource = await briefSourceOf(t, targetGenerationId);
    const { firstSameKeyId, latestSameKeyId, retainedEntryId } = await t.run(
      async (ctx) => {
        const now = Date.now();
        const firstSameKeyId = await ctx.db.insert("generationBriefs", {
          projectId,
          generationId: priorGenerationId,
          inputsHash,
          version: 1,
          origin: "derived",
          storylineText: "First stored version.",
          createdAt: now,
        });
        const latestSameKeyId = await ctx.db.insert("generationBriefs", {
          projectId,
          generationId: priorGenerationId,
          inputsHash,
          version: 2,
          origin: "edited",
          storylineText: "Latest stored version.",
          createdAt: now + 1,
        });
        const retainedEntryId = await ctx.db.insert("generationBriefEntries", {
          briefId: latestSameKeyId,
          projectId,
          group: "glossaryTerm",
          text: "control loop",
          sourceId: priorSource._id,
          sourceContentHash: priorSource.contentHash,
          startOffset: priorSource.content.indexOf("control loop"),
          endOffset: priorSource.content.indexOf("control loop") + "control loop".length,
          exactExcerpt: "control loop",
          createdAt: now + 1,
        });
        await ctx.db.insert("generationBriefs", {
          projectId,
          generationId: priorGenerationId,
          inputsHash: "newer-different-key",
          version: 1,
          origin: "derived",
          storylineText: "Project-wide newest Brief.",
          createdAt: now + 2,
        });
        return { firstSameKeyId, latestSameKeyId, retainedEntryId };
      }
    );
    const before = await t.run(async (ctx) => ({
      briefs: await ctx.db.query("generationBriefs").collect(),
      entries: await ctx.db.query("generationBriefEntries").collect(),
    }));

    const result = await t.mutation(internal.generations.persistDerivedBrief, {
      projectId,
      generationId: targetGenerationId,
      inputsHash,
      origin: "derived",
      storylineText: "This candidate must not be published.",
      entries: [
        {
          ...candidateEntry(targetSource, "glossaryTerm", "control loop"),
          exactExcerpt: "not the cited bytes",
        },
      ],
      baselineBriefId: firstSameKeyId,
      baselineRetained: [{ entryId: retainedEntryId, candidateIndex: 99 }],
      baselineRemoved: [],
    });

    expect(result).toBe(latestSameKeyId);
    expect((await t.run((ctx) => ctx.db.get(targetGenerationId)))?.briefId).toBe(
      latestSameKeyId
    );
    expect(
      await t.run(async (ctx) => ({
        briefs: await ctx.db.query("generationBriefs").collect(),
        entries: await ctx.db.query("generationBriefEntries").collect(),
      }))
    ).toEqual(before);
  });

  // Validation hardening: DW-112 moved the DW-107 writer-edit and
  // retry-exhaustion races onto changed-input keys. The cases below pin the
  // spec's same-key outcome for those races: persistence adopts and stamps the
  // latest stored same-key Brief (a writer edit included) before the project
  // fence, so a same-key version never costs a retry or creates a version.
  async function allBriefRows(t: TestApp) {
    return await t.run(async (ctx) => ({
      briefs: await ctx.db.query("generationBriefs").collect(),
      entries: await ctx.db.query("generationBriefEntries").collect(),
    }));
  }

  it("adopts a same-key writer edit that lands between baseline pin and publish, without a retry or a new version", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const inputsHash = "same-key-writer-edit-race";
    const firstGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "same-key-edit-first-source"
    );
    const secondGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "same-key-edit-second-source"
    );
    const firstSource = await briefSourceOf(t, firstGenerationId);
    const secondSource = await briefSourceOf(t, secondGenerationId);

    // Both derivations missed reuse before any Brief existed for the key.
    expect(
      await t.query(internal.generations.findReusableBrief, { projectId, inputsHash })
    ).toBeNull();
    const v1 = await publishDerivedBrief(briefPublishCtx(t).ctx, {
      projectId,
      generationId: firstGenerationId,
      inputsHash,
      origin: "derived",
      storylineText: "The first publisher's storyline.",
      entries: [candidateEntry(firstSource, "glossaryTerm", "control loop")],
    });

    const asWriter = t.withIdentity({ subject: "brief-writer" });
    const observed: {
      editedId?: Id<"generationBriefs">;
      afterEdit?: Awaited<ReturnType<typeof allBriefRows>>;
    } = {};
    const { ctx, calls } = briefPublishCtx(t, async (call, all) => {
      if (call.name !== PERSIST_MUTATION) return;
      if (all.filter((c) => c.name === PERSIST_MUTATION).length !== 1) return;
      // The second derivation already pinned v1; the writer edits it now.
      observed.editedId = (await asWriter.mutation(anyApi.briefs.saveEntryEdit, {
        projectId,
        briefId: v1,
        expectedBriefVersion: 1,
        editedStorylineText: "The writer's same-key storyline edit.",
      })) as Id<"generationBriefs">;
      observed.afterEdit = await allBriefRows(t);
    });

    const result = await publishDerivedBrief(ctx, {
      projectId,
      generationId: secondGenerationId,
      inputsHash,
      origin: "derived",
      storylineText: "The second publisher's storyline must not be stored.",
      entries: [candidateEntry(secondSource, "claimExclusion", "redesign the logo")],
    });

    const { editedId, afterEdit } = observed;
    expect(editedId).toBeDefined();
    expect(await t.run((ctx) => ctx.db.get(editedId!))).toMatchObject({
      inputsHash,
      version: 2,
      origin: "edited",
    });
    const persisted = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      args: { baselineBriefId: v1 },
      result: editedId,
    });
    expect(result).toBe(editedId);
    expect(await allBriefRows(t)).toEqual(afterEdit);
    expect((await t.run((ctx) => ctx.db.get(secondGenerationId)))?.briefId).toBe(editedId);
    expect((await t.run((ctx) => ctx.db.get(firstGenerationId)))?.briefId).toBe(v1);
  });

  it("never exhausts publish attempts when every attempt races a same-key writer edit", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const inputsHash = "same-key-moving-edits";
    const generationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "same-key-moving-source"
    );
    const source = await briefSourceOf(t, generationId);
    const entries = [candidateEntry(source, "claimExclusion", "redesign the logo")];
    const v1 = await publishDerivedBrief(briefPublishCtx(t).ctx, {
      projectId,
      generationId,
      inputsHash,
      origin: "derived",
      storylineText: "Stored same-key storyline.",
      entries,
    });

    // Before every publish attempt, the writer saves another same-key edit.
    const asWriter = t.withIdentity({ subject: "brief-writer" });
    const editIds: Id<"generationBriefs">[] = [];
    const { ctx, calls } = briefPublishCtx(t, async (call) => {
      if (call.name !== PERSIST_MUTATION) return;
      const latest = await t.query(internal.generations.findReusableBrief, {
        projectId,
        inputsHash,
      });
      editIds.push(
        (await asWriter.mutation(anyApi.briefs.saveEntryEdit, {
          projectId,
          briefId: latest!._id,
          expectedBriefVersion: latest!.version,
          editedStorylineText: `Same-key writer edit ${editIds.length + 1}.`,
        })) as Id<"generationBriefs">
      );
    });

    const result = await publishDerivedBrief(ctx, {
      projectId,
      generationId,
      inputsHash,
      origin: "derived",
      storylineText: "A same-key re-publication must not be stored.",
      entries,
    });

    const persisted = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(persisted.map((call) => call.result)).toEqual([editIds[0]]);
    expect(editIds).toHaveLength(1);
    expect(result).toBe(editIds[0]);
    const { briefs } = await allBriefRows(t);
    expect(briefs.map((row) => [row._id, row.origin, row.version])).toEqual([
      [v1, "derived", 1],
      [editIds[0], "edited", 2],
    ]);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(editIds[0]);
  });

  it("adopts a same-key version that appears on the last attempt after different-key versions moved the fence", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const inputsHash = "same-key-on-last-attempt";
    const targetGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "last-attempt-target-source"
    );
    const racingGenerationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "last-attempt-racing-source"
    );
    const targetSource = await briefSourceOf(t, targetGenerationId);
    const racingSource = await briefSourceOf(t, racingGenerationId);

    // Before attempts 1..N-1 a different-key derivation publishes (a lost
    // fence); before attempt N a same-key derivation publishes first.
    const racingIds: Id<"generationBriefs">[] = [];
    const { ctx, calls } = briefPublishCtx(t, async (call, all) => {
      if (call.name !== PERSIST_MUTATION) return;
      const attempt = all.filter((c) => c.name === PERSIST_MUTATION).length;
      racingIds.push(
        await publishDerivedBrief(briefPublishCtx(t).ctx, {
          projectId,
          generationId: racingGenerationId,
          inputsHash:
            attempt < BRIEF_PUBLISH_ATTEMPTS ? `different-key-${attempt}` : inputsHash,
          origin: "derived",
          storylineText: `Racing publication ${attempt}.`,
          entries: [candidateEntry(racingSource, "glossaryTerm", "control loop")],
        })
      );
    });

    const result = await publishDerivedBrief(ctx, {
      projectId,
      generationId: targetGenerationId,
      inputsHash,
      origin: "derived",
      storylineText: "The target's storyline must not be stored.",
      entries: [candidateEntry(targetSource, "claimExclusion", "redesign the logo")],
    });

    expect(racingIds).toHaveLength(BRIEF_PUBLISH_ATTEMPTS);
    const sameKeyId = racingIds[BRIEF_PUBLISH_ATTEMPTS - 1];
    const persisted = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(persisted.map((call) => call.result)).toEqual([
      ...Array.from({ length: BRIEF_PUBLISH_ATTEMPTS - 1 }, () => null),
      sameKeyId,
    ]);
    expect(result).toBe(sameKeyId);
    const { briefs } = await allBriefRows(t);
    expect(briefs.filter((row) => row.inputsHash === inputsHash).map((row) => row._id)).toEqual([
      sameKeyId,
    ]);
    expect(briefs.map((row) => row.storylineText)).not.toContain(
      "The target's storyline must not be stored."
    );
    expect((await t.run((ctx) => ctx.db.get(targetGenerationId)))?.briefId).toBe(sameKeyId);
  });
});

describe("Generation Brief read completeness and diff baseline (DW-107/DW-118)", () => {
  const KEPT_QUOTE = "Marketing decided to redesign the logo";
  const DROPPED_QUOTE = "control loop";
  /** A frozen source long enough that every seeded/derived citation offset
   * below is a real byte range inside it (600+ distinct single-character
   * ranges). */
  const LONG_CONTENT = "abcdefghij".repeat(80);

  /** projectId + generationId + the one frozen source, plus a `derive`
   * shortcut publishing candidates through the derivation stage's own
   * `publishDerivedBrief` (complete baseline read, fenced publish). */
  async function derivationFixture(t: TestApp, inputsHash: string, content = TRANSCRIPT_TEXT) {
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, content, inputsHash);
    const source = await briefSourceOf(t, generationId);
    let derivationNumber = 0;
    const derive = (entries: ReturnType<typeof candidateEntry>[], ctx = briefPublishCtx(t).ctx) => {
      derivationNumber += 1;
      return publishDerivedBrief(ctx, {
        projectId,
        generationId,
        // Every call models a changed-input derivation. Same-key publication
        // now adopts the already-stored Brief instead of creating a version.
        inputsHash: `${inputsHash}:derivation-${derivationNumber}`,
        origin: "derived" as const,
        storylineText: "A storyline for the repeated derivation.",
        entries,
      });
    };
    return { userId, projectId, generationId, source, derive };
  }

  it("does not re-insert a removed marker across repeated derivations, and stamps a returning entry as added", async () => {
    const t = convexTest(schema, modules);
    const { source, derive } = await derivationFixture(t, "repeat-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const dropped = candidateEntry(source, "glossaryTerm", DROPPED_QUOTE);

    // v1: first version ever — `change` is undefined, not "added".
    const v1 = await derive([kept, dropped]);
    const v1Entries = await entriesOf(t, v1);
    expect(v1Entries).toHaveLength(2);
    expect(v1Entries.every((e) => e.change === undefined)).toBe(true);

    // v2: the glossary term is gone — exactly one "removed" marker for it.
    const v2 = await derive([kept]);
    const v2Entries = await entriesOf(t, v2);
    expect(v2Entries).toHaveLength(2);
    expect(v2Entries.filter((e) => e.change === "removed").map((e) => e.group)).toEqual([
      "glossaryTerm",
    ]);
    expect(v2Entries.find((e) => e.group === "claimExclusion")?.change).toBe("unchanged");

    // v3: still gone. The v2 marker is history, not baseline evidence, so it
    // is NOT re-diffed and NOT re-inserted. Before the fix the marker was
    // re-derived from itself and so persisted into every later version —
    // accumulating one stale marker per key ever dropped, for the life of the
    // project (DW-118). Now the row set simply shrinks.
    const v3 = await derive([kept]);
    const v3Entries = await entriesOf(t, v3);
    expect(v3Entries).toHaveLength(1);
    expect(v3Entries[0]).toMatchObject({ group: "claimExclusion", change: "unchanged" });

    // v4: the dropped entry returns. Because v3's baseline held only live
    // evidence, it is "added" — not "unchanged" against a stale marker.
    const v4 = await derive([kept, dropped]);
    const v4Entries = await entriesOf(t, v4);
    expect(v4Entries).toHaveLength(2);
    expect(v4Entries.find((e) => e.group === "glossaryTerm")?.change).toBe("added");
    expect(v4Entries.find((e) => e.group === "claimExclusion")?.change).toBe("unchanged");
  });

  it("never carries the previous version's storylineQuestion rows forward, as evidence or as a marker", async () => {
    const t = convexTest(schema, modules);
    const { projectId, source, derive } = await derivationFixture(t, "question-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const v1 = await derive([kept]);

    // story 2's Self-check raises a question on v1; only briefs.saveEntryEdit
    // owns and resolves it.
    const questionText = "Does the evidence override the Storyline claim?";
    await t.run((ctx) =>
      ctx.db.insert("generationBriefEntries", {
        briefId: v1,
        projectId,
        group: "storylineQuestion",
        text: questionText,
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        startOffset: 0,
        endOffset: 1,
        exactExcerpt: source.content.slice(0, 1),
        question: { questionText },
        createdAt: Date.now(),
      })
    );

    const v2 = await derive([kept]);
    const v2Entries = await entriesOf(t, v2);
    expect(v2Entries).toHaveLength(1);
    expect(v2Entries.some((e) => e.group === "storylineQuestion")).toBe(false);
    expect(v2Entries.filter((e) => e.change === "removed")).toHaveLength(0);
  });

  it("renders only live evidence, byte-identically to the Brief the ordered chain checks against", async () => {
    const t = convexTest(schema, modules);
    const { projectId, generationId, source } = await derivationFixture(t, "render-hash");
    const liveText = "Logo redesign is out of scope.";
    const removedText = "Response time under load is unresolved.";
    const questionText = "Is the Storyline claim supported?";
    await t.run(async (ctx) => {
      const now = Date.now();
      const briefId = await ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "render-hash",
        version: 1,
        origin: "derived",
        storylineText: "A storyline for the render filter.",
        createdAt: now,
      });
      const cite = {
        briefId,
        projectId,
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        startOffset: 0,
        endOffset: 1,
        exactExcerpt: source.content.slice(0, 1),
        createdAt: now,
      };
      await ctx.db.insert("generationBriefEntries", {
        ...cite,
        group: "claimExclusion",
        text: liveText,
        reason: "business_risk",
      });
      await ctx.db.insert("generationBriefEntries", {
        ...cite,
        group: "claimExclusion",
        text: removedText,
        reason: "business_risk",
        change: "removed",
      });
      await ctx.db.insert("generationBriefEntries", {
        ...cite,
        group: "storylineQuestion",
        text: questionText,
        question: { questionText },
      });
      await ctx.db.patch(generationId, { briefId });
    });

    const rendered = await t.query(internal.generations.renderBriefForGeneration, {
      generationId,
    });
    expect(rendered).toContain(liveText);
    expect(rendered).not.toContain(removedText);
    expect(rendered).not.toContain(questionText);

    // The ordered chain's own reader (loadBriefCheck) must build the same
    // block, byte for byte — its doc comment claims exactly that parity.
    const candidateRunId = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(generationId, { status: "running" });
      const runId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-opus-4-8",
        label: "candidate draft",
        status: "running",
        queuedAt: now,
        startedAt: now,
      });
      await ctx.db.insert("generationSectionRuns", {
        generationId,
        projectId,
        section: "s242",
        status: "queued",
        model: "claude-opus-4-8",
        label: "candidate draft",
        attempt: 0,
        candidateRunId: runId,
        orderIndex: 0,
        queuedAt: now,
      });
      return runId;
    });
    const claimed = await t.mutation(internal.generations.claimOrderedSectionRun, {
      generationId,
      candidateRunId,
      section: "242",
    });
    if (!claimed || "stopped" in claimed) throw new Error("ordered section claim was stale");
    expect(claimed.briefBlock).toBe(rendered);
    expect(claimed.brief?.claimExclusions.map((e) => e.text)).toEqual([liveText]);
  });

  it("refuses a source read above MAX_BRIEF_SOURCE_ROWS; the generation completes with no Brief", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "source-overflow-hash");
    await t.run(async (ctx) => {
      const now = Date.now();
      const existing = await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect();
      for (let i = existing.length; i < MAX_BRIEF_SOURCE_ROWS + 1; i += 1) {
        const content = `Filler context document ${i}.`;
        await ctx.db.insert("generationSources", {
          projectId,
          generationId,
          kind: "project_document",
          label: `background:filler-${i}.txt`,
          content,
          contentHash: `filler-hash-${i}`,
          truncated: false,
          originalLength: content.length,
          capturedAt: now,
        });
      }
    });

    const failure = await domainErrorOf(() =>
      t.query(internal.generations.getGenerationSourcesForBrief, { generationId })
    );
    expect(failure.code).toBe("INVALID_STATE");
    expect(failure.message).toContain(String(MAX_BRIEF_SOURCE_ROWS));

    // The Brief stage runner (runGenerationBriefStage) keeps the refusal non-fatal: no Brief,
    // no Brief block in any prompt, generation still completes.
    network.create.mockClear();
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await drainGeneration(t);
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation?.status).toBe("completed");
    expect(generation?.briefId).toBeUndefined();
    expect(briefCalls()).toHaveLength(0);
    // DW-109/DW-120: a non-provider refusal is still a recorded, narrated
    // failed attempt — classified `unknown`, never silent.
    expect(generation?.briefOutcome).toEqual({
      kind: "failed",
      code: "unknown",
      detail: expect.any(String),
    });
    const failedLine = describeBriefOutcome({ kind: "failed", code: "unknown", detail: "" });
    expect(generation?.progressLog?.filter((line) => line === failedLine)).toHaveLength(1);

    // The only two ways a [GENERATION BRIEF] block can reach a prompt are
    // renderBriefForGeneration (one-shot/iterative) and loadBriefCheck (the
    // ordered chain, read here through getOrderedCandidateDrafts). Both are
    // empty for this generation, so no section prompt carried a block.
    // (`network.create.mock.calls` cannot be asserted on here: convex-test
    // runs leftover scheduled jobs from earlier cases in this file in the
    // background, and they share this module-level mock.)
    expect(
      await t.query(internal.generations.renderBriefForGeneration, { generationId })
    ).toBe("");
    const candidateRunId = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("generationCandidateRuns")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .first()
      )!._id
    );
    const drafts = await t.query(internal.generations.getOrderedCandidateDrafts, {
      generationId,
      candidateRunId,
    });
    expect(drafts?.brief).toBeNull();
  });

  it("diffs against every live row of an over-bound baseline, and a stale fence writes nothing", async () => {
    // Replaces attempt 1's refusal: the baseline is enumerated page by page to
    // `isDone`, so an over-bound newest Brief is a baseline like any other.
    const t = convexTest(schema, modules);
    const { projectId, generationId, source } = await derivationFixture(
      t,
      "baseline-overflow-hash",
      LONG_CONTENT
    );
    // Newest Brief: 501 live rows (offsets 0..500), 20 historical markers
    // (501..520) and one Self-check question = 522 rows.
    const baselineId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "previous-hash",
        version: 1,
        origin: "derived",
        storylineText: "An over-bound previous version.",
        createdAt: Date.now(),
      })
    );
    await seedEntryRows(t, { briefId: baselineId, projectId, source, count: MAX_BRIEF_ENTRY_ROWS + 1 });
    await seedEntryRows(t, {
      briefId: baselineId,
      projectId,
      source,
      count: 20,
      startAt: MAX_BRIEF_ENTRY_ROWS + 1,
      change: "removed",
    });
    await t.run((ctx) =>
      ctx.db.insert("generationBriefEntries", {
        briefId: baselineId,
        projectId,
        group: "storylineQuestion",
        text: "Is the Storyline claim supported?",
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        startOffset: 0,
        endOffset: 1,
        exactExcerpt: source.content.slice(0, 1),
        question: { questionText: "Is the Storyline claim supported?" },
        createdAt: Date.now(),
      })
    );
    const baselineRows = await entriesOf(t, baselineId);
    expect(baselineRows).toHaveLength(522);
    expect(baselineRows[MAX_BRIEF_ENTRY_ROWS]).toMatchObject({ text: `term-${MAX_BRIEF_ENTRY_ROWS}` });

    const glossary = (offset: number) => ({
      group: "glossaryTerm" as const,
      text: `term-${offset}`,
      sourceId: source._id,
      sourceContentHash: source.contentHash,
      startOffset: offset,
      endOffset: offset + 1,
      exactExcerpt: source.content.slice(offset, offset + 1),
    });
    // Keep offsets 0..499, drop the row at index 500, re-propose 510 (only a
    // historical marker on the baseline).
    const candidates = [
      ...Array.from({ length: MAX_BRIEF_ENTRY_ROWS }, (_unused, i) => glossary(i)),
      glossary(510),
    ];
    const publish = {
      projectId,
      generationId,
      inputsHash: "baseline-overflow-hash",
      origin: "derived" as const,
      storylineText: "Re-derived against an over-bound baseline.",
      entries: candidates,
    };

    // A stale fence (the caller believed the project had no Brief) returns
    // null before any write.
    const before = await briefTables(t);
    const stale = await t.mutation(internal.generations.persistDerivedBrief, {
      ...publish,
      baselineBriefId: null,
      baselineRetained: [],
      baselineRemoved: [],
    });
    expect(stale).toBeNull();
    expect(await briefTables(t)).toEqual(before);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBeUndefined();

    // Through the stage: two pages (500 rows, then the remaining 22); all 501
    // live baseline rows reach the comparison: the 500 a candidate reuses as
    // references, the one at index 500 as a full payload. One version is
    // published.
    const { ctx, calls } = briefPublishCtx(t);
    const nextId = await publishDerivedBrief(ctx, publish);
    const pages = calls.filter((call) => call.name === PAGE_QUERY);
    expect(pages.map((call) => (call.result as { readCount: number }).readCount)).toEqual([
      MAX_BRIEF_ENTRY_ROWS,
      22,
    ]);
    const persisted = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].args.baselineBriefId).toBe(baselineId);
    const retained = persisted[0].args.baselineRetained as Array<{
      entryId: Id<"generationBriefEntries">;
      candidateIndex: number;
    }>;
    expect(retained).toHaveLength(MAX_BRIEF_ENTRY_ROWS);
    const baselineRowById = new Map(baselineRows.map((row) => [row._id, row]));
    for (const reference of retained) {
      // Each reference names a live baseline row and a candidate with its key.
      expect(baselineRowById.get(reference.entryId)?.startOffset).toBe(
        candidates[reference.candidateIndex].startOffset
      );
    }
    expect(persisted[0].args.baselineRemoved).toEqual([
      expect.objectContaining({ text: `term-${MAX_BRIEF_ENTRY_ROWS}`, startOffset: MAX_BRIEF_ENTRY_ROWS }),
    ]);

    const nextRows = await entriesOf(t, nextId);
    const stamp = (row: { text: string; change?: string }) => `${row.text}:${row.change}`;
    expect(nextRows.map(stamp).sort()).toEqual(
      [
        ...Array.from({ length: MAX_BRIEF_ENTRY_ROWS }, (_unused, i) => `term-${i}:unchanged`),
        "term-510:added",
        `term-${MAX_BRIEF_ENTRY_ROWS}:removed`,
      ].sort()
    );
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(nextId);
    // The baseline itself is untouched.
    expect(await entriesOf(t, baselineId)).toEqual(baselineRows);
  });

  /** Both generation consumers for one generation, plus whether anything threw. */
  async function readBothConsumers(t: TestApp, generationId: Id<"generations">) {
    const projectId = (await t.run((ctx) => ctx.db.get(generationId)))!.projectId;
    const candidateRunId = await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("generationCandidateRuns")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .first();
      if (existing) return existing._id;
      const now = Date.now();
      return await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-opus-4-8",
        label: "candidate draft",
        status: "running",
        queuedAt: now,
        startedAt: now,
      });
    });
    // Awaited without a wrapping try on purpose: a throw from either read
    // fails the test, which is the contract (orderedGeneration.ts awaits both
    // outside its own try).
    const rendered = await t.query(internal.generations.renderBriefForGeneration, {
      generationId,
    });
    const drafts = await t.query(internal.generations.getOrderedCandidateDrafts, {
      generationId,
      candidateRunId,
    });
    // A null drafts result means a stale/mismatched run, not a Brief omission
    // — collapsing the two would let a broken fixture read as success.
    if (!drafts) throw new Error("getOrderedCandidateDrafts returned null");
    return { rendered, brief: drafts.brief };
  }

  /** `count` entry rows on `briefId`, each with its own diff key. */
  async function seedEntryRows(
    t: TestApp,
    args: {
      briefId: Id<"generationBriefs">;
      projectId: Id<"projects">;
      source: { _id: Id<"generationSources">; content: string; contentHash: string };
      count: number;
      startAt?: number;
      change?: "removed";
    }
  ) {
    await t.run(async (ctx) => {
      const now = Date.now();
      const from = args.startAt ?? 0;
      for (let i = from; i < from + args.count; i += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId: args.briefId,
          projectId: args.projectId,
          group: "glossaryTerm",
          text: `term-${i}`,
          sourceId: args.source._id,
          sourceContentHash: args.source.contentHash,
          startOffset: i,
          endOffset: i + 1,
          exactExcerpt: args.source.content.slice(i, i + 1),
          ...(args.change ? { change: args.change } : {}),
          createdAt: now,
        });
      }
    });
  }

  it("omits an over-bound Brief from both prompt readers instead of throwing", async () => {
    const t = convexTest(schema, modules);
    const { projectId, generationId, source } = await derivationFixture(t, "render-overflow-hash", LONG_CONTENT);
    const briefId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "render-overflow-hash",
        version: 1,
        origin: "derived",
        storylineText: "An over-cap current version.",
        createdAt: Date.now(),
      })
    );
    await seedEntryRows(t, {
      briefId,
      projectId,
      source,
      count: MAX_BRIEF_ENTRY_ROWS + 1,
    });
    await t.run((ctx) => ctx.db.patch(generationId, { briefId }));

    // Fail open: identical behaviour to a generation with no briefId at all.
    // A throw here would strand the section claimOrderedSectionRun just
    // claimed (orderedGeneration.ts:173-178 is outside its try at :200).
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const omitted = await readBothConsumers(t, generationId);
      expect(omitted).toEqual({ rendered: "", brief: null });
      // Each omission is diagnosable: the generation id, the Brief id and the
      // bound are all named.
      const lines = logged.mock.calls.map((call) => call.join(" "));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toContain(generationId);
        expect(line).toContain(briefId);
        expect(line).toContain(String(MAX_BRIEF_ENTRY_ROWS));
      }
    } finally {
      logged.mockRestore();
    }
  });

  // DW-152: the row bound alone does not bound bytes. Writer edits
  // (briefs.saveEntryEdit) accept any non-empty text, so a Brief at or under
  // MAX_BRIEF_ENTRY_ROWS can still exceed Convex's 16 MiB transaction read
  // limit. These cases run with convex-test's `transactionLimits: true`, which
  // enforces that limit (and the document-count limits) per transaction.
  /** Convex's per-transaction read limit, as convex-test enforces it. */
  const TRANSACTION_READ_LIMIT_BYTES = 16 * 1024 * 1024;
  /** Text per byte-heavy row: far under the 1 MiB document limit. */
  const HEAVY_TEXT_BYTES = 42_000;
  const heavyTerm = (i: number) => `heavy-${String(i).padStart(4, "0")}-${"x".repeat(HEAVY_TEXT_BYTES)}`;

  /** A Brief of `count` byte-heavy rows stamped on `generationId`. Seeded in
   * batches of 100 (about 4 MiB each) so no seeding transaction itself trips
   * the enforced write limit. */
  async function seedHeavyBrief(
    t: TestApp,
    args: {
      projectId: Id<"projects">;
      generationId: Id<"generations">;
      source: { _id: Id<"generationSources">; content: string; contentHash: string };
      count: number;
    }
  ) {
    const briefId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId: args.projectId,
        generationId: args.generationId,
        inputsHash: "byte-heavy-hash",
        version: 1,
        origin: "writer",
        storylineText: "A byte-heavy current version.",
        createdAt: Date.now(),
      })
    );
    for (let from = 0; from < args.count; from += 100) {
      await t.run(async (ctx) => {
        const now = Date.now();
        for (let i = from; i < Math.min(args.count, from + 100); i += 1) {
          await ctx.db.insert("generationBriefEntries", {
            briefId,
            projectId: args.projectId,
            group: "glossaryTerm",
            text: heavyTerm(i),
            sourceId: args.source._id,
            sourceContentHash: args.source.contentHash,
            startOffset: i,
            endOffset: i + 1,
            exactExcerpt: args.source.content.slice(i, i + 1),
            createdAt: now,
          });
        }
      });
    }
    await t.run((ctx) => ctx.db.patch(args.generationId, { briefId }));
    return briefId;
  }

  it("omits a byte-heavy Brief under the row bound that exceeds the transaction read limit from both prompt readers instead of throwing (DW-152)", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { projectId, generationId, source } = await derivationFixture(t, "byte-heavy-hash", LONG_CONTENT);
    const ROWS = 450;
    expect(ROWS).toBeLessThanOrEqual(MAX_BRIEF_ENTRY_ROWS);
    expect(ROWS * HEAVY_TEXT_BYTES).toBeGreaterThan(TRANSACTION_READ_LIMIT_BYTES);
    const briefId = await seedHeavyBrief(t, { projectId, generationId, source, count: ROWS });

    // The fixture really is past the enforced limit: the row-bounded probe
    // shape (`take(MAX_BRIEF_ENTRY_ROWS + 1)`) throws on its own.
    await expect(
      t.query((ctx) =>
        ctx.db
          .query("generationBriefEntries")
          .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
          .take(MAX_BRIEF_ENTRY_ROWS + 1)
      )
    ).rejects.toThrow("Read too much data");

    // Fail open, exactly like the row-count overflow above: no throw (which
    // would roll back claimOrderedSectionRun's CAS claim outside
    // orderedGeneration.ts's try), and the whole Brief omitted, never a prefix.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const omitted = await readBothConsumers(t, generationId);
      // Summarised so a failure prints sizes, not megabytes of row text.
      expect({ renderedBytes: omitted.rendered.length, briefOmitted: omitted.brief === null }).toEqual({
        renderedBytes: 0,
        briefOmitted: true,
      });
      const lines = logged.mock.calls.map((call) => call.join(" ").slice(0, 400));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toContain(generationId);
        expect(line).toContain(briefId);
        expect(line).toContain(String(BRIEF_CONSUMER_READ_BYTES));
        expect(line).not.toContain("heavy-");
      }
    } finally {
      logged.mockRestore();
    }
  });

  it("omits a Brief past the consumer byte budget even where the transaction read limit would allow the read (DW-152)", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { projectId, generationId, source } = await derivationFixture(t, "over-budget-hash", LONG_CONTENT);
    const ROWS = 200;
    const briefId = await seedHeavyBrief(t, { projectId, generationId, source, count: ROWS });

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const omitted = await readBothConsumers(t, generationId);
      // Summarised so a failure prints sizes, not megabytes of row text.
      expect({ renderedBytes: omitted.rendered.length, briefOmitted: omitted.brief === null }).toEqual({
        renderedBytes: 0,
        briefOmitted: true,
      });
      const lines = logged.mock.calls.map((call) => call.join(" ").slice(0, 400));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toContain(generationId);
        expect(line).toContain(briefId);
        expect(line).toContain(String(BRIEF_CONSUMER_READ_BYTES));
      }
    } finally {
      logged.mockRestore();
    }
    // Between the budget and the limit (with a budget's worth of headroom
    // left): the budget, not the platform limit, decided this omission.
    expect(ROWS * HEAVY_TEXT_BYTES).toBeGreaterThan(BRIEF_CONSUMER_READ_BYTES);
    expect(ROWS * HEAVY_TEXT_BYTES).toBeLessThan(TRANSACTION_READ_LIMIT_BYTES - BRIEF_CONSUMER_READ_BYTES);
  });

  it("reads a large Brief just under the consumer byte budget completely in both readers (DW-152 boundary)", async () => {
    // The boundary-success half of the byte budget: a budget check that is
    // too tight, or that treats a complete single page as incomplete, fails
    // here while both omission cases above still pass.
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { projectId, generationId, source } = await derivationFixture(t, "under-budget-hash", LONG_CONTENT);
    const ROWS = 80;
    await seedHeavyBrief(t, { projectId, generationId, source, count: ROWS });

    const read = await readBothConsumers(t, generationId);
    expect(read.brief?.glossaryTerms.length).toBe(ROWS);
    expect(read.brief?.glossaryTerms.at(-1) === heavyTerm(ROWS - 1)).toBe(true);
    expect(read.rendered.includes(heavyTerm(ROWS - 1))).toBe(true);
    // Rows plus a generous per-document overhead stay under the budget, so
    // this is the "just under" side of it.
    expect(ROWS * (HEAVY_TEXT_BYTES + 1024)).toBeLessThan(BRIEF_CONSUMER_READ_BYTES);
    expect(ROWS * HEAVY_TEXT_BYTES).toBeGreaterThan(BRIEF_CONSUMER_READ_BYTES * 0.75);
  });

  it("reuses an already-over-bound Brief onto a new generation, and both readers omit it", async () => {
    // The reachable production path: `ai/brief.ts:289-305` reuses a Brief by
    // parent row (findReusableBrief + stampGenerationBriefId) and never reads
    // its children, so nothing between an oversized stored Brief and a fresh
    // generation ever passes through deriveOrReuseBrief's fail-open catch.
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const firstGenerationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "reuse-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId: firstGenerationId });
    const briefId = (await t.run((ctx) => ctx.db.get(firstGenerationId)))!.briefId!;
    const source = await briefSourceOf(t, firstGenerationId);

    // Bloat the stored Brief past the bound, the way a single oversized
    // derivation would have.
    const before = (await entriesOf(t, briefId)).length;
    await seedEntryRows(t, {
      briefId,
      projectId,
      source,
      count: MAX_BRIEF_ENTRY_ROWS + 1 - before,
      // Past every offset the real derivation used, so no seeded row collides
      // with a derived one; TRANSCRIPT_TEXT is shorter than this, so these
      // rows carry an empty excerpt — irrelevant, since nothing revalidates a
      // stored entry's citation.
      startAt: 1000,
    });
    expect(await entriesOf(t, briefId)).toHaveLength(MAX_BRIEF_ENTRY_ROWS + 1);

    // A second generation with byte-identical frozen inputs: same inputsHash,
    // so the reuse branch stamps the oversized Brief with no child read.
    await t.run((ctx) =>
      ctx.db.patch(projectId, { status: "review", activeGenerationId: undefined })
    );
    const nextGenerationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "reuse-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId: nextGenerationId });
    expect((await t.run((ctx) => ctx.db.get(nextGenerationId)))?.briefId).toBe(briefId);

    const omitted = await readBothConsumers(t, nextGenerationId);
    expect(omitted).toEqual({ rendered: "", brief: null });
  });

  it("persists an oversized derivation in full, then omits it from both readers", async () => {
    // Publication is never capped: 300 live baseline rows plus 300 disjoint
    // candidates write 300 entries + 300 removal markers = 600 rows. The write
    // is never truncated (Never rule); it simply becomes a Brief consumers
    // omit.
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    // LONG_CONTENT so all 600 disjoint single-character citations pass
    // validateCitation's byte-match.
    const generationId = await makeGeneration(t, projectId, userId, LONG_CONTENT, "oversize-hash");
    const source = await briefSourceOf(t, generationId);

    const baselineBriefId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "baseline-hash",
        version: 1,
        origin: "derived",
        storylineText: "300 live baseline entries.",
        createdAt: Date.now(),
      })
    );
    await seedEntryRows(t, { briefId: baselineBriefId, projectId, source, count: 300 });

    const disjointCandidates = Array.from({ length: 300 }, (_unused, i) => {
      const offset = 300 + i;
      return {
        group: "glossaryTerm" as const,
        text: `candidate-${offset}`,
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        startOffset: offset,
        endOffset: offset + 1,
        exactExcerpt: source.content.slice(offset, offset + 1),
      };
    });
    const newBriefId = await publishDerivedBrief(briefPublishCtx(t).ctx, {
      projectId,
      generationId,
      inputsHash: "oversize-hash",
      origin: "derived",
      storylineText: "An oversized single derivation.",
      entries: disjointCandidates,
    });
    const newEntries = await entriesOf(t, newBriefId);
    expect(newEntries).toHaveLength(600);
    expect(newEntries.filter((e) => e.change === "added")).toHaveLength(300);
    expect(newEntries.filter((e) => e.change === "removed")).toHaveLength(300);

    const omitted = await readBothConsumers(t, generationId);
    expect(omitted).toEqual({ rendered: "", brief: null });
  });

  it("reads a Brief of exactly MAX_BRIEF_ENTRY_ROWS completely, in both consumers and as a diff baseline", async () => {
    // The boundary-success half of the bound: with a `>=` comparison or an
    // off-by-one probe size, every overflow case above still passes and only
    // this one fails.
    const t = convexTest(schema, modules);
    const { projectId, generationId, source } = await derivationFixture(t, "at-bound-hash", LONG_CONTENT);
    const briefId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "at-bound-hash",
        version: 1,
        origin: "derived",
        storylineText: "Exactly at the bound.",
        createdAt: Date.now(),
      })
    );
    await seedEntryRows(t, { briefId, projectId, source, count: MAX_BRIEF_ENTRY_ROWS });
    await t.run((ctx) => ctx.db.patch(generationId, { briefId }));
    expect(await entriesOf(t, briefId)).toHaveLength(MAX_BRIEF_ENTRY_ROWS);

    // The last row is present in both prompt readers, not one short.
    const lastTerm = `term-${MAX_BRIEF_ENTRY_ROWS - 1}`;
    const read = await readBothConsumers(t, generationId);
    expect(read.rendered).toContain(lastTerm);
    expect(read.brief?.glossaryTerms).toHaveLength(MAX_BRIEF_ENTRY_ROWS);
    expect(read.brief?.glossaryTerms).toContain(lastTerm);

    // And the changed-input write path accepts it as a diff baseline:
    // re-deriving the same 500 citations stamps every one `unchanged`, with
    // no refusal or marker.
    const identicalCandidates = Array.from({ length: MAX_BRIEF_ENTRY_ROWS }, (_unused, i) => ({
      group: "glossaryTerm" as const,
      text: `term-${i}`,
      sourceId: source._id,
      sourceContentHash: source.contentHash,
      startOffset: i,
      endOffset: i + 1,
      exactExcerpt: source.content.slice(i, i + 1),
    }));
    const nextBriefId = await publishDerivedBrief(briefPublishCtx(t).ctx, {
      projectId,
      generationId,
      inputsHash: "at-bound-next-hash",
      origin: "derived",
      storylineText: "Exactly at the bound, re-derived.",
      entries: identicalCandidates,
    });
    const nextEntries = await entriesOf(t, nextBriefId);
    expect(nextEntries).toHaveLength(MAX_BRIEF_ENTRY_ROWS);
    expect(nextEntries.every((entry) => entry.change === "unchanged")).toBe(true);
  });

  it("reads exactly MAX_BRIEF_SOURCE_ROWS frozen sources completely, without refusing", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "at-source-bound-hash");
    await t.run(async (ctx) => {
      const now = Date.now();
      const existing = await ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect();
      for (let i = existing.length; i < MAX_BRIEF_SOURCE_ROWS; i += 1) {
        const content = `Filler context document ${i}.`;
        await ctx.db.insert("generationSources", {
          projectId,
          generationId,
          kind: "project_document",
          label: `background:filler-${i}.txt`,
          content,
          contentHash: `filler-hash-${i}`,
          truncated: false,
          originalLength: content.length,
          capturedAt: now,
        });
      }
    });

    const sources = await t.query(internal.generations.getGenerationSourcesForBrief, {
      generationId,
    });
    expect(sources).toHaveLength(MAX_BRIEF_SOURCE_ROWS);
  });

  it("stamps a returning key `added` against a baseline that still carries its removed marker", async () => {
    // The I/O Matrix row verbatim: the *previous version* holds K's `removed`
    // marker and the new candidates include K. The repeated-derivation case
    // above reaches v4 from a v3 the marker had already vanished from, so it
    // cannot catch a regression that diffed against markers again.
    const t = convexTest(schema, modules);
    const { projectId, generationId, source, derive } = await derivationFixture(t, "returning-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const returning = candidateEntry(source, "glossaryTerm", DROPPED_QUOTE);

    const v1 = await derive([kept]);
    // Hand-seed K's marker onto v1 so the baseline read *does* see one.
    await t.run((ctx) =>
      ctx.db.insert("generationBriefEntries", {
        briefId: v1,
        projectId,
        group: returning.group,
        text: returning.text,
        sourceId: returning.sourceId,
        sourceContentHash: returning.sourceContentHash,
        startOffset: returning.startOffset,
        endOffset: returning.endOffset,
        exactExcerpt: returning.exactExcerpt,
        change: "removed",
        createdAt: Date.now(),
      })
    );

    const v2 = await derive([kept, returning]);
    const v2Entries = await entriesOf(t, v2);
    expect(v2Entries).toHaveLength(2);
    const returned = v2Entries.find((entry) => entry.group === "glossaryTerm");
    expect(returned?.change).toBe("added");
    expect(v2Entries.filter((entry) => entry.change === "removed")).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(v2);
  });

  it("treats a previous version whose rows are all filtered out as a previous version that exists", async () => {
    // Design Notes: `undefined` means "first version ever". A baseline whose
    // every row is history (markers) or a Self-check artifact (questions) is
    // still a previous version, so new entries stamp `added`, not `undefined`.
    const t = convexTest(schema, modules);
    const { projectId, source, derive } = await derivationFixture(t, "empty-baseline-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });

    for (const shape of ["markers-only", "questions-only"] as const) {
      const baselineId = await t.run(async (ctx) => {
        const now = Date.now();
        const briefId = await ctx.db.insert("generationBriefs", {
          projectId,
          inputsHash: `baseline-${shape}`,
          generationId: (await ctx.db.query("generations").first())!._id,
          version: 1,
          origin: "derived",
          storylineText: `A previous version holding only ${shape} rows.`,
          createdAt: now,
        });
        await ctx.db.insert("generationBriefEntries", {
          briefId,
          projectId,
          group: shape === "markers-only" ? "glossaryTerm" : "storylineQuestion",
          text: "A row the diff baseline filters out.",
          sourceId: source._id,
          sourceContentHash: source.contentHash,
          startOffset: 0,
          endOffset: 1,
          exactExcerpt: source.content.slice(0, 1),
          ...(shape === "markers-only"
            ? { change: "removed" as const }
            : { question: { questionText: "Unresolved?" } }),
          createdAt: now,
        });
        return briefId;
      });
      expect(await entriesOf(t, baselineId)).toHaveLength(1);

      const next = await derive([kept]);
      const nextEntries = await entriesOf(t, next);
      expect(nextEntries).toHaveLength(1);
      expect(nextEntries[0].change).toBe("added");
    }
  });

  it("omits a Brief whose live rows alone are under the bound but whose markers push it over", async () => {
    // 480 live + 30 removed = 510 rows. The probe is over-bound *before* the
    // change/group filter, so the Brief is omitted rather than rendered as
    // 480 of 510 rows — never a prefix.
    const t = convexTest(schema, modules);
    const { projectId, generationId, source } = await derivationFixture(t, "markers-hash", LONG_CONTENT);
    const briefId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "markers-hash",
        version: 1,
        origin: "derived",
        storylineText: "480 live rows and 30 historical markers.",
        createdAt: Date.now(),
      })
    );
    await seedEntryRows(t, { briefId, projectId, source, count: 480 });
    await seedEntryRows(t, {
      briefId,
      projectId,
      source,
      count: 30,
      startAt: 480,
      change: "removed",
    });
    await t.run((ctx) => ctx.db.patch(generationId, { briefId }));
    expect(await entriesOf(t, briefId)).toHaveLength(510);

    const omitted = await readBothConsumers(t, generationId);
    expect(omitted).toEqual({ rendered: "", brief: null });
  });

  /** The project's newest Brief, as the fence sees it. */
  async function newestBriefOf(t: TestApp, projectId: Id<"projects">) {
    return await t.run((ctx) =>
      ctx.db
        .query("generationBriefs")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .order("desc")
        .first()
    );
  }

  it("re-reads and re-publishes when a writer edit lands between pin and publish", async () => {
    const t = convexTest(schema, modules);
    const { projectId, generationId, source, derive } = await derivationFixture(t, "concurrent-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const dropped = candidateEntry(source, "glossaryTerm", DROPPED_QUOTE);
    const v1 = await derive([kept, dropped]);
    const droppedRow = (await entriesOf(t, v1)).find((row) => row.group === "glossaryTerm")!;
    const editedText = "The writer's corrected glossary term.";

    // The baseline is pinned and read; then, just before the first publish,
    // the writer saves an edit — a newer version the pin never saw.
    const asWriter = t.withIdentity({ subject: "brief-writer" });
    const observed: {
      editedId?: Id<"generationBriefs">;
      tablesBeforeRetry?: Awaited<ReturnType<typeof briefTables>>;
    } = {};
    const { ctx, calls } = briefPublishCtx(t, async (call, all) => {
      if (call.name !== PERSIST_MUTATION) return;
      const attempt = all.filter((c) => c.name === PERSIST_MUTATION).length;
      if (attempt === 1) {
        observed.editedId = (await asWriter.mutation(anyApi.briefs.saveEntryEdit, {
          projectId,
          briefId: v1,
          expectedBriefVersion: 1,
          entryId: droppedRow._id,
          editedText,
        })) as Id<"generationBriefs">;
      } else if (attempt === 2) {
        observed.tablesBeforeRetry = await briefTables(t);
      }
    });

    const finalId = await derive([kept], ctx);

    const { editedId, tablesBeforeRetry } = observed;
    expect(editedId).toBeDefined();
    const persisted = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(persisted).toHaveLength(2);
    expect(persisted[0]).toMatchObject({ result: null, args: { baselineBriefId: v1 } });
    expect(persisted[1]).toMatchObject({ result: finalId, args: { baselineBriefId: editedId } });
    // The stale attempt wrote nothing: before the retry, the tables held v1
    // and the writer's edit only.
    expect(tablesBeforeRetry?.briefs.map((row) => row._id)).toEqual([v1, editedId]);
    expect(
      tablesBeforeRetry?.entries.filter((row) => row.briefId !== v1 && row.briefId !== editedId)
    ).toEqual([]);

    // The published version diffs against the edited version: the removal
    // marker carries the writer's text, not v1's.
    const finalRows = await entriesOf(t, finalId);
    expect(finalRows).toHaveLength(2);
    expect(finalRows.find((row) => row.group === "claimExclusion")?.change).toBe("unchanged");
    expect(finalRows.find((row) => row.group === "glossaryTerm")).toMatchObject({
      change: "removed",
      text: editedText,
    });
    expect((await newestBriefOf(t, projectId))?._id).toBe(finalId);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(finalId);
  });

  it("gives up after BRIEF_PUBLISH_ATTEMPTS lost fences, leaving no version from the derivation", async () => {
    const t = convexTest(schema, modules);
    const { projectId, generationId, source, derive } = await derivationFixture(t, "moving-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const v1 = await derive([kept]);

    // Every publish attempt loses its fence to a writer edit saved first.
    const asWriter = t.withIdentity({ subject: "brief-writer" });
    let edits = 0;
    const { ctx, calls } = briefPublishCtx(t, async (call) => {
      if (call.name !== PERSIST_MUTATION) return;
      const latest = (await newestBriefOf(t, projectId))!;
      edits += 1;
      await asWriter.mutation(anyApi.briefs.saveEntryEdit, {
        projectId,
        briefId: latest._id,
        expectedBriefVersion: latest.version,
        editedStorylineText: `Writer edit ${edits}.`,
      });
    });

    await expect(derive([kept], ctx)).rejects.toThrow(
      `Generation Brief for generation ${generationId} not published: the project's newest Brief changed during each of ${BRIEF_PUBLISH_ATTEMPTS} attempts`
    );

    // Exactly BRIEF_PUBLISH_ATTEMPTS publish calls, each one completed and
    // returned null (a lost fence), each after its own fresh pin.
    const persisted = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(persisted.map((call) => ("result" in call ? call.result : "threw"))).toEqual(
      Array.from({ length: BRIEF_PUBLISH_ATTEMPTS }, () => null)
    );
    const pins = calls.filter((call) => call.name === "generations:getBriefDiffBaselineId");
    expect(pins).toHaveLength(BRIEF_PUBLISH_ATTEMPTS);
    expect(new Set(persisted.map((call) => call.args.baselineBriefId)).size).toBe(
      BRIEF_PUBLISH_ATTEMPTS
    );
    // v1 and the writer's edits, nothing else; the generation keeps v1.
    const { briefs } = await briefTables(t);
    expect(briefs.map((row) => row.origin)).toEqual([
      "derived",
      ...Array.from({ length: BRIEF_PUBLISH_ATTEMPTS }, () => "edited"),
    ]);
    expect(briefs[0]._id).toBe(v1);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(v1);
  });

  it("writes nothing when a baseline page read fails part-way, and the next derivation publishes normally", async () => {
    const t = convexTest(schema, modules);
    const { generationId, source, derive } = await derivationFixture(t, "interrupted-hash", LONG_CONTENT);
    const glossary = (offset: number) => ({
      group: "glossaryTerm" as const,
      text: `term-${offset}`,
      sourceId: source._id,
      sourceContentHash: source.contentHash,
      startOffset: offset,
      endOffset: offset + 1,
      exactExcerpt: source.content.slice(offset, offset + 1),
    });
    const offsets = (count: number) => Array.from({ length: count }, (_unused, i) => glossary(i));
    // A 520-row baseline takes two pages.
    const v1 = await derive(offsets(MAX_BRIEF_ENTRY_ROWS + 20));
    const before = await briefTables(t);

    // The first page is accepted; the second read fails.
    const failing = briefPublishCtx(t, async (call, all) => {
      if (call.name === PAGE_QUERY && all.filter((c) => c.name === PAGE_QUERY).length === 2) {
        throw new Error("baseline page read failed");
      }
    });
    await expect(derive(offsets(MAX_BRIEF_ENTRY_ROWS + 19), failing.ctx)).rejects.toThrow(
      "baseline page read failed"
    );
    expect(failing.calls.some((call) => call.name === PERSIST_MUTATION)).toBe(false);
    expect(await briefTables(t)).toEqual(before);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(v1);

    // Nothing is left half-done: the next derivation, with no injection at
    // all, reads the whole baseline and publishes, including the marker for
    // the second page's row.
    const clean = briefPublishCtx(t);
    const next = await derive(offsets(MAX_BRIEF_ENTRY_ROWS + 19), clean.ctx);
    expect(next).toEqual(expect.any(String));
    expect(next).not.toBe(v1);
    const cleanPublishes = clean.calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(cleanPublishes.map((call) => call.result)).toEqual([next]);
    const nextRows = await entriesOf(t, next);
    expect(nextRows.filter((row) => row.change === "unchanged")).toHaveLength(MAX_BRIEF_ENTRY_ROWS + 19);
    expect(nextRows.filter((row) => row.change === "removed").map((row) => row.text)).toEqual([
      `term-${MAX_BRIEF_ENTRY_ROWS + 19}`,
    ]);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(next);
  });

  it("marks a retained baseline row removed when every candidate sharing its key fails re-validation", async () => {
    const t = convexTest(schema, modules);
    const { generationId, source, derive } = await derivationFixture(t, "revalidation-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const dropped = candidateEntry(source, "glossaryTerm", DROPPED_QUOTE);
    const v1 = await derive([kept, dropped]);
    const v1Glossary = (await entriesOf(t, v1)).find((row) => row.group === "glossaryTerm")!;

    // Same diff key as the v1 glossary row, so the action sends only a
    // reference for it, but its excerpt is not the cited bytes, so the
    // mutation's re-validation drops it.
    const failing = { ...dropped, text: "A fresh glossary text.", exactExcerpt: "not the cited bytes" };
    const { ctx, calls } = briefPublishCtx(t);
    const v2 = await derive([kept, failing], ctx);

    const [publish] = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(publish.args.baselineRemoved).toEqual([]);
    expect(publish.args.baselineRetained).toEqual(
      expect.arrayContaining([{ entryId: v1Glossary._id, candidateIndex: 1 }])
    );
    expect(publish.args.baselineRetained).toHaveLength(2);

    // The marker is read back from v1 in full; the failed candidate is counted
    // and never written.
    expect((await t.run((ctx) => ctx.db.get(v2)))?.droppedEntryCount).toBe(1);
    const v2Rows = await entriesOf(t, v2);
    expect(v2Rows).toHaveLength(2);
    expect(v2Rows.find((row) => row.group === "claimExclusion")?.change).toBe("unchanged");
    expect(v2Rows.find((row) => row.group === "glossaryTerm")).toMatchObject({
      change: "removed",
      text: v1Glossary.text,
      sourceId: v1Glossary.sourceId,
      sourceContentHash: v1Glossary.sourceContentHash,
      startOffset: v1Glossary.startOffset,
      endOffset: v1Glossary.endOffset,
      exactExcerpt: v1Glossary.exactExcerpt,
    });
    expect(v2Rows.some((row) => row.text === failing.text)).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(v2);
  });

  it("aborts the whole publish with INVALID_STATE when a retained reference is not what it claims", async () => {
    const t = convexTest(schema, modules);
    const { projectId, generationId, source, derive } = await derivationFixture(t, "reference-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const dropped = candidateEntry(source, "glossaryTerm", DROPPED_QUOTE);
    const v1 = await derive([kept, dropped]);
    const v2 = await derive([kept]); // kept unchanged + a removed marker for `dropped`
    const v1Kept = (await entriesOf(t, v1)).find((row) => row.group === "claimExclusion")!;
    const v2Rows = await entriesOf(t, v2);
    const v2Kept = v2Rows.find((row) => row.group === "claimExclusion")!;
    const v2Marker = v2Rows.find((row) => row.change === "removed")!;
    // Each candidate fails re-validation, so its reference is read back.
    const broken = (entry: typeof kept) => ({ ...entry, exactExcerpt: "not the cited bytes" });

    const cases = [
      { name: "out-of-range index", entries: [kept], entryId: v2Kept._id, candidateIndex: 1 },
      { name: "row of an older version", entries: [broken(kept)], entryId: v1Kept._id, candidateIndex: 0 },
      { name: "historical marker", entries: [broken(dropped)], entryId: v2Marker._id, candidateIndex: 0 },
      { name: "different key", entries: [broken(dropped)], entryId: v2Kept._id, candidateIndex: 0 },
    ];
    const before = await briefTables(t);
    for (const { name, entries, entryId, candidateIndex } of cases) {
      const failure = await domainErrorOf(() =>
        t.mutation(internal.generations.persistDerivedBrief, {
          projectId,
          generationId,
          inputsHash: "reference-hash",
          origin: "derived",
          storylineText: `Publish with a bad reference: ${name}.`,
          entries,
          baselineBriefId: v2,
          baselineRetained: [{ entryId, candidateIndex }],
          baselineRemoved: [],
        })
      );
      expect({ name, code: failure.code }).toEqual({ name, code: "INVALID_STATE" });
    }
    expect(await briefTables(t)).toEqual(before);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(v2);
  });

  /** A baseline of `MAX_BRIEF_ENTRY_ROWS + 1` rows whose first and last rows
   * share one diff key with different payloads, so they are read on different
   * accepted pages; every row in between has its own key. */
  async function duplicateKeyBaseline(t: TestApp) {
    const { projectId, generationId, source } = await derivationFixture(
      t,
      "duplicate-key-hash",
      LONG_CONTENT
    );
    const DUPLICATE_OFFSET = 700;
    const cite = (offset: number) => ({
      sourceId: source._id,
      sourceContentHash: source.contentHash,
      startOffset: offset,
      endOffset: offset + 1,
      exactExcerpt: source.content.slice(offset, offset + 1),
    });
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const briefId = await ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "duplicate-key-previous-hash",
        version: 1,
        origin: "derived",
        storylineText: "A previous version with one duplicated diff key.",
        createdAt: now,
      });
      const firstId = await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId,
        group: "confidenceMap",
        text: "duplicate key, first row",
        confidence: "unresolved",
        ...cite(DUPLICATE_OFFSET),
        createdAt: now,
      });
      for (let i = 1; i < MAX_BRIEF_ENTRY_ROWS; i += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId,
          projectId,
          group: "glossaryTerm",
          text: `term-${i}`,
          ...cite(i),
          createdAt: now,
        });
      }
      const lastId = await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId,
        group: "confidenceMap",
        text: "duplicate key, last row",
        confidence: "unreliable",
        ...cite(DUPLICATE_OFFSET),
        createdAt: now,
      });
      return { briefId, firstId, lastId };
    });
    // Candidates re-deriving every uniquely keyed row in between.
    const middle = Array.from({ length: MAX_BRIEF_ENTRY_ROWS - 1 }, (_unused, k) => ({
      group: "glossaryTerm" as const,
      text: `term-${k + 1}`,
      ...cite(k + 1),
    }));
    const duplicateKey = {
      group: "confidenceMap" as const,
      text: "a fresh fact on the duplicated key",
      confidence: "unresolved" as const,
      ...cite(DUPLICATE_OFFSET),
    };
    const publish = (entries: Array<typeof middle[number] | typeof duplicateKey>, ctx: BriefPublishCtx) =>
      publishDerivedBrief(ctx, {
        projectId,
        generationId,
        inputsHash: "duplicate-key-hash",
        origin: "derived",
        storylineText: "Re-derived against a duplicated diff key.",
        entries,
      });
    return { ...ids, middle, duplicateKey, publish };
  }

  type RecordedPage = BriefStageCall & {
    result: { pageStatus: string | null; entries: Array<{ entryId: Id<"generationBriefEntries"> }> };
  };

  it("keeps the last baseline row for a diff key duplicated across pages, when the key is dropped and when its candidates all fail re-validation", async () => {
    // Dropped key: its one removal marker carries the later page's row.
    {
      const t = convexTest(schema, modules);
      const baseline = await duplicateKeyBaseline(t);
      const { ctx, calls } = briefPublishCtx(t);
      const nextId = await baseline.publish(baseline.middle, ctx);

      const pages = calls.filter((call) => call.name === PAGE_QUERY) as RecordedPage[];
      expect(pages.map((page) => page.result.pageStatus)).toEqual([null, null]);
      expect(pages[0].result.entries.map((entry) => entry.entryId)).toContain(baseline.firstId);
      expect(pages[1].result.entries.map((entry) => entry.entryId)).toEqual([baseline.lastId]);
      const [persist] = calls.filter((call) => call.name === PERSIST_MUTATION);
      expect(persist.args.baselineRemoved).toEqual([
        expect.objectContaining({ text: "duplicate key, last row", confidence: "unreliable" }),
      ]);
      expect(persist.args.baselineRetained).toHaveLength(MAX_BRIEF_ENTRY_ROWS - 1);

      const rows = await entriesOf(t, nextId);
      expect(rows.filter((row) => row.change === "removed")).toEqual([
        expect.objectContaining({
          group: "confidenceMap",
          text: "duplicate key, last row",
          confidence: "unreliable",
          startOffset: 700,
        }),
      ]);
      expect(rows.filter((row) => row.change === "unchanged")).toHaveLength(MAX_BRIEF_ENTRY_ROWS - 1);
      expect(rows).toHaveLength(MAX_BRIEF_ENTRY_ROWS);
    }

    // Every candidate sharing the key fails re-validation: the reference names
    // the later page's row, so the marker read back is that row.
    {
      const t = convexTest(schema, modules);
      const baseline = await duplicateKeyBaseline(t);
      const failing = { ...baseline.duplicateKey, exactExcerpt: "not the cited bytes" };
      const { ctx, calls } = briefPublishCtx(t);
      const nextId = await baseline.publish(
        [failing, { ...failing, text: "a second failing candidate" }, ...baseline.middle],
        ctx
      );

      const [persist] = calls.filter((call) => call.name === PERSIST_MUTATION);
      expect(persist.args.baselineRemoved).toEqual([]);
      expect(persist.args.baselineRetained).toContainEqual({
        entryId: baseline.lastId,
        candidateIndex: 0,
      });
      expect(persist.args.baselineRetained).toHaveLength(MAX_BRIEF_ENTRY_ROWS);
      expect((await t.run((ctx) => ctx.db.get(nextId)))?.droppedEntryCount).toBe(2);

      const rows = await entriesOf(t, nextId);
      expect(rows.filter((row) => row.change === "removed")).toEqual([
        expect.objectContaining({
          group: "confidenceMap",
          text: "duplicate key, last row",
          confidence: "unreliable",
          startOffset: 700,
        }),
      ]);
      expect(rows.some((row) => row.text === failing.text)).toBe(false);
      expect(rows.filter((row) => row.change === "unchanged")).toHaveLength(MAX_BRIEF_ENTRY_ROWS - 1);
      expect(rows).toHaveLength(MAX_BRIEF_ENTRY_ROWS);
    }
  });

  it("stamps the first validated duplicate candidate unchanged and later ones added, even when an earlier candidate sharing the key fails re-validation", async () => {
    const t = convexTest(schema, modules);
    const { generationId, source, derive } = await derivationFixture(t, "duplicate-candidate-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const term = candidateEntry(source, "glossaryTerm", DROPPED_QUOTE);
    const v1 = await derive([kept, term]);
    const v1Term = (await entriesOf(t, v1)).find((row) => row.group === "glossaryTerm")!;

    const { ctx, calls } = briefPublishCtx(t);
    const v2 = await derive(
      [
        kept,
        { ...term, text: "fails re-validation", exactExcerpt: "not the cited bytes" },
        { ...term, text: "first valid duplicate" },
        { ...term, text: "second valid duplicate" },
      ],
      ctx
    );

    const [persist] = calls.filter((call) => call.name === PERSIST_MUTATION);
    // The reference names the first candidate with the key, valid or not.
    expect(persist.args.baselineRetained).toContainEqual({ entryId: v1Term._id, candidateIndex: 1 });
    expect(persist.args.baselineRemoved).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(v2)))?.droppedEntryCount).toBe(1);
    // The key is matched once, by the first candidate that validates; no marker.
    expect((await entriesOf(t, v2)).map((row) => [row.text, row.change])).toEqual([
      [kept.text, "unchanged"],
      ["first valid duplicate", "unchanged"],
      ["second valid duplicate", "added"],
    ]);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(v2);
  });

  it("stops without publishing when a one-row page still needs a split or an accepted page makes no progress", async () => {
    const t = convexTest(schema, modules);
    const { generationId, source, derive } = await derivationFixture(t, "page-error-hash");
    const kept = candidateEntry(source, "claimExclusion", KEPT_QUOTE, { reason: "business_risk" });
    const v1 = await derive([kept]);
    const before = await briefTables(t);

    /** The real publish ctx, except that every page query answers `page`.
     * Neither condition can be produced by real rows: a single document is
     * below the page byte budget, and convex-test cursors always advance. */
    const withPages = (page: (args: { cursor: string | null; numItems: number }) => unknown) => {
      const real = briefPublishCtx(t);
      const pageCalls: Array<{ cursor: string | null; numItems: number }> = [];
      const runQuery = real.ctx.runQuery as (reference: unknown, args?: unknown) => Promise<unknown>;
      const ctx = {
        runQuery: (reference, ...args) => {
          if (getFunctionName(reference) !== PAGE_QUERY) return runQuery(reference, args[0]);
          const pageArgs = args[0] as { cursor: string | null; numItems: number };
          pageCalls.push(pageArgs);
          return Promise.resolve(page(pageArgs));
        },
        runMutation: real.ctx.runMutation,
      } as BriefPublishCtx;
      return { ctx, pageCalls, calls: real.calls };
    };

    // A one-row page that still reports SplitRequired: halved at the same
    // cursor down to one row, then stopped.
    const split = withPages(() => ({
      entries: [],
      readCount: 1,
      isDone: false,
      continueCursor: "split-cursor",
      pageStatus: "SplitRequired",
    }));
    await expect(derive([kept], split.ctx)).rejects.toThrow(
      `Generation Brief ${v1} diff baseline: one row exceeds the ${BRIEF_BASELINE_PAGE_BYTES}-byte page budget`
    );
    const halvings: number[] = [];
    for (let rows = MAX_BRIEF_ENTRY_ROWS; ; rows = Math.max(1, Math.floor(rows / 2))) {
      halvings.push(rows);
      if (rows === 1) break;
    }
    expect(split.pageCalls.map((call) => call.numItems)).toEqual(halvings);
    expect(split.pageCalls.every((call) => call.cursor === null)).toBe(true);
    expect(split.calls.some((call) => call.name === PERSIST_MUTATION)).toBe(false);

    // An accepted, unfinished page whose continue cursor equals the cursor it
    // was read from.
    const stuck = withPages(() => ({
      entries: [],
      readCount: 0,
      isDone: false,
      continueCursor: "stuck-cursor",
      pageStatus: null,
    }));
    await expect(derive([kept], stuck.ctx)).rejects.toThrow(
      `Generation Brief ${v1} diff baseline: a page made no progress`
    );
    expect(stuck.pageCalls.map((call) => call.cursor)).toEqual([null, "stuck-cursor"]);
    expect(stuck.calls.some((call) => call.name === PERSIST_MUTATION)).toBe(false);

    expect(await briefTables(t)).toEqual(before);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(v1);
  });

  it("re-reads a byte-heavy baseline page smaller after SplitRequired and diffs every live row", async () => {
    const t = convexTest(schema, modules);
    const { projectId, generationId, source } = await derivationFixture(t, "heavy-hash", LONG_CONTENT);
    const ROWS = MAX_BRIEF_ENTRY_ROWS + 20;
    // Large enough that a full row-count page (500 rows) reads past the page
    // byte budget, small enough that half a page does not.
    const TEXT_BYTES = Math.ceil(BRIEF_BASELINE_PAGE_BYTES / 450);
    expect(MAX_BRIEF_ENTRY_ROWS * TEXT_BYTES).toBeGreaterThan(BRIEF_BASELINE_PAGE_BYTES);
    const heavyText = (i: number) => `heavy-${String(i).padStart(4, "0")}-${"x".repeat(TEXT_BYTES)}`;
    const baselineId = await t.run(async (ctx) => {
      const now = Date.now();
      const briefId = await ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "heavy-previous-hash",
        version: 1,
        origin: "derived",
        storylineText: "A byte-heavy previous version.",
        createdAt: now,
      });
      for (let i = 0; i < ROWS; i += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId,
          projectId,
          group: "glossaryTerm",
          text: heavyText(i),
          sourceId: source._id,
          sourceContentHash: source.contentHash,
          startOffset: i,
          endOffset: i + 1,
          exactExcerpt: source.content.slice(i, i + 1),
          createdAt: now,
        });
      }
      return briefId;
    });

    // Re-derive every row but the last (on the final page), with small text.
    const candidates = Array.from({ length: ROWS - 1 }, (_unused, i) => ({
      group: "glossaryTerm" as const,
      text: `term-${i}`,
      sourceId: source._id,
      sourceContentHash: source.contentHash,
      startOffset: i,
      endOffset: i + 1,
      exactExcerpt: source.content.slice(i, i + 1),
    }));
    const { ctx, calls } = briefPublishCtx(t);
    const nextId = await publishDerivedBrief(ctx, {
      projectId,
      generationId,
      inputsHash: "heavy-hash",
      origin: "derived",
      storylineText: "Re-derived against a byte-heavy baseline.",
      entries: candidates,
    });

    type PageCall = BriefStageCall & {
      args: { cursor: string | null; numItems: number };
      result: {
        pageStatus: string | null;
        readCount: number;
        isDone: boolean;
        entries: Array<{ entryId: Id<"generationBriefEntries"> }>;
      };
    };
    const pages = calls.filter((call) => call.name === PAGE_QUERY) as PageCall[];
    const discarded = pages.filter((page) => page.result.pageStatus === "SplitRequired");
    const accepted = pages.filter((page) => page.result.pageStatus !== "SplitRequired");
    // Both kinds are counted, and every page is one or the other.
    expect(discarded.length).toBeGreaterThanOrEqual(1);
    expect(accepted.length).toBeGreaterThanOrEqual(2);
    expect(accepted.length + discarded.length).toBe(pages.length);
    // Each discarded page is re-requested from the same cursor with fewer rows.
    for (const page of discarded) {
      const retry = pages[pages.indexOf(page) + 1];
      expect(retry.args.cursor).toBe(page.args.cursor);
      expect(retry.args.numItems).toBeLessThan(page.args.numItems);
    }
    // Accepted pages cover every live row exactly once, by id, and end on
    // isDone.
    expect(accepted.reduce((sum, page) => sum + page.result.readCount, 0)).toBe(ROWS);
    expect(accepted.at(-1)?.result.isDone).toBe(true);
    const baselineIds = (await entriesOf(t, baselineId)).map((row) => row._id);
    expect(
      accepted.flatMap((page) => page.result.entries.map((entry) => entry.entryId)).sort()
    ).toEqual([...baselineIds].sort());
    const persisted = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].args.baselineBriefId).toBe(baselineId);
    expect(persisted[0].args.baselineRetained).toHaveLength(ROWS - 1);
    expect(persisted[0].args.baselineRemoved).toEqual([
      expect.objectContaining({ text: heavyText(ROWS - 1), startOffset: ROWS - 1 }),
    ]);

    const nextRows = await entriesOf(t, nextId);
    expect(nextRows.filter((row) => row.change === "unchanged")).toHaveLength(ROWS - 1);
    expect(nextRows.filter((row) => row.change === "removed").map((row) => row.text)).toEqual([
      heavyText(ROWS - 1),
    ]);
    expect(nextRows).toHaveLength(ROWS);
  });

  it("sends no retained baseline text, so a large retained baseline publishes under the argument limit", async () => {
    // P1 transport regression (repair-plan review). Writer edits can enlarge
    // live entries below the 500-row guard (`briefs.saveEntryEdit` accepts any
    // non-empty text) and a writer Storyline sits outside the model-output
    // cap. Seeded directly: about 15.6 MiB of live text over 20 keys, each row
    // under Convex's 1 MiB document limit, plus one key no candidate reuses.
    // The fresh candidates reuse every large key with short text, so the new
    // version is small, and its publish argument must be too.
    const MiB = 1024 * 1024;
    const ARGUMENT_LIMIT = 16 * MiB;
    const RETAINED_KEYS = 20;
    const RETAINED_TEXT_BYTES = 800 * 1024;
    const STORYLINE_BYTES = Math.round(0.6 * MiB);
    /** Bytes of a value as Convex serializes a function argument
     * (`actions_impl.ts`: `convexToJson`), UTF-8 encoded. */
    const utf8Bytes = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(convexToJson(value as Value))).length;

    const t = convexTest(schema, modules);
    const { projectId, generationId, source } = await derivationFixture(t, "transport-hash", LONG_CONTENT);
    const cite = (offset: number) => ({
      sourceId: source._id,
      sourceContentHash: source.contentHash,
      startOffset: offset,
      endOffset: offset + 1,
      exactExcerpt: source.content.slice(offset, offset + 1),
    });
    const baselineId = await t.run((ctx) =>
      ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "transport-previous-hash",
        version: 1,
        origin: "edited",
        storylineText: "A writer-edited version with large live entries.",
        createdAt: Date.now(),
      })
    );
    for (let i = 0; i < RETAINED_KEYS; i += 1) {
      await t.run((ctx) =>
        ctx.db.insert("generationBriefEntries", {
          briefId: baselineId,
          projectId,
          group: "claimExclusion",
          text: `retained-${i}-${"x".repeat(RETAINED_TEXT_BYTES)}`,
          reason: "business_risk",
          ...cite(i),
          createdAt: Date.now(),
        })
      );
    }
    const droppedPayload = {
      group: "confidenceMap" as const,
      text: "A dropped fact, carried whole into its marker.",
      confidence: "partial" as const,
      ...cite(RETAINED_KEYS),
    };
    await t.run((ctx) =>
      ctx.db.insert("generationBriefEntries", {
        briefId: baselineId,
        projectId,
        ...droppedPayload,
        createdAt: Date.now(),
      })
    );
    const baselineRows = await entriesOf(t, baselineId);
    expect(baselineRows).toHaveLength(RETAINED_KEYS + 1);
    for (const row of baselineRows) expect(utf8Bytes(row)).toBeLessThan(MiB);
    const liveTextBytes = baselineRows.reduce(
      (sum, row) => sum + new TextEncoder().encode(row.text).length,
      0
    );
    expect(liveTextBytes / MiB).toBeCloseTo(15.6, 1);
    const storylineText = `Writer Storyline ${"s".repeat(STORYLINE_BYTES)}`;
    // The counterexample shape: every live row's text plus this Storyline
    // cannot fit one argument.
    expect(liveTextBytes + STORYLINE_BYTES).toBeGreaterThan(ARGUMENT_LIMIT);

    const candidates = Array.from({ length: RETAINED_KEYS }, (_unused, i) => ({
      group: "claimExclusion" as const,
      text: `fresh-${i}`,
      reason: "business_risk" as const,
      ...cite(i),
    }));
    const { ctx, calls } = briefPublishCtx(t);
    const nextId = await publishDerivedBrief(ctx, {
      projectId,
      generationId,
      inputsHash: "transport-hash",
      origin: "writer",
      storylineText,
      entries: candidates,
    });

    // Every live baseline row was enumerated: discarded SplitRequired pages
    // and accepted pages are both counted, and the accepted pages read every
    // row and end on isDone.
    type TransportPageCall = BriefStageCall & {
      result: {
        pageStatus: string | null;
        readCount: number;
        isDone: boolean;
        entries: Array<{ entryId?: Id<"generationBriefEntries"> }>;
      };
    };
    const pages = calls.filter((call) => call.name === PAGE_QUERY) as TransportPageCall[];
    const discarded = pages.filter((page) => page.result.pageStatus === "SplitRequired");
    const accepted = pages.filter((page) => page.result.pageStatus !== "SplitRequired");
    expect(discarded.length).toBeGreaterThanOrEqual(1);
    expect(accepted.length + discarded.length).toBe(pages.length);
    expect(accepted.reduce((sum, page) => sum + page.result.readCount, 0)).toBe(RETAINED_KEYS + 1);
    expect(accepted.at(-1)?.result.isDone).toBe(true);

    // The recorded outgoing argument, measured the way Convex serializes it.
    const persisted = calls.filter((call) => call.name === PERSIST_MUTATION);
    expect(persisted).toHaveLength(1);
    const argument = persisted[0].args;
    const argumentBytes = utf8Bytes(argument);
    expect(argumentBytes).toBeLessThan(ARGUMENT_LIMIT);

    // Each live row reached the comparison exactly once, by id.
    const acceptedIds = accepted.flatMap((page) => page.result.entries.map((entry) => entry.entryId));
    expect([...acceptedIds].sort()).toEqual(baselineRows.map((row) => row._id).sort());

    // Within the Design Notes bound: the new version's written documents, plus
    // candidates re-validation dropped (none here), plus the compact retained
    // references. Old text for a retained key travels nowhere.
    const retained = argument.baselineRetained as Array<Record<string, unknown>>;
    const removed = argument.baselineRemoved as Array<Record<string, unknown>>;
    expect(retained).toHaveLength(RETAINED_KEYS);
    expect(retained.length).toBeLessThanOrEqual(candidates.length);
    for (const reference of retained) {
      expect(Object.keys(reference).sort()).toEqual(["candidateIndex", "entryId"]);
    }
    expect(removed).toEqual([droppedPayload]);
    const published = await t.run((ctx) => ctx.db.get(nextId));
    const nextRows = await entriesOf(t, nextId);
    expect(published?.droppedEntryCount).toBe(0);
    const writtenBytes =
      utf8Bytes(published) + nextRows.reduce((sum, row) => sum + utf8Bytes(row), 0);
    expect(argumentBytes).toBeLessThanOrEqual(writtenBytes + utf8Bytes(retained));

    // The published version: every reused key `unchanged` with the fresh
    // text, and a full-payload `removed` marker for the dropped key.
    expect(nextRows).toHaveLength(RETAINED_KEYS + 1);
    const byOffset = (a: { startOffset: number }, b: { startOffset: number }) =>
      a.startOffset - b.startOffset;
    expect(
      nextRows
        .filter((row) => row.change === "unchanged")
        .sort(byOffset)
        .map((row) => ({ group: row.group, text: row.text, reason: row.reason, ...cite(row.startOffset) }))
    ).toEqual(candidates);
    const markers = nextRows.filter((row) => row.change === "removed");
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject(droppedPayload);
    expect(markers[0].reason).toBeUndefined();
    expect(nextRows.some((row) => row.text.startsWith("retained-"))).toBe(false);
    expect(published?.storylineText === storylineText).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.briefId).toBe(nextId);
  });

  // ── Over-bound newest Brief: recovery on the next derivation (attempt 2) ──
  //
  // Driven only through the real stage (`generateReport`) and `t.run`, so the
  // same case runs on either shape of `persistDerivedBrief`. Every Brief below
  // is produced by the derivation itself from a stubbed structured response;
  // only the one `storylineQuestion` row is inserted directly, standing in for
  // the ordered chain's Self-check (`completeOrderedSectionRun`).

  const factPad = (i: number) => String(i).padStart(4, "0");
  /** A verbatim, uniquely-locatable quote for fact `i`. */
  const factQuote = (i: number) => `Fact ${factPad(i)} holds.`;
  /** The entry text for fact `i`; distinct from its quote so a render check
   * cannot pass on source text alone. */
  const factText = (i: number) => `Finding ${factPad(i)}`;
  const FACT_TRANSCRIPT = Array.from({ length: 1000 }, (_unused, i) => factQuote(i)).join(" ");
  const factRange = (from: number, to: number) =>
    Array.from({ length: to - from }, (_unused, i) => from + i);

  /** The model proposes exactly these facts as Confidence Map entries. */
  function mockFactBrief(facts: number[]) {
    network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
      const name = params.tool_choice?.name;
      const input =
        name === "submit_transcript_analysis"
          ? analysisOutput
          : name === "submit_generation_brief"
            ? {
                storyline: `A storyline over ${facts.length} facts.`,
                storylineClaims: [],
                claimExclusions: [],
                confidenceMap: facts.map((i) => ({
                  text: factText(i),
                  quote: factQuote(i),
                  confidence: "established",
                })),
                glossaryTerms: [],
              }
            : { entries: [] };
      return {
        content: name
          ? [{ type: "tool_use", id: "tool-1", name, input }]
          : [{ type: "text", text: FACT_TRANSCRIPT }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });
  }

  /** A reserved generation whose frozen transcript is byte-identical every
   * time (so its entries can key-match as `unchanged`), plus a background note
   * whose hash changes the Brief's inputsHash (the changed-inputs pattern). */
  async function makeFactGeneration(
    t: TestApp,
    ids: { projectId: Id<"projects">; userId: Id<"users"> },
    inputsNote: string
  ) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId: ids.projectId,
        content: FACT_TRANSCRIPT,
        createdAt: now,
      });
      const generationId = await ctx.db.insert("generations", {
        projectId: ids.projectId,
        transcriptId,
        transcriptIds: [transcriptId],
        status: "reserved",
        requestedAt: now,
        requestedBy: ids.userId,
        startedAt: now,
        candidateMode: "single" as const,
        singleModelId: "claude-opus-4-8",
        previousProjectStatus: "draft",
        learningDigestIds: [],
      });
      await ctx.db.patch(ids.projectId, { status: "generating", activeGenerationId: generationId });
      await ctx.db.insert("generationSources", {
        projectId: ids.projectId,
        generationId,
        kind: "transcript",
        transcriptId,
        label: "Interview transcript",
        content: FACT_TRANSCRIPT,
        contentHash: "fact-transcript-hash",
        truncated: false,
        originalLength: FACT_TRANSCRIPT.length,
        capturedAt: now,
      });
      const note = `Background note ${inputsNote}.`;
      await ctx.db.insert("generationSources", {
        projectId: ids.projectId,
        generationId,
        kind: "project_document",
        label: `background:${inputsNote}.txt`,
        content: note,
        contentHash: `note-hash-${inputsNote}`,
        truncated: false,
        originalLength: note.length,
        capturedAt: now,
      });
      return generationId;
    });
  }

  /** Run one generation's Brief stage for `facts`; returns its stamped briefId. */
  async function deriveFacts(
    t: TestApp,
    ids: { projectId: Id<"projects">; userId: Id<"users"> },
    inputsNote: string,
    facts: number[]
  ) {
    await t.run((ctx) =>
      ctx.db.patch(ids.projectId, { status: "review", activeGenerationId: undefined })
    );
    const generationId = await makeFactGeneration(t, ids, inputsNote);
    mockFactBrief(facts);
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    return { generationId, briefId: generation?.briefId };
  }

  /** Each row of a version as `fact:change` (a question row as `question`),
   * sorted, so a version's exact row set compares in one assertion. */
  function factRowsOf(rows: Array<{ group: string; exactExcerpt: string; change?: string }>) {
    return rows
      .map((row) => {
        if (row.group === "storylineQuestion") return "question";
        const match = /^Fact (\d{4}) holds\.$/.exec(row.exactExcerpt);
        if (!match || row.group !== "confidenceMap") throw new Error(`unexpected row ${row.exactExcerpt}`);
        return `${match[1]}:${row.change ?? "none"}`;
      })
      .sort();
  }
  const factRows = (facts: number[], change: string) => facts.map((i) => `${factPad(i)}:${change}`);

  async function briefTables(t: TestApp) {
    return await t.run(async (ctx) => ({
      briefs: await ctx.db.query("generationBriefs").collect(),
      entries: await ctx.db.query("generationBriefEntries").collect(),
    }));
  }

  it("recovers an over-bound newest Brief on the next changed-input derivation", async () => {
    // Scheduled candidate jobs never run in this case: nothing but the Brief
    // stage touches its database, so the prior-version snapshots are exact.
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const ids = await makeProject(t);

      // v1: 300 live facts (0..299).
      const first = await deriveFacts(t, ids, "v1", factRange(0, 300));
      expect(first.briefId).toBeDefined();
      expect(factRowsOf(await entriesOf(t, first.briefId!))).toEqual(
        factRows(factRange(0, 300), "none").sort()
      );

      // v2: 520 live facts (300..819) against v1 → 520 added + 300 removed
      // markers = 820 derived rows, then one Self-check question = 821 rows.
      const second = await deriveFacts(t, ids, "v2", factRange(300, 820));
      expect(second.briefId).toBeDefined();
      const questionText = "Does the evidence override the Storyline claim?";
      await t.run(async (ctx) => {
        const evidence = (
          await ctx.db
            .query("generationBriefEntries")
            .withIndex("by_briefId", (q) => q.eq("briefId", second.briefId!))
            .first()
        )!;
        await ctx.db.insert("generationBriefEntries", {
          briefId: second.briefId!,
          projectId: ids.projectId,
          group: "storylineQuestion",
          text: questionText,
          sourceId: evidence.sourceId,
          sourceContentHash: evidence.sourceContentHash,
          startOffset: evidence.startOffset,
          endOffset: evidence.endOffset,
          exactExcerpt: evidence.exactExcerpt,
          question: { questionText },
          createdAt: Date.now(),
        });
      });
      const v2Rows = await entriesOf(t, second.briefId!);
      expect(v2Rows).toHaveLength(821);
      expect(factRowsOf(v2Rows)).toEqual(
        [
          ...factRows(factRange(300, 820), "added"),
          ...factRows(factRange(0, 300), "removed"),
          "question",
        ].sort()
      );
      // Index 500 in the Brief's own index order is fact 800; facts 801..819
      // are the live rows a 500-row prefix would never have seen.
      expect(factRowsOf([v2Rows[500]])).toEqual(["0800:added"]);
      expect(factRowsOf(v2Rows.slice(501, 520))).toEqual(factRows(factRange(801, 820), "added"));

      // v3, changed inputs: keep 300..699 and 810..819 (past index 500), drop
      // 700..809 (including index 500), re-propose fact 0 (only a historical
      // marker on v2) and propose a brand-new fact 900.
      const beforeRecovery = await briefTables(t);
      const kept = [...factRange(300, 700), ...factRange(810, 820)];
      const third = await deriveFacts(t, ids, "v3", [...kept, 0, 900]);

      // The lockout: before the fix this generation had no Brief at all.
      expect(third.briefId).toBeDefined();
      expect(third.briefId).not.toBe(second.briefId);
      const v3Rows = await entriesOf(t, third.briefId!);
      expect(factRowsOf(v3Rows)).toEqual(
        [
          ...factRows(kept, "unchanged"),
          ...factRows([0, 900], "added"),
          ...factRows(factRange(700, 810), "removed"),
        ].sort()
      );
      // Named rows from the acceptance criterion, asserted individually too.
      const v3ByFact = new Map(factRowsOf(v3Rows).map((row) => [row.slice(0, 4), row]));
      expect(v3ByFact.get("0815")).toBe("0815:unchanged");
      expect(v3ByFact.get("0800")).toBe("0800:removed");
      expect(v3ByFact.get("0000")).toBe("0000:added");
      expect(v3ByFact.has("0001")).toBe(false);
      expect(v3Rows.some((row) => row.group === "storylineQuestion")).toBe(false);

      // Prior versions are byte-identical: nothing patched, deleted or added.
      const afterRecovery = await briefTables(t);
      expect(afterRecovery.briefs.filter((row) => row._id !== third.briefId)).toEqual(
        beforeRecovery.briefs
      );
      expect(afterRecovery.entries.filter((row) => row.briefId !== third.briefId)).toEqual(
        beforeRecovery.entries
      );

      // v4, changed inputs again, against the recovered (itself over-bound,
      // 522-row) version: only its 412 live rows are the baseline, so its 110
      // markers are not re-emitted. Drop fact 900, add fact 950.
      expect(v3Rows).toHaveLength(522);
      const liveOfV3 = [0, ...kept];
      const fourth = await deriveFacts(t, ids, "v4", [...liveOfV3, 950]);
      expect(fourth.briefId).toBeDefined();
      const v4Rows = await entriesOf(t, fourth.briefId!);
      expect(factRowsOf(v4Rows)).toEqual(
        [
          ...factRows(liveOfV3, "unchanged"),
          ...factRows([950], "added"),
          ...factRows([900], "removed"),
        ].sort()
      );
      expect(v4Rows.length).toBeLessThanOrEqual(MAX_BRIEF_ENTRY_ROWS);

      // ...and, being within the bound, it renders into section prompts.
      const rendered = await t.query(internal.generations.renderBriefForGeneration, {
        generationId: fourth.generationId,
      });
      expect(rendered).toContain("--- BEGIN [GENERATION BRIEF] ---");
      expect(rendered).toContain(factText(950));
      expect(rendered).toContain(factText(819));
      expect(rendered).toContain(factText(0));
      expect(rendered).not.toContain(factText(900));
      expect(rendered).not.toContain(factText(700));
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
