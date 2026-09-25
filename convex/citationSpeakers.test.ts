/// <reference types="vite/client" />

/**
 * Owner decision 25 outside facts mode (2026-09-25): only client turns back
 * a claim. Seeds, Brief entries and report claims that cite a frozen
 * transcript by quote or offsets drop a citation that falls wholly inside
 * interviewer or `other` turns, keep one of a speaker with no role yet
 * (marked for a speaker check on Seeds), and leave transcripts without
 * stored turns exactly as before. The fixture follows the Meridian demo
 * project, whose Brief cited the interviewer's question.
 */
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import schema from "./schema";
import { deriveOrReuseBrief } from "./ai/brief";
import { SEED_PROMPT_PROGRAM } from "./ai/promptDefinitions";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import type { GenerationClient } from "./ai/openrouterCore";
import { sha256 } from "./lib/contracts";
import {
  citationSpeakerReader,
  otherOccurrences,
  speakerOfRoles,
  type CitationSpeaker,
} from "./lib/citationSpeakers";
import { withCheckedSpeakers, type ValidatedSeedCandidate } from "./lib/seedContract";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

const MERIDIAN = [
  "Jordan Ellis: So the bond line fails at the standard cure?",
  "Sam Okafor: Yes, the bond line fails at the standard cure because the foam cores deform at 120 degrees.",
  "Jordan Ellis: Why could you not just buy a low-temperature adhesive?",
  "Sam Okafor: No supplier had one that held above 80 degrees in service, so we formulated our own.",
  "Lee Park: The supplier samples all failed our peel test.",
  "Robin Chen: We logged peel strength after every batch.",
].join("\n\n");

const ROLES = {
  "Jordan Ellis": "interviewer",
  "Sam Okafor": "client",
  "Lee Park": "other",
  "Robin Chen": "unknown",
} as const;

const QUESTION = "Why could you not just buy a low-temperature adhesive?";
const CLIENT = "No supplier had one that held above 80 degrees in service";
const OTHER = "The supplier samples all failed our peel test.";
const UNKNOWN = "We logged peel strength after every batch.";
const ECHO = "the bond line fails at the standard cure";

function at(needle: string, from = 0) {
  const startOffset = MERIDIAN.indexOf(needle, from);
  if (startOffset === -1) throw new Error(`fixture quote missing: ${needle}`);
  return { startOffset, endOffset: startOffset + needle.length, exactExcerpt: needle };
}
const ECHO_INTERVIEWER = at(ECHO);
const ECHO_CLIENT = at(ECHO, ECHO_INTERVIEWER.endOffset);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-speaker-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * A Meridian project with one frozen transcript row. With `turns`, the
 * server builds the stored turns and speaker rows, and the roles are set as
 * a consultant would.
 */
async function meridian(t: TestConvex, options: { turns: boolean }) {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "meridian-writer", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Meridian bonding",
      clientName: "Meridian Materials",
      interviewer: "Jordan Ellis",
      interviewees: ["Sam Okafor"],
      status: "generating",
      createdBy: userId,
      shareToken: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: MERIDIAN,
      contentHash: await sha256(MERIDIAN),
      label: "Meridian interview",
      position: 0,
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "awaiting_input",
      gatedWorkflow: "seeds",
      seedStageVersion: 0,
      seedRequestsReserved: 2,
      lengthTarget: "standard",
      requestedBy: userId,
      startedAt: now,
      previousProjectStatus: "draft",
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const sourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      transcriptId,
      label: "Meridian interview",
      content: MERIDIAN,
      contentHash: await sha256(MERIDIAN),
      truncated: false,
      originalLength: MERIDIAN.length,
      capturedAt: now,
    });
    return { userId, projectId, transcriptId, generationId, sourceId };
  });
  if (options.turns) {
    await t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: ids.transcriptId });
    await t.run(async (ctx) => {
      const speakers = await ctx.db
        .query("transcriptSpeakers")
        .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", ids.transcriptId))
        .collect();
      expect(speakers.map((row) => row.label).sort()).toEqual(Object.keys(ROLES).sort());
      for (const row of speakers) {
        await ctx.db.patch(row._id, {
          role: ROLES[row.label as keyof typeof ROLES],
          roleSource: "consultant",
        });
      }
    });
  }
  return ids;
}

async function speakersOf(
  t: TestConvex,
  sourceId: Id<"generationSources">,
  spans: Array<{ startOffset: number; endOffset: number }>
): Promise<CitationSpeaker[]> {
  return await t.run(async (ctx) => {
    const source = await ctx.db.get(sourceId);
    if (!source) throw new Error("source missing");
    const speakerOf = citationSpeakerReader(ctx);
    const out: CitationSpeaker[] = [];
    for (const span of spans) out.push(await speakerOf(source, span.startOffset, span.endOffset));
    return out;
  });
}

