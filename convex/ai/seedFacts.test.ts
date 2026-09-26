/// <reference types="vite/client" />

/**
 * Seeds on facts (phase 3, the transcript method; plan step 7), at the real
 * request and response boundary: the SDK runs, only `fetch` is stubbed.
 */
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import { buildSeedPrompt } from "./trustedContext";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./providers";
import { seedToolSchema } from "../lib/seedContract";
import { seedToolSchemaForFacts } from "../lib/seedFacts";
import { packFactId, renderFactPack, type PackFact } from "../lib/transcriptFacts";
import { buildPlaceholderMap } from "../lib/deidentify";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ])
);
const model = "claude-opus-4-8";
const generateBatchRef = makeFunctionReference<"action", { batchId: Id<"seedBatches"> }, null>(
  "ai/seeds:generateBatch"
);

const TRANSCRIPT = [
  "Dana Whitfield [00:00:05]: What made the forecast hard?",
  "Priya Shah [00:00:09]: We couldn't forecast net load fast enough when cloud cover changed at Verdant Grid.",
  "Dana Whitfield [00:01:10]: And the result?",
  "Priya Shah [00:01:15]: The model hit 71 percent accuracy on sunny days and 38 percent on cloudy days.",
].join("\n\n");
const DOCUMENT = "Test plan: run the ramp forecaster against the 2025 feeder data.";

function span(needle: string) {
  const charStart = TRANSCRIPT.indexOf(needle);
  if (charStart === -1) throw new Error(`fixture quote missing: ${needle}`);
  return { charStart, charEnd: charStart + needle.length, exactExcerpt: needle };
}

const uncertainty = span("We couldn't forecast net load fast enough when cloud cover changed at Verdant Grid.");
const result = span("The model hit 71 percent accuracy on sunny days and 38 percent on cloudy days.");

const FACTS: PackFact[] = [
  {
    key: "F1",
    type: "uncertainty",
    claim: "Priya Shah said net load could not be forecast fast enough when cloud cover changed.",
    turnIndexes: [1],
    quotes: [uncertainty],
    speakerLabel: "Priya Shah",
  },
  {
    key: "F2",
    type: "result",
    claim: "The model reached 71 percent accuracy on sunny days and 38 percent on cloudy days.",
    turnIndexes: [3],
    quotes: [result],
    speakerLabel: "Priya Shah",
  },
];

function turnStart(index: number) {
  const lines = TRANSCRIPT.split("\n\n");
  let at = 0;
  for (let i = 0; i < index; i += 1) at += lines[i].length + 2;
  return { charStart: at, charEnd: at + lines[index].length };
}

const PACK = renderFactPack({ position: 1, label: "Helios call" }, FACTS, {
  roles: new Map([
    ["Dana Whitfield", "interviewer"],
    ["Priya Shah", "client"],
  ]),
  turnInfo: new Map([
    [1, { speakerLabel: "Priya Shah", startMs: 9_000, ...turnStart(1) }],
    [3, { speakerLabel: "Priya Shah", startMs: 75_000, ...turnStart(3) }],
  ]),
});

const FACT_SPANS = [
  {
    id: packFactId(1, "F1"),
    type: "uncertainty" as const,
    quotes: [{ charStart: uncertainty.charStart, charEnd: uncertainty.charEnd, speakerLabel: "Priya Shah", role: "client" as const, startMs: 9_000 }],
  },
  {
    id: packFactId(1, "F2"),
    type: "result" as const,
    // Frozen while this speaker had no role yet (decision 24).
    quotes: [
      {
        charStart: result.charStart,
        charEnd: result.charEnd,
        speakerLabel: "Priya Shah",
        role: "unknown" as const,
        startMs: 75_000,
        needsSpeakerCheck: true,
      },
    ],
  },
];

const PLACEHOLDERS = buildPlaceholderMap({ clientName: "Verdant Grid", people: ["Dana Whitfield", "Priya Shah"] });

