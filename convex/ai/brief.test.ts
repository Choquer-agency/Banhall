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
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
// `convex/briefs.ts` is a brand-new file `_generated/api.d.ts` cannot know
// about without a live-deployment codegen refresh (unavailable in this
// worktree — see the comment atop this file). `anyApi` is Convex's own
// escape hatch for exactly this: at runtime `api`/`internal` from
// `_generated/api.js` already ARE `anyApi` (see that file), so this reaches
// the real, currently-uncodegen'd `briefs.ts` functions with no loss of
// fidelity — only the static type gets looser for these calls.
import { anyApi } from "convex/server";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import type { GenerationMessageParams } from "./openrouterCore";

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
  "The team built a custom control loop to stabilize output. Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured.";

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
  glossaryTerms: [{ term: "control loop" }],
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
    expect(byGroup("glossaryTerm")).toHaveLength(1);
    expect(byGroup("glossaryTerm")[0].text.toLowerCase()).toBe("control loop");

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
      "Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured. The legacy control loop remained active throughout.";
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
    // The glossary term from v1 ("control loop") isn't in v2's model output —
    // it shows up as a removed marker on the new version.
    const removed = entries.filter((e) => e.change === "removed");
    expect(removed.some((e) => e.group === "glossaryTerm")).toBe(true);
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
    });

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
    });

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
    expect(edited?.storylineText).toBe("The writer's corrected Storyline claim.");

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