describe("the speaker check (convex/lib/citationSpeakers.ts)", () => {
  it("reads roles from the stored turns: interviewer and other excluded, client kept, unknown flagged", async () => {
    const t = convexTest(schema, modules);
    const f = await meridian(t, { turns: true });
    const label = at("Jordan Ellis: Why");
    expect(
      await speakersOf(t, f.sourceId, [
        at(QUESTION),
        at(CLIENT),
        at(OTHER),
        at(UNKNOWN),
        ECHO_INTERVIEWER,
        ECHO_CLIENT,
        // A span across the question and the client's answer holds client words.
        { startOffset: at(QUESTION).startOffset, endOffset: at(CLIENT).endOffset },
        // Only the label text before a turn: nobody's words.
        { startOffset: label.startOffset, endOffset: label.startOffset + "Jordan Ellis".length },
      ])
    ).toEqual([
      "excluded",
      "client",
      "excluded",
      "needs_check",
      "excluded",
      "client",
      "client",
      "needs_check",
    ]);
  });

  it("says unchecked without stored turns, during a rebuild, and for a row whose text differs", async () => {
    const t = convexTest(schema, modules);
    const bare = await meridian(t, { turns: false });
    expect(await speakersOf(t, bare.sourceId, [at(QUESTION)])).toEqual(["unchecked"]);

    const built = await meridian(t, { turns: true });
    await t.run((ctx) => ctx.db.patch(built.transcriptId, { structureBuildId: "rebuild-in-progress" }));
    expect(await speakersOf(t, built.sourceId, [at(QUESTION)])).toEqual(["unchecked"]);
    await t.run(async (ctx) => {
      await ctx.db.patch(built.transcriptId, { structureBuildId: undefined });
      await ctx.db.patch(built.sourceId, { content: `Preface.\n\n${MERIDIAN}`, contentHash: "other" });
    });
    expect(await speakersOf(t, built.sourceId, [at(QUESTION)])).toEqual(["unchecked"]);
  });

  it("decides from roles alone, and orders other places nearest first", () => {
    expect(speakerOfRoles([])).toBe("needs_check");
    expect(speakerOfRoles(["interviewer"])).toBe("excluded");
    expect(speakerOfRoles(["interviewer", "other"])).toBe("excluded");
    expect(speakerOfRoles(["client"])).toBe("client");
    expect(speakerOfRoles(["interviewer", "client"])).toBe("client");
    expect(speakerOfRoles(["client", "unknown"])).toBe("needs_check");
    expect(otherOccurrences("ab ab ab ab", "ab", 6, 6, 8)).toEqual([3, 9, 0]);
    expect(otherOccurrences("ab ab ab ab", "ab", 6, 6, 2)).toEqual([3, 9]);
  });

  it("drops rejected Seed citations, moves or marks the rest, and recomputes support", () => {
    const citation = (offset: number) => ({
      sourceId: "s",
      startOffset: offset,
      endOffset: offset + 2,
      exactExcerpt: "ab",
      sourceContentHash: "h",
    });
    const seed: ValidatedSeedCandidate = {
      bullets: ["One sentence."],
      tags: ["technical"],
      provenance: [citation(0), citation(3)],
      support: "source_supported",
      originalSupport: "source_supported",
    };
    const kept = withCheckedSpeakers(seed, [
      null,
      { startOffset: 6, endOffset: 8, needsSpeakerCheck: true },
    ]);
    expect(kept.dropped).toBe(1);
    expect(kept.seed.provenance).toEqual([{ ...citation(6), needsSpeakerCheck: true }]);
    expect(kept.seed.support).toBe("source_supported");
    const merged = withCheckedSpeakers(seed, [
      { startOffset: 6, endOffset: 8, needsSpeakerCheck: false },
      { startOffset: 6, endOffset: 8, needsSpeakerCheck: false },
    ]);
    expect(merged.seed.provenance).toEqual([citation(6)]);
    expect(merged.dropped).toBe(1);
    const none = withCheckedSpeakers(seed, [null, null]);
    expect(none.seed.provenance).toEqual([]);
    expect(none.seed).toMatchObject({ support: "writer_asserted", originalSupport: "writer_asserted" });
  });
});

// ─── Seeds, through the real batch action with only fetch stubbed ──────────

const generateBatchRef = makeFunctionReference<"action", { batchId: Id<"seedBatches"> }, null>(
  "ai/seeds:generateBatch"
);
const seedModel = "claude-sonnet-5";

