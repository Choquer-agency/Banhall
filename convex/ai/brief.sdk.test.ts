/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  BRIEF_INPUT_BUDGET,
  BRIEF_REQUEST,
  BRIEF_SCHEMA,
  BRIEF_SYSTEM_PROMPT,
  buildBriefUserMessage,
  deriveOrReuseBrief,
} from "./brief";
import { clientForModel } from "./providers";

// Keep the Anthropic SDK, structured decoding, citation resolution and Convex
// persistence real. Only the HTTP transport is replaced.
const modules = import.meta.glob("../**/*.ts");
const model = "claude-opus-4-8";

const transcriptEvidence = [
  {
    label: "Alpha interview",
    content:
      "The project objective was to stabilize the thermal control loop. For thermal run TR-17 using controller configuration C4, the observed settling time was 120 ms.",
    contentHash: "transcript-alpha-hash",
  },
  {
    label: "Beta notes",
    content:
      "We shared the objective of stabilizing the thermal control loop. Beta instrumentation log states: For thermal run TR-17 using controller configuration C4, settling required 230 ms.",
    contentHash: "transcript-beta-hash",
  },
  {
    label: "Gamma debrief",
    content:
      "The agreed objective remained a stable thermal control loop. For thermal run TR-17 using controller configuration C4, the recorded settling interval was 310 ms. The debrief also quotes the Beta report verbatim: For thermal run TR-17 using controller configuration C4, settling required 230 ms.",
    contentHash: "transcript-gamma-hash",
  },
] satisfies ReadonlyArray<{
  label: string;
  content: string;
  contentHash: string;
}>;

const providerBrief = {
  storyline:
    "The evidence supports a shared objective to stabilize the thermal control loop; reported settling times for thermal run TR-17 under controller configuration C4 conflict and remain unresolved.",
  storylineClaims: [
    {
      text: "The team pursued a stable thermal control loop.",
      quote: "The project objective was to stabilize the thermal control loop.",
    },
    {
      text: "Alpha interview reports a 120 ms settling time for run TR-17 under configuration C4.",
      quote:
        "For thermal run TR-17 using controller configuration C4, the observed settling time was 120 ms.",
    },
    {
      text: "Beta notes report a 230 ms settling time for run TR-17 under configuration C4.",
      quote:
        "Beta instrumentation log states: For thermal run TR-17 using controller configuration C4, settling required 230 ms.",
    },
    {
      text: "Gamma debrief reports a 310 ms settling time for run TR-17 under configuration C4.",
      quote:
        "For thermal run TR-17 using controller configuration C4, the recorded settling interval was 310 ms.",
    },
  ],
  claimExclusions: [],
  confidenceMap: [
    {
      text: "Alpha interview supports the shared control-loop objective.",
      quote: "The project objective was to stabilize the thermal control loop.",
      confidence: "established",
    },
    {
      text: "Beta notes support the shared control-loop objective.",
      quote: "We shared the objective of stabilizing the thermal control loop.",
      confidence: "established",
    },
    {
      text: "Gamma debrief supports the shared control-loop objective.",
      quote: "The agreed objective remained a stable thermal control loop.",
      confidence: "established",
    },
    {
      text: "Alpha interview reports a 120 ms settling time for run TR-17 under configuration C4.",
      quote: "For thermal run TR-17 using controller configuration C4, the observed settling time was 120 ms.",
      confidence: "unresolved",
    },
    {
      text: "Beta notes report a 230 ms settling time for run TR-17 under configuration C4.",
      quote:
        "Beta instrumentation log states: For thermal run TR-17 using controller configuration C4, settling required 230 ms.",
      confidence: "unresolved",
    },
    {
      text: "Gamma debrief reports a 310 ms settling time for run TR-17 under configuration C4.",
      quote: "For thermal run TR-17 using controller configuration C4, the recorded settling interval was 310 ms.",
      confidence: "unresolved",
    },
    {
      text: "A fabricated fourth measurement must be dropped.",
      quote: "A fourth transcript measured a 220 ms settling time.",
      confidence: "unresolved",
    },
  ],
  glossaryTerms: [],
};

const requestBodySchema = z.object({
  model: z.string(),
  max_tokens: z.number(),
  system: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      input_schema: z.unknown(),
    })
  ),
  tool_choice: z.object({ type: z.string(), name: z.string() }),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-brief-sdk-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected HTTP transport");
    })
  );
});

afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("serializes stable Brief source-kind tags and excludes a writer Storyline", () => {
  const sources = [
    { kind: "transcript", label: "Custom interview", content: "Transcript bytes." },
    { kind: "transcript_digest", label: "Condensed interview", content: "Digest bytes." },
    { kind: "project_document", label: "Test record", content: "Document bytes." },
    { kind: "writer_storyline", label: "Writer Storyline", content: "Excluded bytes." },
  ] satisfies Parameters<typeof buildBriefUserMessage>[0];

  const message = buildBriefUserMessage(sources);

  expect(message).toContain(
    "--- BEGIN [SOURCE_KIND=transcript] [CUSTOM INTERVIEW] ---\nTranscript bytes.\n--- END [SOURCE_KIND=transcript] [CUSTOM INTERVIEW] ---"
  );
  expect(message).toContain(
    "--- BEGIN [SOURCE_KIND=transcript_digest] [CONDENSED INTERVIEW] ---\nDigest bytes.\n--- END [SOURCE_KIND=transcript_digest] [CONDENSED INTERVIEW] ---"
  );
  expect(message).toContain(
    "--- BEGIN [SOURCE_KIND=project_document] [TEST RECORD] ---\nDocument bytes.\n--- END [SOURCE_KIND=project_document] [TEST RECORD] ---"
  );
  expect(message).not.toContain("writer_storyline");
  expect(message).not.toContain("Excluded bytes.");
});

test("reads a digested transcript through its digest only (cost phase 1)", () => {
  const transcriptId = "transcript-1" as Id<"transcripts">;
  const message = buildBriefUserMessage([
    { kind: "transcript", label: "Interview", content: "FULL-TRANSCRIPT-BYTES", transcriptId },
    { kind: "project_document", label: "Notes", content: "Document bytes." },
    { kind: "transcript_digest", label: "Interview", content: "DIGEST-BYTES", transcriptId },
  ]);
  expect(message).not.toContain("FULL-TRANSCRIPT-BYTES");
  expect(message.indexOf("DIGEST-BYTES")).toBeGreaterThan(-1);
  // The digest takes the transcript's place, ahead of the documents.
  expect(message.indexOf("DIGEST-BYTES")).toBeLessThan(message.indexOf("Document bytes."));
});

test("spends a deterministic budget: per-source cut with a notice, then whole sources omitted", () => {
  const budget = { totalTokens: 10, perSourceTokens: 6 }; // 40 and 24 characters
  const sources = [
    { kind: "transcript", label: "A", content: "a".repeat(30) },
    { kind: "project_document", label: "B", content: "b".repeat(20) },
    { kind: "project_document", label: "C", content: "c".repeat(5) },
    { kind: "project_document", label: "D", content: "" },
  ] satisfies Parameters<typeof buildBriefUserMessage>[0];
  const message = buildBriefUserMessage(sources, budget);
  expect(message).toBe(buildBriefUserMessage(sources, budget));
  // A keeps 24 of 30; B gets the remaining 16 of 20; C gets nothing.
  expect(message).toContain(`${"a".repeat(24)}\n[TRUNCATED: 6 of 30 characters omitted to fit the context budget.]`);
  expect(message).toContain(`${"b".repeat(16)}\n[TRUNCATED: 4 of 20 characters omitted to fit the context budget.]`);
  expect(message).not.toContain("[C] ---");
  // An empty source costs nothing and still shows as a block.
  expect(message).toContain("--- BEGIN [SOURCE_KIND=project_document] [D] ---");
  expect(message.endsWith("[1 further source(s) were omitted to fit the context budget.]")).toBe(true);
  // The default budget never touches ordinary sources.
  expect(buildBriefUserMessage(sources)).not.toContain("TRUNCATED");
  expect(BRIEF_INPUT_BUDGET).toEqual({ totalTokens: 150_000, perSourceTokens: 100_000 });
});