async function factAttempt(
  t: ReturnType<typeof convexTest<typeof schema.tables>>,
  options: { pack?: boolean; secondTranscript?: boolean } = {}
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "seed-facts-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      interviewer: "Dana Whitfield",
      interviewees: ["Priya Shah"],
      status: "generating",
      createdBy: userId,
      shareToken: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: TRANSCRIPT,
      label: "Helios call",
      position: 0,
      createdAt: now,
    });
    const secondId = options.secondTranscript
      ? await ctx.db.insert("transcripts", {
          projectId,
          content: "Priya Shah: A second call about the feeder test.",
          label: "Follow-up",
          position: 1,
          createdAt: now,
        })
      : null;
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: secondId ? [transcriptId, secondId] : [transcriptId],
      transcriptFacts: true,
      placeholders: [...PLACEHOLDERS],
      status: "awaiting_input",
      gatedWorkflow: "seeds",
      seedStageVersion: 0,
      seedRequestsReserved: 2,
      lengthTarget: "standard",
      startedAt: now,
      previousProjectStatus: "draft",
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const transcriptSourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      transcriptId,
      label: "Helios call",
      content: TRANSCRIPT,
      contentHash: "sha256:transcript",
      truncated: false,
      originalLength: TRANSCRIPT.length,
      capturedAt: now,
    });
    if (secondId) {
      await ctx.db.insert("generationSources", {
        generationId,
        projectId,
        kind: "transcript",
        transcriptId: secondId,
        label: "Follow-up",
        content: "Priya Shah: A second call about the feeder test.",
        contentHash: "sha256:second",
        truncated: false,
        originalLength: 48,
        capturedAt: now,
      });
    }
    const documentSourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "project_document",
      label: "other:test-plan.txt",
      content: DOCUMENT,
      contentHash: "sha256:document",
      truncated: false,
      originalLength: DOCUMENT.length,
      capturedAt: now,
    });
    const packSourceId =
      options.pack === false
        ? null
        : await ctx.db.insert("generationSources", {
            generationId,
            projectId,
            kind: "transcript_facts",
            transcriptId,
            label: "Helios call",
            content: PACK,
            contentHash: "sha256:pack",
            truncated: false,
            originalLength: PACK.length,
            capturedAt: now,
            factsVersion: "1",
            factSpans: FACT_SPANS,
          });
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId,
      generationId,
      inputsHash: "seed-facts-inputs",
      version: 1,
      origin: "derived",
      storylineText: "The team investigated net load forecasting.",
      createdAt: now,
    });
    await ctx.db.patch(generationId, { briefVersionId: briefId });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "brain_blocks",
      content: JSON.stringify({ styleGuidance: "Frozen guidance.", styleOverrides: {} }),
    });
    const subsectionId = await ctx.db.insert("seedSubsections", {
      projectId,
      generationId,
      roleId: "active_uncertainties",
      kind: "standard",
      state: "generating",
      currentContextRevision: "context-r0",
      selectionRevision: "selection-r0",
      priorState: "untouched",
      consecutiveFailures: 0,
    });
    const batchId = await ctx.db.insert("seedBatches", {
      projectId,
      generationId,
      roleId: "active_uncertainties",
      operation: "open",
      dedupeKey: "seed-facts-dedupe",
      commandId: "seed-facts-command",
      attemptId: "seed-facts-attempt",
      consumedContextRevision: "context-r0",
      briefVersionId: briefId,
      settingsHash: "settings-hash",
      status: "queued",
      queuedAt: now,
      leaseExpiresAt: now + 600_000,
      model,
      slot: "generation:seeds:active_uncertainties",
      promptVersion: "prompt-version",
      roleOpen: true,
      requestsReserved: 2,
    });
    await ctx.db.patch(subsectionId, { pendingBatchId: batchId });
    return { batchId, generationId, projectId, transcriptSourceId, documentSourceId, packSourceId };
  });
}