async function seedBatch(t: TestConvex, f: Awaited<ReturnType<typeof meridian>>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: f.projectId,
      generationId: f.generationId,
      inputsHash: "meridian-inputs",
      version: 1,
      origin: "derived",
      storylineText: "The team formulated its own low-temperature adhesive.",
      createdAt: now,
    });
    await ctx.db.patch(f.generationId, { briefVersionId: briefId });
    await ctx.db.insert("generationArtifacts", {
      generationId: f.generationId,
      kind: "brain_blocks",
      content: JSON.stringify({ styleGuidance: "Frozen guidance.", styleOverrides: {} }),
    });
    const subsectionId = await ctx.db.insert("seedSubsections", {
      projectId: f.projectId,
      generationId: f.generationId,
      roleId: "active_uncertainties",
      kind: "standard",
      state: "generating",
      currentContextRevision: "context-r0",
      selectionRevision: "selection-r0",
      priorState: "untouched",
      consecutiveFailures: 0,
    });
    const batchId = await ctx.db.insert("seedBatches", {
      projectId: f.projectId,
      generationId: f.generationId,
      roleId: "active_uncertainties",
      operation: "open",
      dedupeKey: "meridian-dedupe",
      commandId: "meridian-command",
      attemptId: "meridian-attempt",
      consumedContextRevision: "context-r0",
      briefVersionId: briefId,
      settingsHash: "settings-hash",
      status: "queued",
      queuedAt: now,
      leaseExpiresAt: now + 600_000,
      model: seedModel,
      slot: "generation:seeds:active_uncertainties",
      promptVersion: "prompt-version",
      roleOpen: true,
      requestsReserved: 2,
    });
    await ctx.db.patch(subsectionId, { pendingBatchId: batchId });
    return batchId;
  });
}

async function runSeeds(t: TestConvex, batchId: Id<"seedBatches">, seeds: unknown[]) {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      id: "msg_meridian_seeds",
      type: "message",
      role: "assistant",
      model: seedModel,
      content: [{ type: "tool_use", id: "tool_meridian", name: SEED_PROMPT_PROGRAM.request.toolName, input: { seeds } }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 40 },
    })
  );
  vi.stubGlobal("fetch", transport);
  await t.action(generateBatchRef, { batchId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(transport).toHaveBeenCalledTimes(1);
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("seeds")
      .withIndex("by_batchId", (q) => q.eq("batchId", batchId))
      .collect();
    return await Promise.all(
      rows
        .sort((a, b) => a.order - b.order)
        .map(async (seed) => ({
          seed,
          provenance: await ctx.db
            .query("seedProvenance")
            .withIndex("by_seedId", (q) => q.eq("seedId", seed._id))
            .collect(),
        }))
    );
  });
}

function seedsCiting(sourceId: Id<"generationSources">) {
  const cite = (span: { startOffset: number; endOffset: number; exactExcerpt: string }) => ({ sourceId, ...span });
  return [
    {
      bullets: ["The team asked whether an off-the-shelf adhesive would do."],
      tags: ["technical"],
      provenance: [cite(at(QUESTION))],
    },
    {
      bullets: ["No supplier adhesive held above 80 degrees in service."],
      tags: ["detailed"],
      // The echo is cited at the interviewer's words; the client said them too.
      provenance: [cite(at(CLIENT)), cite(ECHO_INTERVIEWER)],
    },
    {
      bullets: ["Peel strength was logged after every batch."],
      tags: ["conservative"],
      provenance: [cite(at(UNKNOWN)), cite(at(OTHER))],
    },
  ];
}