test("serializes reconciliation instructions through the real Brief SDK and persists a representative reconciled response", async () => {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: "brief-sdk-writer",
      role: "admin",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Thermal control reconciliation",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: "brief-sdk-reconciliation-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptIds = [];
    for (const [position, transcript] of transcriptEvidence.entries()) {
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content: transcript.content,
        label: transcript.label,
        position,
        contentHash: transcript.contentHash,
        createdAt: now + position,
      });
      transcriptIds.push(transcriptId);
    }
    const firstTranscriptId = transcriptIds[0];
    if (!firstTranscriptId) throw new Error("Transcript fixture is empty");
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId: firstTranscriptId,
      transcriptIds,
      status: "reserved",
      requestedAt: now,
      requestedBy: userId,
      startedAt: now,
      candidateMode: "single",
      singleModelId: model,
      previousProjectStatus: "draft",
      learningDigestIds: [],
    });
    const sources = [];
    for (const position of [...transcriptEvidence.keys()].reverse()) {
      const transcript = transcriptEvidence[position];
      if (!transcript) throw new Error(`Missing transcript evidence ${position}`);
      const transcriptId = transcriptIds[position];
      if (!transcriptId) throw new Error(`Missing transcript ${position}`);
      const sourceId = await ctx.db.insert("generationSources", {
        projectId,
        generationId,
        kind: "transcript",
        transcriptId,
        label: transcript.label,
        content: transcript.content,
        contentHash: transcript.contentHash,
        truncated: false,
        originalLength: transcript.content.length,
        capturedAt: now + position,
      });
      const source = await ctx.db.get(sourceId);
      if (!source) throw new Error(`Missing frozen source ${position}`);
      sources.push(source);
    }
    return { projectId, generationId, sources };
  });

  const requests: Request[] = [];
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(
      {
        id: "msg_brief_reconciliation",
        type: "message",
        role: "assistant",
        model,
        content: [
          {
            type: "tool_use",
            id: "tool_brief_reconciliation",
            name: BRIEF_REQUEST.toolName,
            input: providerBrief,
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: {
          input_tokens: 211,
          output_tokens: 144,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      { headers: { "request-id": "req_brief_reconciliation" } }
    );
  });
  vi.stubGlobal("fetch", transport);

  const result = await t.action(async (ctx) =>
    deriveOrReuseBrief(
      ctx,
      clientForModel(ctx, model, {
        callSite: "generation:brief",
        projectId: fixture.projectId,
      }),
      {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        model,
      }
    )
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(result.kind).toBe("derived");
  expect(transport).toHaveBeenCalledTimes(1);
  const request = requests[0];
  if (!request) throw new Error("Brief SDK did not reach the HTTP boundary");
  expect(request.url).toBe("https://api.anthropic.com/v1/messages");
  expect(request.method).toBe("POST");
  expect(request.headers.get("x-api-key")).toBe("synthetic-brief-sdk-key");
  const requestBody = requestBodySchema.parse(await request.json());
  expect(requestBody.max_tokens).toBe(8192);
  expect(requestBody).toEqual({
    model,
    max_tokens: BRIEF_REQUEST.maxTokens,
    system: BRIEF_SYSTEM_PROMPT,
    tools: [
      {
        name: BRIEF_REQUEST.toolName,
        description: BRIEF_REQUEST.toolDescription,
        input_schema: BRIEF_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: BRIEF_REQUEST.toolName },
    messages: [
      {
        role: "user",
        content: buildBriefUserMessage(fixture.sources),
      },
    ],
  });
  expect(requestBody.system).toContain(
    "When three or more blocks carry [SOURCE_KIND=transcript], reconcile those Transcripts source by source before writing the Brief."
  );
  expect(requestBody.system).toContain(
    "unreliable (independent evidence shows the source itself is suspect, e.g. it contradicts itself, was explicitly invalidated, or is otherwise independently discredited)."
  );
  expect(requestBody.system).not.toContain("contradicts itself or another source");
  expect(requestBody.system).toContain(
    "Build one coherent Storyline whose common spine is the facts the Transcripts agree on."
  );
  expect(requestBody.system).toContain(
    "Do not exclude a defensible complementary fact merely because only one Transcript reports it"
  );
  expect(requestBody.system).toContain(
    "When the supporting passages for an agreement are materially distinct, preserve source-by-source traceability with separate Confidence Map entries"
  );
  expect(requestBody.system).toContain(
    "If multiple Transcripts contain an identical supporting passage, do not duplicate the same quote merely to claim unique source attribution"
  );
  expect(requestBody.system).toContain(
    "Never average materially conflicting claims, silently choose one, or omit a competing claim."
  );
  expect(requestBody.system).toContain(
    "Before classifying claims as materially conflicting, compare their scope, run, configuration, time, and compatible units."
  );
  expect(requestBody.system).toContain(
    "Compatible measurements made under different conditions are not contradictions."
  );
  expect(requestBody.system).toContain(
    "Ordinary inter-source disagreement is \"unresolved\", not \"unreliable\""
  );
  expect(requestBody.system).toContain(
    "Use \"unreliable\" only when independent evidence gives a reason to distrust the source itself"
  );
  expect(requestBody.system).toContain(
    "A correction that was subsequently withdrawn or retracted, or is independently discredited, does not invalidate the original claim or inform the Storyline."
  );
  expect(requestBody.system).toContain(
    "For each competing claim, use an exact contextual quote that is unique to its originating evidence block when available."
  );
  expect(requestBody.system).toContain(
    "If identical passages or overlapping text make the source unresolvable, state the attribution ambiguity and do not claim unique source provenance."
  );
  expect(requestBody.system).toContain(
    "A correction or retraction resolves only the claim it explicitly corrects or retracts."
  );
  expect(requestBody.system).toContain(
    "A different source merely asserting that a competing claim is wrong, or offering a disputed correction, remains ordinary unresolved disagreement unless independent evidence establishes source unreliability; do not invent an authority or approval hierarchy."
  );
  expect(requestBody.system).toContain(
    "When a supported correction or retraction validly resolves a claim, keep the original claim as \"unreliable\" with its exact quote, and record the explicit correction or retraction separately with its own exact quote."
  );
  expect(requestBody.system).toContain(
    "Reassess every remaining competitor and keep unresolved alternatives separate."
  );
  expect(requestBody.system).toContain(
    "A retraction alone supplies no replacement fact."
  );
  expect(requestBody.system).toContain(
    "If other conflicting alternatives remain, preserve that uncertainty in the Storyline; a replacement is not established solely because it is labeled a correction."
  );
  expect(requestBody.system).toContain(
    "Never infer a correction from recency, plausibility, or source order."
  );
  expect(transcriptEvidence.every(({ label }) => !/transcript/i.test(label))).toBe(true);
  expect(fixture.sources.map(({ label }) => label)).toEqual([
    "Gamma debrief",
    "Beta notes",
    "Alpha interview",
  ]);
  for (const transcript of transcriptEvidence) {
    expect(requestBody.messages[0]?.content).toContain(
      `--- BEGIN [SOURCE_KIND=transcript] [${transcript.label.toUpperCase()}] ---\n${transcript.content}\n--- END [SOURCE_KIND=transcript] [${transcript.label.toUpperCase()}] ---`
    );
  }

  if (result.kind !== "derived") {
    throw new Error(`Expected a derived Brief, received ${result.kind}`);
  }
  const persisted = await t.run(async (ctx) => {
    const brief = await ctx.db.get(result.briefId);
    const generation = await ctx.db.get(fixture.generationId);
    const generationBriefs = await ctx.db
      .query("generationBriefs")
      .withIndex("by_generationId", (q) => q.eq("generationId", fixture.generationId))
      .collect();
    const entries = await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", result.briefId))
      .collect();
    return { brief, generation, generationBriefs, entries };
  });
  expect(persisted.generationBriefs).toHaveLength(1);
  expect(persisted.generationBriefs[0]?._id).toBe(result.briefId);
  expect(persisted.generation?.briefId).toBe(result.briefId);
  expect(persisted.brief).toMatchObject({
    projectId: fixture.projectId,
    generationId: fixture.generationId,
    origin: "derived",
    storylineText: providerBrief.storyline,
    droppedEntryCount: 1,
  });
  const storylineEntries = persisted.entries.filter((entry) => entry.group === "storyline");
  const storylineSourceIndexes = [0, 0, 1, 2] as const;
  const expectedStorylineClaims = providerBrief.storylineClaims.map((claim, index) => {
    const sourceIndex = storylineSourceIndexes[index];
    if (sourceIndex === undefined) throw new Error(`Missing source index ${index}`);
    return { ...claim, sourceIndex };
  });
  expect(storylineEntries).toHaveLength(expectedStorylineClaims.length);
  for (const expected of expectedStorylineClaims) {
    const sourceEvidence = transcriptEvidence[expected.sourceIndex];
    if (!sourceEvidence) throw new Error(`Missing source evidence ${expected.sourceIndex}`);
    const source = fixture.sources.find(
      ({ contentHash }) => contentHash === sourceEvidence.contentHash
    );
    const startOffset = sourceEvidence.content.indexOf(expected.quote);
    expect(startOffset).toBeGreaterThanOrEqual(0);
    const entry = storylineEntries.find((candidate) => candidate.text === expected.text);
    expect(entry).toMatchObject({
      text: expected.text,
      exactExcerpt: expected.quote,
      sourceId: source?._id,
      sourceContentHash: sourceEvidence.contentHash,
      startOffset,
      endOffset: startOffset + expected.quote.length,
    });
  }
  const confidenceEntries = persisted.entries.filter(
    (entry) => entry.group === "confidenceMap"
  );
  expect(confidenceEntries).toHaveLength(6);
  const expectedAgreements = [
    {
      text: "Alpha interview supports the shared control-loop objective.",
      quote: "The project objective was to stabilize the thermal control loop.",
      sourceIndex: 0,
    },
    {
      text: "Beta notes support the shared control-loop objective.",
      quote: "We shared the objective of stabilizing the thermal control loop.",
      sourceIndex: 1,
    },
    {
      text: "Gamma debrief supports the shared control-loop objective.",
      quote: "The agreed objective remained a stable thermal control loop.",
      sourceIndex: 2,
    },
  ];
  const expectedContradictions = [
    {
      text: "Alpha interview reports a 120 ms settling time for run TR-17 under configuration C4.",
      quote: "For thermal run TR-17 using controller configuration C4, the observed settling time was 120 ms.",
      sourceIndex: 0,
    },
    {
      text: "Beta notes report a 230 ms settling time for run TR-17 under configuration C4.",
      quote:
        "Beta instrumentation log states: For thermal run TR-17 using controller configuration C4, settling required 230 ms.",
      sourceIndex: 1,
    },
    {
      text: "Gamma debrief reports a 310 ms settling time for run TR-17 under configuration C4.",
      quote: "For thermal run TR-17 using controller configuration C4, the recorded settling interval was 310 ms.",
      sourceIndex: 2,
    },
  ];
  const sharedCollision = "For thermal run TR-17 using controller configuration C4";
  expect(
    transcriptEvidence.filter(({ content }) => content.includes(sharedCollision))
  ).toHaveLength(3);
  const collidingMeasurement =
    "For thermal run TR-17 using controller configuration C4, settling required 230 ms.";
  expect(
    transcriptEvidence.filter(({ content }) => content.includes(collidingMeasurement))
  ).toHaveLength(2);
  const betaContradiction = expectedContradictions[1];
  if (!betaContradiction) throw new Error("Missing Beta contradiction fixture");
  expect(
    transcriptEvidence.filter(({ content }) =>
      content.includes(betaContradiction.quote)
    )
  ).toHaveLength(1);
  expect(new Set(expectedContradictions.map(({ quote }) => quote)).size).toBe(3);
  for (const expected of expectedAgreements) {
    const entry = confidenceEntries.find((candidate) => candidate.text === expected.text);
    const source = fixture.sources.find(
      ({ contentHash }) => contentHash === transcriptEvidence[expected.sourceIndex]?.contentHash
    );
    expect(entry).toMatchObject({
      confidence: "established",
      exactExcerpt: expected.quote,
      sourceId: source?._id,
      sourceContentHash: transcriptEvidence[expected.sourceIndex]?.contentHash,
    });
  }
  for (const expected of expectedContradictions) {
    const entry = confidenceEntries.find((candidate) => candidate.text === expected.text);
    const source = fixture.sources.find(
      ({ contentHash }) => contentHash === transcriptEvidence[expected.sourceIndex]?.contentHash
    );
    expect(entry).toMatchObject({
      confidence: "unresolved",
      exactExcerpt: expected.quote,
      sourceId: source?._id,
      sourceContentHash: transcriptEvidence[expected.sourceIndex]?.contentHash,
    });
  }
  expect(
    confidenceEntries.some(
      (entry) => entry.text === "A fabricated fourth measurement must be dropped."
    )
  ).toBe(false);

  for (const entry of persisted.entries) {
    const source = await t.run((ctx) => ctx.db.get(entry.sourceId));
    expect(source?.contentHash).toBe(entry.sourceContentHash);
    expect(source?.content.slice(entry.startOffset, entry.endOffset)).toBe(
      entry.exactExcerpt
    );
  }
  expect(await t.run((ctx) => ctx.db.query("aiUsage").collect())).toHaveLength(1);
});