function requestText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => (block && typeof block === "object" && "text" in block && typeof block.text === "string" ? block.text : ""))
    .join("");
}

function providerResponse(input: unknown): Response {
  return Response.json({
    id: "msg_seed_facts",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "tool_use", id: "tool_seed_facts", name: SEED_PROMPT_PROGRAM.request.toolName, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
}

async function run(t: ReturnType<typeof convexTest<typeof schema.tables>>, batchId: Id<"seedBatches">, seeds: unknown[]) {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      requests.push(new Request(input, init));
      return providerResponse({ seeds });
    })
  );
  await t.action(generateBatchRef, { batchId });
  expect(requests).toHaveLength(1);
  return (await requests[0].json()) as {
    tools: Array<{ input_schema: unknown }>;
    system: unknown;
    messages: Array<{ content: unknown }>;
  };
}

async function storedSeeds(t: ReturnType<typeof convexTest<typeof schema.tables>>, batchId: Id<"seedBatches">) {
  return await t.run(async (ctx) => {
    const seeds = await ctx.db
      .query("seeds")
      .withIndex("by_batchId", (q) => q.eq("batchId", batchId))
      .collect();
    return await Promise.all(
      seeds.map(async (seed) => ({
        seed,
        provenance: await ctx.db
          .query("seedProvenance")
          .withIndex("by_seedId", (q) => q.eq("seedId", seed._id))
          .collect(),
      }))
    );
  });
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-seed-facts-key");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Seeds read fact packs and cite fact ids (plan step 7)", () => {
  it("sends the pack and the fact schema behind placeholders, and stores verbatim transcript citations", async () => {
    const t = convexTest(schema, modules);
    const f = await factAttempt(t);
    const body = await run(t, f.batchId, [
      {
        bullets: ["Net load could not be forecast when cloud cover changed at [CLIENT_1]."],
        tags: ["technical"],
        provenance: [{ factId: "F1-1" }],
      },
      {
        bullets: ["The team planned a ramp forecaster test on feeder data."],
        tags: ["detailed"],
        provenance: [{ sourceId: f.documentSourceId, exactExcerpt: "run the ramp forecaster against the 2025 feeder data" }],
      },
      {
        bullets: ["Accuracy fell from 71 percent to 38 percent on cloudy days."],
        tags: ["conservative"],
        provenance: [
          { factId: "F1-2" },
          // A transcript cited by excerpt is refused in fact mode.
          { sourceId: f.transcriptSourceId, exactExcerpt: "What made the forecast hard?" },
        ],
      },
    ]);

    expect(body.tools[0].input_schema).toEqual(seedToolSchemaForFacts());
    const user = requestText(body.messages[0].content);
    expect(user).toContain(SEED_PROMPT_PROGRAM.user.factGuidance);
    expect(user).toContain("[F1-1] (uncertainty)");
    expect(user).toContain("kind=transcript_facts");
    // The interviewer's question is not in the pack, so not in the prompt.
    expect(user).not.toContain("What made the forecast hard?");
    // Owner decision 26: names never leave the app.
    for (const name of ["Priya", "Dana", "Verdant"]) expect(user).not.toContain(name);

    const stored = await storedSeeds(t, f.batchId);
    expect(stored).toHaveLength(3);
    const [first, second, third] = stored;
    // Restored before storage.
    expect(first.seed.bullets[0]).toContain("Verdant Grid");
    expect(first.seed.support).toBe("source_supported");
    expect(first.provenance).toHaveLength(1);
    expect(first.provenance[0]).toMatchObject({
      sourceId: f.transcriptSourceId,
      startOffset: uncertainty.charStart,
      endOffset: uncertainty.charEnd,
      exactExcerpt: uncertainty.exactExcerpt,
      factKey: "F1-1",
      role: "client",
      startMs: 9_000,
      speaker: "Priya Shah",
      line: 3,
    });
    expect(TRANSCRIPT.slice(first.provenance[0].startOffset, first.provenance[0].endOffset)).toBe(
      first.provenance[0].exactExcerpt
    );
    expect(second.provenance).toHaveLength(1);
    expect(second.provenance[0]).toMatchObject({
      sourceId: f.documentSourceId,
      exactExcerpt: "run the ramp forecaster against the 2025 feeder data",
    });
    expect(second.provenance[0].factKey).toBeUndefined();
    expect(third.provenance.map((row) => row.factKey)).toEqual(["F1-2"]);
    // A quote whose speaker has no role yet is kept, marked for a check.
    expect(third.provenance[0]).toMatchObject({ role: "unknown", needsSpeakerCheck: true });
    expect(first.provenance[0].needsSpeakerCheck).toBeUndefined();
  });

  it("falls back to today's schema, guidance and transcript text when a transcript has no pack", async () => {
    const t = convexTest(schema, modules);
    const f = await factAttempt(t, { secondTranscript: true });
    const excerpt = "We couldn't forecast net load fast enough";
    const start = TRANSCRIPT.indexOf(excerpt);
    const body = await run(t, f.batchId, [
      {
        bullets: ["Net load could not be forecast fast enough."],
        tags: ["technical"],
        provenance: [{ sourceId: f.transcriptSourceId, startOffset: start, endOffset: start + excerpt.length, exactExcerpt: excerpt }],
      },
      { bullets: ["Cloud cover changed the forecast."], tags: ["detailed"], provenance: [] },
      { bullets: ["Accuracy dropped on cloudy days."], tags: ["conservative"], provenance: [] },
    ]);
    expect(body.tools[0].input_schema).toEqual(seedToolSchema());
    const user = requestText(body.messages[0].content);
    expect(user).toContain(SEED_PROMPT_PROGRAM.user.guidance);
    expect(user).not.toContain(SEED_PROMPT_PROGRAM.user.factGuidance);
    expect(user).toContain("What made the forecast hard?");
    expect(user).not.toContain("kind=transcript_facts");
    const stored = await storedSeeds(t, f.batchId);
    const cited = stored.find((row) => row.provenance.length > 0)!;
    expect(cited.seed.support).toBe("source_supported");
    expect(cited.provenance[0]).toMatchObject({ sourceId: f.transcriptSourceId, exactExcerpt: excerpt });
    expect(cited.provenance[0].factKey).toBeUndefined();
  });
});