describe("Seeds keep only client turns as evidence outside facts mode", () => {
  it("drops an interviewer quote, keeps a client quote, moves an echo to the client, and flags an unknown speaker", async () => {
    const t = convexTest(schema, modules);
    const f = await meridian(t, { turns: true });
    const batchId = await seedBatch(t, f);
    const stored = await runSeeds(t, batchId, seedsCiting(f.sourceId));

    expect(stored).toHaveLength(3);
    const [question, client, unknown] = stored;
    // The interviewer's question backs nothing: the Seed stays, writer-asserted.
    expect(question.provenance).toEqual([]);
    expect(question.seed).toMatchObject({ support: "writer_asserted", originalSupport: "writer_asserted" });

    expect(client.seed.support).toBe("source_supported");
    expect(client.provenance.map((row) => [row.startOffset, row.exactExcerpt, row.speaker])).toEqual([
      [at(CLIENT).startOffset, CLIENT, "Sam Okafor"],
      [ECHO_CLIENT.startOffset, ECHO, "Sam Okafor"],
    ]);
    for (const row of client.provenance) {
      expect(MERIDIAN.slice(row.startOffset, row.endOffset)).toBe(row.exactExcerpt);
      expect(row.needsSpeakerCheck).toBeUndefined();
    }

    // The vendor's words are dropped; the unconfirmed speaker's are kept and flagged.
    expect(unknown.seed.support).toBe("source_supported");
    expect(unknown.provenance).toHaveLength(1);
    expect(unknown.provenance[0]).toMatchObject({
      exactExcerpt: UNKNOWN,
      speaker: "Robin Chen",
      needsSpeakerCheck: true,
    });
  });

  it("leaves a transcript without stored turns exactly as before", async () => {
    const t = convexTest(schema, modules);
    const f = await meridian(t, { turns: false });
    const batchId = await seedBatch(t, f);
    const stored = await runSeeds(t, batchId, seedsCiting(f.sourceId));

    expect(stored.map((row) => row.seed.support)).toEqual([
      "source_supported",
      "source_supported",
      "source_supported",
    ]);
    expect(stored.map((row) => row.provenance.map((citation) => citation.startOffset))).toEqual([
      [at(QUESTION).startOffset],
      [at(CLIENT).startOffset, ECHO_INTERVIEWER.startOffset],
      [at(UNKNOWN).startOffset, at(OTHER).startOffset],
    ]);
    for (const row of stored.flatMap((entry) => entry.provenance)) {
      expect(row.needsSpeakerCheck).toBeUndefined();
    }
  });
});

// ─── Brief entries ───────────────────────────────────────────────────────────

function briefClient(): GenerationClient {
  return {
    messages: {
      create: async (params) => ({
        content: [{
          type: "tool_use" as const,
          id: "tool_meridian_brief",
          name: params.tool_choice?.name ?? "submit_generation_brief",
          input: {
            storyline: "The team formulated its own adhesive because none held above 80 degrees.",
            storylineClaims: [{ text: "No supplier adhesive held above 80 degrees.", quote: CLIENT }],
            // The demo defect: an exclusion backed by the interviewer's question.
            claimExclusions: [{ text: "Buying an adhesive was an option.", quote: QUESTION, reason: "business_risk" }],
            confidenceMap: [
              { text: "Peel strength was logged per batch.", quote: UNKNOWN, confidence: "established" },
              { text: "Supplier samples failed the peel test.", quote: OTHER, confidence: "established" },
            ],
            // First said by the interviewer, then by the client.
            glossaryTerms: [{ term: "bond line" }],
          },
        }],
        stop_reason: "tool_use",
      }),
    },
  };
}

async function deriveBrief(t: TestConvex, f: Awaited<ReturnType<typeof meridian>>) {
  await t.run((ctx) => ctx.db.patch(f.generationId, { gatedWorkflow: undefined, status: "running" }));
  const outcome = await runAction(t, async (ctx) =>
    deriveOrReuseBrief(ctx, briefClient(), { projectId: f.projectId, generationId: f.generationId })
  );
  if (outcome.kind !== "derived") throw new Error(`unexpected Brief outcome ${outcome.kind}`);
  return await t.run(async (ctx) => ({
    brief: await ctx.db.get(outcome.briefId),
    entries: await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", outcome.briefId))
      .collect(),
  }));
}