describe("the fact-mode Seed prompt is cache stable (plan step 7)", () => {
  const sources = [
    { sourceId: "src-t", label: "Helios call", kind: "transcript", content: TRANSCRIPT, contentHash: "h-t", transcriptId: "tr-1" },
    { sourceId: "src-d", label: "other:test-plan.txt", kind: "project_document", content: DOCUMENT, contentHash: "h-d" },
    { sourceId: "src-p", label: "Helios call", kind: "transcript_facts", content: PACK, contentHash: "h-p", transcriptId: "tr-1" },
  ];
  const request = (objective: string, rows = sources) =>
    buildSeedPrompt({
      mode: "batch",
      objective,
      brief: { storylineText: "Frozen" },
      sources: rows,
      projection: { decisions: "[]", feedback: "[]" },
      writerSettings: {},
      lengthTarget: "standard",
    });

  it("shares one byte-identical cached block across roles and runs, and never holds the raw transcript", () => {
    const a = request("Describe the uncertainty.");
    const b = request("Describe the experiments.");
    const again = request("Describe the uncertainty.", [...sources]);
    expect(a.userBlocks[0].text).toBe(b.userBlocks[0].text);
    expect(a.userBlocks[0].text).toBe(again.userBlocks[0].text);
    expect(a.userBlocks[0]).toMatchObject({ cache_control: SEED_PROMPT_PROGRAM.request.cacheControl });
    expect(a.userBlocks[1].text).not.toBe(b.userBlocks[1].text);
    expect(a.userBlocks[0].text).toContain(PACK);
    expect(a.userBlocks[0].text).not.toContain("What made the forecast hard?");
  });
});