describe("Brief entries keep only client turns as evidence outside facts mode", () => {
  it("drops the interviewer-backed exclusion and the vendor's words, and moves the glossary term to the client", async () => {
    const t = convexTest(schema, modules);
    const f = await meridian(t, { turns: true });
    const { brief, entries } = await deriveBrief(t, f);

    expect(entries.map((entry) => [entry.group, entry.exactExcerpt, entry.startOffset]).sort()).toEqual(
      [
        ["confidenceMap", UNKNOWN, at(UNKNOWN).startOffset],
        ["glossaryTerm", "bond line", MERIDIAN.indexOf("bond line", ECHO_CLIENT.startOffset)],
        ["storyline", CLIENT, at(CLIENT).startOffset],
      ].sort()
    );
    // Both dropped entries are counted on the Brief.
    expect(brief?.droppedEntryCount).toBe(2);
  });

  it("refuses an interviewer-backed entry again when the Brief is stored", async () => {
    const t = convexTest(schema, modules);
    const f = await meridian(t, { turns: true });
    await t.run((ctx) => ctx.db.patch(f.generationId, { gatedWorkflow: undefined, status: "running" }));
    const hash = await sha256(MERIDIAN);
    const entry = (group: "claimExclusion" | "storyline", span: { startOffset: number; endOffset: number; exactExcerpt: string }) => ({
      group,
      text: `${group} entry`,
      ...(group === "claimExclusion" ? { reason: "business_risk" as const } : {}),
      sourceId: f.sourceId,
      sourceContentHash: hash,
      ...span,
    });
    const briefId = await t.mutation(internal.generations.persistDerivedBrief, {
      projectId: f.projectId,
      generationId: f.generationId,
      inputsHash: "meridian-guard",
      origin: "derived",
      storylineText: "Storyline.",
      entries: [entry("claimExclusion", at(QUESTION)), entry("storyline", at(CLIENT))],
      upstreamDroppedEntryCount: 0,
      baselineBriefId: null,
      baselineRetained: [],
      baselineRemoved: [],
    });
    if (!briefId) throw new Error("Brief was not stored");
    const stored = await t.run(async (ctx) => ({
      brief: await ctx.db.get(briefId),
      entries: await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
        .collect(),
    }));
    expect(stored.entries.map((row) => row.group)).toEqual(["storyline"]);
    expect(stored.brief?.droppedEntryCount).toBe(1);
  });

  it("keeps every entry at its first place when the transcript has no stored turns", async () => {
    const t = convexTest(schema, modules);
    const f = await meridian(t, { turns: false });
    const { brief, entries } = await deriveBrief(t, f);

    expect(entries.map((entry) => [entry.group, entry.startOffset]).sort()).toEqual(
      [
        ["claimExclusion", at(QUESTION).startOffset],
        ["confidenceMap", at(UNKNOWN).startOffset],
        ["confidenceMap", at(OTHER).startOffset],
        ["glossaryTerm", MERIDIAN.indexOf("bond line")],
        ["storyline", at(CLIENT).startOffset],
      ].sort()
    );
    expect(brief?.droppedEntryCount).toBe(0);
  });
});

// ─── Report claims ───────────────────────────────────────────────────────────

const CLAIMS = {
  question: "The team considered buying a low-temperature adhesive.",
  client: "No supplier adhesive held above 80 degrees in service.",
  echo: "The bond line failed at the standard cure.",
};
const REPORT = JSON.stringify({
  type: "doc",
  content: Object.values(CLAIMS).map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

async function provenanceFor(t: TestConvex, f: Awaited<ReturnType<typeof meridian>>) {
  const hash = await sha256(MERIDIAN);
  const claim = async (claimId: string, claimText: string, span: { startOffset: number; endOffset: number; exactExcerpt: string }) => ({
    claimId,
    section: "242" as const,
    material: true,
    claimText,
    claimTextHash: await sha256(claimText),
    state: "needs_review" as const,
    sources: [{ generationSourceId: f.sourceId, sourceContentHash: hash, ...span }],
  });
  const provenanceId = await t.mutation(internal.reports.createProvenance, {
    projectId: f.projectId,
    generationId: f.generationId,
    sourceTranscriptId: f.transcriptId,
    content: REPORT,
    claims: [
      await claim("242-1", CLAIMS.question, at(QUESTION)),
      await claim("242-2", CLAIMS.client, at(CLIENT)),
      await claim("242-3", CLAIMS.echo, ECHO_INTERVIEWER),
    ],
  });
  return (await t.run((ctx) => ctx.db.get(provenanceId)))!.claims;
}

describe("report claims keep only client turns as evidence outside facts mode", () => {
  it("marks a claim backed only by the interviewer unsupported and moves an echo to the client", async () => {
    const t = convexTest(schema, modules);
    const f = await meridian(t, { turns: true });
    const claims = await provenanceFor(t, f);

    expect(claims.map((claim) => [claim.claimId, claim.state, claim.sources.map((source) => source.startOffset)])).toEqual([
      ["242-1", "unsupported", []],
      ["242-2", "needs_review", [at(CLIENT).startOffset]],
      ["242-3", "needs_review", [ECHO_CLIENT.startOffset]],
    ]);
  });

  it("stores claims unchanged when the transcript has no stored turns", async () => {
    const t = convexTest(schema, modules);
    const f = await meridian(t, { turns: false });
    const claims = await provenanceFor(t, f);

    expect(claims.map((claim) => [claim.claimId, claim.state, claim.sources.map((source) => source.startOffset)])).toEqual([
      ["242-1", "needs_review", [at(QUESTION).startOffset]],
      ["242-2", "needs_review", [at(CLIENT).startOffset]],
      ["242-3", "needs_review", [ECHO_INTERVIEWER.startOffset]],
    ]);
  });
});
