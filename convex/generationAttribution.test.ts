/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { TranscriptAnalysis } from "./ai/analyzerAgent";
import type {
  GenerationMessageParams,
  GenerationResponse,
} from "./ai/openrouterCore";
import { runPipelineForModel } from "./ai/pipeline";
import { buildTrustedContext, DEFAULT_CONTEXT_BUDGET } from "./ai/trustedContext";
import { CONTEXT_INPUTS_GUIDANCE } from "./ai/prompts";
import { CONDENSE_VERSION } from "./lib/transcripts";
import {
  currentPromptVersion,
  generationPromptProgram,
  hashPromptProgram,
} from "./ai/promptProgram";
import schema from "./schema";
import { sha256 } from "./lib/contracts";
import { buildTiptapDocument } from "./lib/tiptapReport";
import { NO_STYLE_OVERRIDES } from "../shared/styleOverrides";

const modules = import.meta.glob("./**/*.ts");
const AUTH_ID = "generation-attribution-writer";
const PROMPT_VERSION = `sha256:${"a".repeat(64)}`;
const CANDIDATE_DOCUMENT_BODY = "Frozen writer notes for the candidate run.";
const LEGACY_DOCUMENT_BODY = "Unattributed direction frozen before CAP-3.";
const RETRY_PROMPT_VERSION = `sha256:${"b".repeat(64)}`;

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const TEST_ANALYSIS: TranscriptAnalysis = {
  company_context: "Test company",
  project_goal: "Resolve the test uncertainty",
  business_problem: "Existing methods were insufficient",
  scientific_technical_problem: "The technical response was unknown",
  passive_uncertainties: [],
  active_uncertainties: ["Whether the approach could meet the constraint"],
  technological_objective: "Establish a reproducible approach",
  work_performed: {
    prior_year_status: null,
    workplan_steps: ["Build and test the prototype"],
    hypothesis: "The revised control could meet the constraint",
    experiments_iterations: [],
  },
  advancements_achieved: ["Established a repeatable control"],
  remaining_uncertainties: [],
  project_status: "completed",
  unreliable_narrator_flags: [],
  gaps: [],
  useful_quotes: [],
};

const TEST_QA_SCORECARD = {
  overall_score: 88,
  section_scores: {},
  cra_compliance: {},
  hallucination_risks: [],
  ai_language_flags: [],
  superlative_flags: [],
  gaps_requiring_client_followup: [],
  suggested_improvements: [],
};

function generationResponseFor(
  toolName: string | undefined,
): GenerationResponse {
  const input =
    toolName === "submit_transcript_analysis"
      ? TEST_ANALYSIS
      : toolName === "submit_qa_scorecard"
        ? TEST_QA_SCORECARD
        : { entries: [] };
  return toolName
    ? {
        content: [
          {
            type: "tool_use",
            id: `${toolName}-call`,
            name: toolName,
            input,
          },
        ],
      }
    : {
        content: [
          {
            type: "text",
            text: "The team tested the technical uncertainty through controlled prototype trials.",
          },
        ],
      };
}

type ObservedPipelineCall = {
  callSite: string;
  learningDigestIds?: Id<"learningDigests">[];
  params: GenerationMessageParams;
};

function observingPipelineClientFactory(calls: ObservedPipelineCall[]) {
  return (
    callSite: string,
    learningDigestIds?: Id<"learningDigests">[],
  ) => ({
    messages: {
      create: async (params: GenerationMessageParams) => {
        calls.push({
          callSite,
          ...(learningDigestIds
            ? { learningDigestIds: [...learningDigestIds] }
            : {}),
          params,
        });
        return generationResponseFor(params.tool_choice?.name);
      },
    },
  });
}

type OpenRouterRequest = {
  messages?: Array<{ role?: string; content?: string }>;
  tool_choice?: { function?: { name?: string } };
};

function successfulOpenRouterFetch(requests: OpenRouterRequest[], compliance: Record<string, boolean> = {}) {
  return vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
    if (typeof init?.body !== "string") {
      throw new Error("OpenRouter test request had no JSON body");
    }
    const request = JSON.parse(init.body) as OpenRouterRequest;
    requests.push(request);
    const toolName = request.tool_choice?.function?.name;
    const response = generationResponseFor(toolName);
    const tool = response.content.find((block) => block.type === "tool_use");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: tool
              ? {
                  content: null,
                  tool_calls: [
                    {
                      id: tool.id,
                      function: {
                        name: tool.name,
                        arguments: JSON.stringify(toolName === "submit_qa_scorecard" ? { ...TEST_QA_SCORECARD, cra_compliance: compliance } : tool.input),
                      },
                    },
                  ],
                }
              : { content: "provider response" },
            finish_reason: tool ? "tool_calls" : "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          cost: 0,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

async function insertProjectFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: AUTH_ID,
      role: "writer",
      name: "Attribution Writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Attribution project",
      clientName: "Test client",
      status: "draft",
      createdBy: userId,
      shareToken: "generation-attribution-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "A usable interview transcript.",
      createdAt: now,
    });
    return { now, userId, projectId, transcriptId };
  });
}

/**
 * The analyzer user message the production path builds — delimited, guided
 * and budgeted — so the fixture cannot drift from the real shape.
 */
function analyzerMessageFor(transcript: string): string {
  return buildTrustedContext({
    transcriptParts: [{ label: "Interview transcript", content: transcript }],
  }).userMessage;
}

async function insertDigest(
  t: ReturnType<typeof convexTest>,
  input: {
    kind: "qa_calibration" | "draft_style";
    content: string;
    ordinal: number;
  },
) {
  return await t.run((ctx) =>
    ctx.db.insert("learningDigests", {
      kind: input.kind,
      content: input.content,
      sourceCount: 1,
      feedbackCutoff: input.ordinal,
      model: "test-model",
      createdAt: input.ordinal,
    }),
  );
}

async function insertCompletedPostQaFixture(
  t: ReturnType<typeof convexTest>,
  input: {
    promptVersion: string;
    calibrationContent: string;
    includeExistingDigest?: boolean;
    legacy?: boolean;
  },
) {
  const fixture = await insertProjectFixture(t);
  const olderCalibrationId = await insertDigest(t, {
    kind: "qa_calibration",
    content: "OLDER CALIBRATION MUST NOT BE SENT",
    ordinal: 100,
  });
  const calibrationId = await insertDigest(t, {
    kind: "qa_calibration",
    content: input.calibrationContent,
    ordinal: 200,
  });
  const existingDigestId = input.includeExistingDigest
    ? await insertDigest(t, {
        kind: "draft_style",
        content: "Style guidance sent while the report was drafted.",
        ordinal: 50,
      })
    : undefined;
  const generationId = await t.run(async (ctx) => {
    await ctx.db.insert("learningDigestSelections", {
      kind: "qa_calibration",
      selectedDigestId: calibrationId,
      actorKind: "user",
      actorUserId: fixture.userId,
      action: "select",
      reason: "Publish the live post-QA calibration",
      selectedAt: 300,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId: fixture.projectId,
      transcriptId: fixture.transcriptId,
      status: "completed",
      requestedBy: fixture.userId,
      candidateMode: "single",
      singleModelId: "openai/gpt-5.6-luna",
      ...(input.legacy
        ? {}
        : {
            promptVersion: input.promptVersion,
            learningDigestIds: existingDigestId ? [existingDigestId] : [],
          }),
      agentOutputs: JSON.stringify({
        analyzer: TEST_ANALYSIS,
        section242: "A technical uncertainty was identified.",
        section244: "The team tested a prototype through controlled trials.",
        section246: "The trials established a repeatable technical capability.",
        styleOverrides: NO_STYLE_OVERRIDES,
      }),
      postQaStatus: "running",
      postQaStartedAt: fixture.now,
      startedAt: fixture.now - 100,
      completedAt: fixture.now,
    });
    await ctx.db.patch(fixture.projectId, {
      activeGenerationId: generationId,
      status: "review",
    });
    await ctx.db.insert("reports", {
      projectId: fixture.projectId,
      generationId,
      sourceTranscriptId: fixture.transcriptId,
      content: "Completed report content",
      version: 1,
      generatedAt: fixture.now,
      updatedAt: fixture.now,
    });
    await ctx.db.insert("modelSelections", {
      projectId: fixture.projectId,
      generationId,
      userId: AUTH_ID,
      model: "openai/gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      createdAt: fixture.now,
    });
    return generationId;
  });
  return {
    ...fixture,
    generationId,
    olderCalibrationId,
    calibrationId,
    existingDigestId,
  };
}

describe("generation provenance", () => {
  it("stamps the same current program hash for distinct runtime inputs before any provider handoff", async () => {
    const t = convexTest(schema, modules);
    const runtimeRows = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        authId: AUTH_ID,
        role: "writer",
        name: "Attribution Writer",
      });
      const rows = [];
      for (const [index, runtime] of [
        {
          title: "Alpha project",
          transcript: "Alpha transcript with a unique technical account.",
          report: "Alpha historical report.",
          digest: "Alpha runtime learning content.",
        },
        {
          title: "Beta project",
          transcript: "Beta transcript describing different experiments.",
          report: "Beta historical report.",
          digest: "Beta runtime learning content.",
        },
      ].entries()) {
        const projectId = await ctx.db.insert("projects", {
          title: runtime.title,
          clientName: `Client ${index + 1}`,
          // Stops after the entry action has loaded the frozen runtime input,
          // but before any provider create. The prompt stamp must already be
          // durable at that point.
          scienceCode: `invalid-science-code-${index + 1}`,
          status: "draft",
          createdBy: userId,
          shareToken: `stable-program-${index + 1}`,
          createdAt: now + index,
          updatedAt: now + index,
        });
        const transcriptId = await ctx.db.insert("transcripts", {
          projectId,
          content: runtime.transcript,
          createdAt: now + index,
        });
        const generationId = await ctx.db.insert("generations", {
          projectId,
          transcriptId,
          status: "reserved",
          requestedAt: now + index,
          requestedBy: userId,
          candidateMode: "single",
          singleModelId: "claude-sonnet-5",
          learningDigestIds: [],
          startedAt: now + index,
        });
        await ctx.db.patch(projectId, {
          activeGenerationId: generationId,
          status: "generating",
        });
        await ctx.db.insert("generationSources", {
          generationId,
          projectId,
          kind: "transcript",
          transcriptId,
          label: "Interview transcript",
          content: runtime.transcript,
          contentHash: `runtime-hash-${index + 1}`,
          truncated: false,
          originalLength: runtime.transcript.length,
          capturedAt: now + index,
        });
        await ctx.db.insert("reports", {
          projectId,
          content: runtime.report,
          version: 1,
          generatedAt: now + index,
          updatedAt: now + index,
        });
        await ctx.db.insert("learningDigests", {
          kind: index === 0 ? "draft_style" : "qa_calibration",
          content: runtime.digest,
          sourceCount: 1,
          feedbackCutoff: now + index,
          model: "test-model",
          createdAt: now + index,
        });
        rows.push({
          generationId,
          projectId,
          transcript: runtime.transcript,
          report: runtime.report,
          digest: runtime.digest,
        });
      }
      return rows;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const row of runtimeRows) {
      await t.action(internal.ai.pipeline.generateReport, {
        generationId: row.generationId,
      });
    }

    const expectedVersion = await currentPromptVersion();
    const generations = await t.run(async (ctx) =>
      Promise.all(runtimeRows.map((row) => ctx.db.get(row.generationId))),
    );
    expect(new Set(runtimeRows.map((row) => row.transcript)).size).toBe(2);
    expect(new Set(runtimeRows.map((row) => row.report)).size).toBe(2);
    expect(new Set(runtimeRows.map((row) => row.digest)).size).toBe(2);
    expect(generations.map((row) => row?.promptVersion)).toEqual([
      expectedVersion,
      expectedVersion,
    ]);
    expect(expectedVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Both runs stop at the invalid science code, after the stamp and before
    // any provider call; the assertion names that cause so a different early
    // failure cannot masquerade as this scenario.
    expect(generations.every((row) => row?.status === "failed")).toBe(true);
    expect(
      generations.every((row) =>
        row?.error?.endsWith(
          "Project science code is not a valid CRA T4088 line 206 code",
        ),
      ),
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("initializes a new reservation with an empty digest union and stamps its version during begin", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const generationId = await t
      .withIdentity({ subject: AUTH_ID })
      .mutation(api.generations.requestGeneration, {
        projectId: fixture.projectId,
        candidateMode: "single",
        singleModelId: "claude-sonnet-5",
      });

    const reserved = await t.run((ctx) => ctx.db.get(generationId));
    expect(reserved).toMatchObject({
      status: "reserved",
      learningDigestIds: [],
    });
    expect(reserved?.promptVersion).toBeUndefined();

    await expect(
      t.mutation(internal.generations.beginGeneration, {
        generationId,
        promptVersion: "not-a-prompt-hash",
      }),
    ).rejects.toThrow("Invalid promptVersion hash");
    expect((await t.run((ctx) => ctx.db.get(generationId)))?.status).toBe(
      "reserved",
    );

    await expect(
      t.mutation(internal.generations.beginGeneration, {
        generationId,
        promptVersion: PROMPT_VERSION,
      }),
    ).resolves.toBe(true);

    const running = await t.run((ctx) => ctx.db.get(generationId));
    expect(running).toMatchObject({
      status: "running",
      promptVersion: PROMPT_VERSION,
      learningDigestIds: [],
    });
    expect(running?.promptVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("keeps legacy reservations compatible and does not backfill provenance", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const legacyId = await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "reserved",
        startedAt: fixture.now,
      });
      await ctx.db.patch(fixture.projectId, {
        activeGenerationId: generationId,
      });
      return generationId;
    });

    await expect(
      t.mutation(internal.generations.beginGeneration, {
        generationId: legacyId,
        promptVersion: PROMPT_VERSION,
      }),
    ).resolves.toBe(true);

    const legacy = await t.run((ctx) => ctx.db.get(legacyId));
    expect(legacy?.status).toBe("running");
    expect(legacy?.promptVersion).toBeUndefined();
    expect(legacy?.learningDigestIds).toBeUndefined();

    await t.run((ctx) => ctx.db.delete(legacyId));
    await expect(
      t.mutation(internal.generations.unionLearningDigestIds, {
        generationId: legacyId,
        digestIds: [],
      }),
    ).rejects.toThrow("Generation not found for learning digest handoff");
  });

  it("unions only handed-off digest ids, deduplicates races, and permits post-terminal QA", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const [styleId, qaId, postQaId, blankFetchedId] = await Promise.all([
      insertDigest(t, {
        kind: "draft_style",
        content: "Use the learned drafting style.",
        ordinal: 1,
      }),
      insertDigest(t, {
        kind: "qa_calibration",
        content: "Calibrate QA to senior review time.",
        ordinal: 2,
      }),
      insertDigest(t, {
        kind: "qa_calibration",
        content: "New live calibration used by completed-generation QA.",
        ordinal: 3,
      }),
      insertDigest(t, {
        kind: "draft_style",
        content: "   ",
        ordinal: 4,
      }),
    ]);
    const { trackedId, legacyId } = await t.run(async (ctx) => {
      const trackedId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "completed",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
        completedAt: fixture.now,
      });
      const legacyId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "completed",
        startedAt: fixture.now,
        completedAt: fixture.now,
      });
      return { trackedId, legacyId };
    });

    // Fetching blank guidance, skipping a call, or failing before handoff never
    // invokes the union mutation, so the new-format marker remains empty.
    expect((await t.run((ctx) => ctx.db.get(trackedId)))?.learningDigestIds).toEqual(
      [],
    );

    await Promise.all([
      t.mutation(internal.generations.unionLearningDigestIds, {
        generationId: trackedId,
        digestIds: [styleId],
      }),
      t.mutation(internal.generations.unionLearningDigestIds, {
        generationId: trackedId,
        digestIds: [qaId, styleId],
      }),
      t.mutation(internal.generations.unionLearningDigestIds, {
        generationId: trackedId,
        digestIds: [styleId],
      }),
    ]);
    // A completed row deliberately accepts a later live post-QA calibration.
    await t.mutation(internal.generations.unionLearningDigestIds, {
      generationId: trackedId,
      digestIds: [postQaId, qaId],
    });
    await t.mutation(internal.generations.unionLearningDigestIds, {
      generationId: legacyId,
      digestIds: [styleId, qaId, postQaId, blankFetchedId],
    });

    const expected = [styleId, qaId, postQaId].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const state = await t.run(async (ctx) => ({
      tracked: await ctx.db.get(trackedId),
      legacy: await ctx.db.get(legacyId),
    }));
    expect(state.tracked?.learningDigestIds).toEqual(expected);
    // The blank digest was only ever handed to the legacy row; the mutation
    // records whatever ids it is given, so keeping a blank digest out of a
    // tracked union is the call sites' job (covered by the payload suite).
    expect(state.legacy?.promptVersion).toBeUndefined();
    expect(state.legacy?.learningDigestIds).toBeUndefined();
  });

  it("creates retry generations with independent provenance", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const oldDigestId = await insertDigest(t, {
      kind: "draft_style",
      content: "Guidance used only by the failed attempt.",
      ordinal: 10,
    });
    const failedId = await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "failed",
        requestedBy: fixture.userId,
        candidateMode: "single",
        singleModelId: "claude-sonnet-5",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [oldDigestId],
        startedAt: fixture.now,
        completedAt: fixture.now,
        error: "provider failed",
      });
      await ctx.db.patch(fixture.projectId, {
        status: "draft",
        activeGenerationId: generationId,
      });
      return generationId;
    });

    const retryId = await t
      .withIdentity({ subject: AUTH_ID })
      .mutation(api.generations.retryGeneration, { generationId: failedId });
    const reservedRetry = await t.run((ctx) => ctx.db.get(retryId));
    expect(reservedRetry).toMatchObject({
      status: "reserved",
      retryOfGenerationId: failedId,
      learningDigestIds: [],
    });
    expect(reservedRetry?.promptVersion).toBeUndefined();

    await t.mutation(internal.generations.beginGeneration, {
      generationId: retryId,
      promptVersion: RETRY_PROMPT_VERSION,
    });
    await t.mutation(internal.aiUsage.logUsage, {
      generationId: failedId,
      durationMs: 21,
      callSite: "generation:failed-attempt",
      model: "claude-sonnet-5",
      inputTokens: 10,
      outputTokens: 2,
      createdAt: fixture.now + 1,
    });
    await t.mutation(internal.aiUsage.logUsage, {
      generationId: retryId,
      durationMs: 34,
      callSite: "generation:retry-attempt",
      model: "claude-sonnet-5",
      inputTokens: 12,
      outputTokens: 3,
      createdAt: fixture.now + 2,
    });
    const state = await t.run(async (ctx) => ({
      failed: await ctx.db.get(failedId),
      retry: await ctx.db.get(retryId),
      failedUsage: await ctx.db
        .query("aiUsage")
        .withIndex("by_generationId", (q) => q.eq("generationId", failedId))
        .collect(),
      retryUsage: await ctx.db
        .query("aiUsage")
        .withIndex("by_generationId", (q) => q.eq("generationId", retryId))
        .collect(),
    }));
    expect(state.failed?.promptVersion).toBe(PROMPT_VERSION);
    expect(state.failed?.learningDigestIds).toEqual([oldDigestId]);
    expect(state.retry?.promptVersion).toBe(RETRY_PROMPT_VERSION);
    expect(state.retry?.learningDigestIds).toEqual([]);
    expect(state.failedUsage).toEqual([
      expect.objectContaining({
        generationId: failedId,
        callSite: "generation:failed-attempt",
        durationMs: 21,
      }),
    ]);
    expect(state.retryUsage).toEqual([
      expect.objectContaining({
        generationId: retryId,
        callSite: "generation:retry-attempt",
        durationMs: 34,
      }),
    ]);
  });
});

describe("generation payload provenance", () => {
  it("omits blank digest ids at actual pipeline creates and pairs nonblank ids with only their payloads", async () => {
    const t = convexTest(schema, modules);
    const [blankStyleId, blankQaId, styleId, qaId] = await Promise.all([
      insertDigest(t, {
        kind: "draft_style",
        content: "   ",
        ordinal: 301,
      }),
      insertDigest(t, {
        kind: "qa_calibration",
        content: "\n\t",
        ordinal: 302,
      }),
      insertDigest(t, {
        kind: "draft_style",
        content: "Prefer concrete descriptions of the experiment.",
        ordinal: 303,
      }),
      insertDigest(t, {
        kind: "qa_calibration",
        content: "Do not flag supported technical detail as excessive.",
        ordinal: 304,
      }),
    ]);
    const blankCalls: ObservedPipelineCall[] = [];

    await runPipelineForModel(
      observingPipelineClientFactory(blankCalls),
      "claude-sonnet-5",
      "A runtime transcript",
      analyzerMessageFor("A runtime transcript"),
      "Runtime title",
      { analyzer: "", s242: "", s244: "", s246: "" },
      "standard",
      "\n\t",
      "   ",
      blankQaId,
      blankStyleId,
    );

    expect(blankCalls.map((call) => call.callSite).sort()).toEqual([
      "generation:analyzer",
      "generation:chronology",
      "generation:qa",
      "generation:section:242",
      "generation:section:244",
      "generation:section:246",
    ]);
    expect(
      blankCalls.every((call) => call.learningDigestIds === undefined),
    ).toBe(true);
    expect(
      JSON.stringify(blankCalls.map((call) => call.params)),
    ).not.toContain("Reviewer Calibration");

    const pairedCalls: ObservedPipelineCall[] = [];
    await runPipelineForModel(
      observingPipelineClientFactory(pairedCalls),
      "claude-sonnet-5",
      "A different runtime transcript",
      analyzerMessageFor("A different runtime transcript"),
      "A different runtime title",
      { analyzer: "", s242: "", s244: "", s246: "" },
      "standard",
      "Do not flag supported technical detail as excessive.",
      "Prefer concrete descriptions of the experiment.",
      qaId,
      styleId,
    );

    const idsByCallSite = Object.fromEntries(
      pairedCalls.map((call) => [call.callSite, call.learningDigestIds]),
    );
    expect(idsByCallSite).toEqual({
      "generation:analyzer": undefined,
      "generation:section:242": [styleId],
      "generation:section:244": [styleId],
      "generation:section:246": [styleId],
      "generation:qa": [qaId],
      "generation:chronology": undefined,
    });
    const sectionRequests = pairedCalls.filter((call) =>
      call.callSite.startsWith("generation:section:"),
    );
    expect(
      sectionRequests.every((call) =>
        JSON.stringify(call.params).includes(
          "Prefer concrete descriptions of the experiment.",
        ),
      ),
    ).toBe(true);
    const qaRequest = pairedCalls.find(
      (call) => call.callSite === "generation:qa",
    );
    expect(JSON.stringify(qaRequest?.params)).toContain(
      "Do not flag supported technical detail as excessive.",
    );
  });

  it("settles stale QA without attribution and permits a fenced retry", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const fixture = await insertCompletedPostQaFixture(t, { promptVersion: PROMPT_VERSION, calibrationContent: "" });
      await t.run(ctx => ctx.db.patch(fixture.projectId, { ownerId: fixture.userId }));
      const input = await t.query(internal.generations.getPostQaInput, { generationId: fixture.generationId });
      if (!input) throw new Error("Missing QA input");
      const response = successfulOpenRouterFetch([], { why_how_why_intact: false });
      let edited = false;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { body?: unknown }) => {
        if (!edited) {
          edited = true;
          await t.withIdentity({ subject: AUTH_ID }).mutation(api.reports.updateReportContent, {
            reportId: input.capturedRef.reportId,
            content: "Human corrected content",
            expectedRevisionNumber: 0,
          });
        }
        return response(url, init);
      }));
      await t.action(internal.ai.postQa.runReportQa, { generationId: fixture.generationId, attemptStartedAt: fixture.now });
      expect((await t.run(ctx => ctx.db.get(fixture.generationId)))?.postQaStatus).toBe("failed");
      expect(await t.run(ctx => ctx.db.query("qaFindings").collect())).not.toEqual(expect.arrayContaining([expect.objectContaining({ check: "cra_methodology" })]));
      const beforeRetry = await t.run(ctx => ctx.db.get(fixture.generationId));
      expect(JSON.parse(beforeRetry?.agentOutputs ?? "{}").qa).toBeUndefined();
      vi.stubGlobal("fetch", successfulOpenRouterFetch([], { why_how_why_intact: true }));
      await t.withIdentity({ subject: AUTH_ID }).mutation(api.generations.requestReportQa, { generationId: fixture.generationId });
      const retry = await t.run(ctx => ctx.db.get(fixture.generationId));
      expect(retry?.postQaStatus).toBe("running");
      expect(retry?.postQaStartedAt).toBeGreaterThan(fixture.now);
      // A late failure from the old attempt cannot release the new retry lock.
      await t.mutation(internal.generations.saveReportQa, {
        generationId: fixture.generationId, attemptStartedAt: fixture.now,
        capturedRef: input.capturedRef, failed: true,
      });
      expect(await t.run(ctx => ctx.db.get(fixture.generationId))).toEqual(retry);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const completed = await t.run(ctx => ctx.db.get(fixture.generationId));
      expect(completed?.postQaStatus).toBe("done");
      // Neither a duplicate old action nor its completion may overwrite success.
      await t.action(internal.ai.postQa.runReportQa, { generationId: fixture.generationId, attemptStartedAt: fixture.now });
      await t.mutation(internal.generations.saveReportQa, {
        generationId: fixture.generationId, attemptStartedAt: fixture.now,
        capturedRef: input.capturedRef, qa: JSON.stringify({ ...TEST_QA_SCORECARD, cra_compliance: { why_how_why_intact: false } }),
      });
      expect(await t.run(ctx => ctx.db.get(fixture.generationId))).toEqual(completed);
    } finally { vi.useRealTimers(); }
  });

  it("settles empty QA input and recovers after content is restored", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const fixture = await insertCompletedPostQaFixture(t, { promptVersion: PROMPT_VERSION, calibrationContent: "" });
      await t.run(ctx => ctx.db.patch(fixture.projectId, { ownerId: fixture.userId }));
      const report = await t.run(ctx => ctx.db.query("reports").unique());
      if (!report) throw new Error("Missing report");
      await t.run(ctx => ctx.db.patch(report._id, { content: JSON.stringify({ type: "doc", content: [] }) }));
      const fetch = successfulOpenRouterFetch([]);
      vi.stubGlobal("fetch", fetch);
      await t.action(internal.ai.postQa.runReportQa, { generationId: fixture.generationId, attemptStartedAt: fixture.now });
      expect(fetch).not.toHaveBeenCalled();
      expect((await t.run(ctx => ctx.db.get(fixture.generationId)))?.postQaStatus).toBe("failed");
      await t.withIdentity({ subject: AUTH_ID }).mutation(api.reports.updateReportContent, {
        reportId: report._id, content: "Restored prose", expectedRevisionNumber: 0,
      });
      await t.withIdentity({ subject: AUTH_ID }).mutation(api.generations.requestReportQa, { generationId: fixture.generationId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await t.run(ctx => ctx.db.get(fixture.generationId)))?.postQaStatus).toBe("done");
      expect(fetch).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("iterative QA captures all current sections instead of frozen approved runs", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertCompletedPostQaFixture(t, { promptVersion: PROMPT_VERSION, calibrationContent: "" });
    const content = JSON.stringify(buildTiptapDocument("Current report", "Current uncertainty", "Current investigation", "Current advancement"));
    const reportId = await t.run(async ctx => {
      await ctx.db.patch(fixture.generationId, { candidateMode: "iterative" });
      for (const kind of ["analysis", "brain_blocks"] as const) {
        await ctx.db.insert("generationArtifacts", { generationId: fixture.generationId, kind, content: JSON.stringify(kind === "analysis" ? TEST_ANALYSIS : { styleOverrides: NO_STYLE_OVERRIDES }) });
      }
      for (const section of ["s242", "s244", "s246"] as const) {
        await ctx.db.insert("generationSectionRuns", {
          generationId: fixture.generationId, projectId: fixture.projectId, section,
          status: "approved", approvedText: `Frozen approved ${section}`,
          model: "openai/gpt-5.6-luna", label: "Luna", attempt: 1, queuedAt: fixture.now,
        });
      }
      const report = await ctx.db.query("reports").unique();
      if (!report) throw new Error("Missing report");
      await ctx.db.patch(report._id, { content, revisionNumber: 3 });
      return report._id;
    });
    const input = await t.query(internal.generations.getPostQaInput, { generationId: fixture.generationId });
    expect(input?.section242.trim()).toBe("Current uncertainty");
    expect(input?.section244.trim()).toBe("Current investigation");
    expect(input?.section246.trim()).toBe("Current advancement");
    expect(input?.capturedRef).toEqual({ reportId, revisionNumber: 3, contentHash: await sha256(content) });
  });

  it("post-QA provider methodology failures persist and block current readiness and publishing", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertCompletedPostQaFixture(t, { promptVersion: PROMPT_VERSION, calibrationContent: "" });
    await t.run(ctx => ctx.db.patch(fixture.projectId, { ownerId: fixture.userId }));
    vi.stubGlobal("fetch", successfulOpenRouterFetch([], { why_how_why_intact: false }));
    await t.action(internal.ai.postQa.runReportQa, { generationId: fixture.generationId });
    const report = await t.run(ctx => ctx.db.query("reports").unique());
    if (!report) throw new Error("Missing report");
    const findings = await t.run(ctx => ctx.db.query("qaFindings").collect());
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ reportId: report._id, revisionNumber: 0, contentHash: await sha256(report.content), check: "cra_methodology", blocking: true })]));
    const actor = t.withIdentity({ subject: AUTH_ID });
    const readiness = await actor.query(api.projects.getProjectReadiness, { projectId: fixture.projectId, reportId: report._id });
    expect(readiness?.blockers.map(row => row.code)).toContain("QA_BLOCKING");
    await expect(actor.mutation(api.projects.publishForReview, { projectId: fixture.projectId, reportId: report._id })).rejects.toMatchObject({ data: { code: "QA_BLOCKING" } });
  });

  it("fetches but omits a selected blank post-QA digest through the real provider path", async () => {
    const currentVersion = await currentPromptVersion();
    const t = convexTest(schema, modules);
    const fixture = await insertCompletedPostQaFixture(t, {
      promptVersion: currentVersion,
      calibrationContent: " \n\t ",
    });
    const active = await t.query(internal.learning.getActiveDigest, {
      kind: "qa_calibration",
    });
    expect(active?._id).toBe(fixture.calibrationId);
    expect(active?.content.trim()).toBe("");
    const requests: OpenRouterRequest[] = [];
    const fetchMock = successfulOpenRouterFetch(requests);
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.ai.postQa.runReportQa, {
      generationId: fixture.generationId,
    });

    const generation = await t.run((ctx) =>
      ctx.db.get(fixture.generationId),
    );
    const qaRequest = requests.find(
      (request) =>
        request.tool_choice?.function?.name === "submit_qa_scorecard",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(qaRequest).toBeDefined();
    expect(JSON.stringify(qaRequest)).not.toContain("Reviewer Calibration");
    expect(generation?.learningDigestIds).toEqual([]);
    expect(generation?.postQaStatus).toBe("done");
  });

  it("uses the live post-QA calibration, unions exactly its id after completion, and preserves the stamped deployment hash", async () => {
    const currentVersion = await currentPromptVersion();
    const priorDeploymentVersion = await hashPromptProgram({
      ...generationPromptProgram,
      contractId: "banhall.generation-prompt-program/test-prior-deployment",
    });
    expect(priorDeploymentVersion).not.toBe(currentVersion);
    const t = convexTest(schema, modules);
    const liveCalibration =
      "LIVE CALIBRATION SELECTED AFTER THIS GENERATION COMPLETED";
    const fixture = await insertCompletedPostQaFixture(t, {
      promptVersion: priorDeploymentVersion,
      calibrationContent: liveCalibration,
      includeExistingDigest: true,
    });
    const requests: OpenRouterRequest[] = [];
    const fetchMock = successfulOpenRouterFetch(requests);
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.ai.postQa.runReportQa, {
      generationId: fixture.generationId,
    });

    const generation = await t.run((ctx) =>
      ctx.db.get(fixture.generationId),
    );
    const qaRequest = requests.find(
      (request) =>
        request.tool_choice?.function?.name === "submit_qa_scorecard",
    );
    const expectedDigestIds = [
      fixture.existingDigestId,
      fixture.calibrationId,
    ]
      .filter((id): id is Id<"learningDigests"> => id !== undefined)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(qaRequest)).toContain(liveCalibration);
    expect(JSON.stringify(qaRequest)).not.toContain(
      "OLDER CALIBRATION MUST NOT BE SENT",
    );
    expect(generation?.learningDigestIds).toEqual(expectedDigestIds);
    expect(generation?.learningDigestIds).not.toContain(
      fixture.olderCalibrationId,
    );
    expect(generation?.promptVersion).toBe(priorDeploymentVersion);
    expect(generation?.promptVersion).not.toBe(currentVersion);
    expect(generation?.status).toBe("completed");
    expect(generation?.postQaStatus).toBe("done");
    expect(generation?.qaScore).toBe(TEST_QA_SCORECARD.overall_score);
  });

  it("keeps live calibration selection for legacy completed post-QA without backfilling provenance", async () => {
    const t = convexTest(schema, modules);
    const liveCalibration = "LIVE CALIBRATION FOR A LEGACY COMPLETED REPORT";
    const fixture = await insertCompletedPostQaFixture(t, {
      promptVersion: PROMPT_VERSION,
      calibrationContent: liveCalibration,
      legacy: true,
    });
    const requests: OpenRouterRequest[] = [];
    const fetchMock = successfulOpenRouterFetch(requests);
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.ai.postQa.runReportQa, {
      generationId: fixture.generationId,
    });

    const generation = await t.run((ctx) =>
      ctx.db.get(fixture.generationId),
    );
    const qaRequest = requests.find(
      (request) =>
        request.tool_choice?.function?.name === "submit_qa_scorecard",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(qaRequest)).toContain(liveCalibration);
    expect(JSON.stringify(qaRequest)).not.toContain(
      "OLDER CALIBRATION MUST NOT BE SENT",
    );
    expect(generation?.promptVersion).toBeUndefined();
    expect(generation?.learningDigestIds).toBeUndefined();
    expect(generation?.status).toBe("completed");
    expect(generation?.postQaStatus).toBe("done");
  });
});

describe("generation-owned usage persistence", () => {
  it("persists generation and candidate attribution and reads it through by_generationId", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const ids = await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "running",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
      });
      const otherGenerationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "running",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
      });
      const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId: fixture.projectId,
        model: "claude-sonnet-5",
        label: "Candidate",
        status: "running",
        queuedAt: fixture.now,
        startedAt: fixture.now,
      });
      await ctx.db.insert("aiUsage", {
        callSite: "legacy:unattributed",
        model: "legacy-model",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        createdAt: fixture.now,
      });
      return { generationId, otherGenerationId, candidateRunId };
    });

    await t.mutation(internal.aiUsage.logUsage, {
      projectId: fixture.projectId,
      generationId: ids.generationId,
      candidateRunId: ids.candidateRunId,
      durationMs: 0,
      callSite: "generation:candidate:242",
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0,
      createdAt: fixture.now + 1,
    });
    await t.mutation(internal.aiUsage.logUsage, {
      generationId: ids.generationId,
      durationMs: 17,
      callSite: "generation:post-qa",
      model: "claude-sonnet-5",
      inputTokens: 4,
      outputTokens: 2,
      createdAt: fixture.now + 2,
    });
    await t.mutation(internal.aiUsage.logUsage, {
      generationId: ids.otherGenerationId,
      durationMs: 3,
      callSite: "generation:other",
      model: "claude-sonnet-5",
      inputTokens: 8,
      outputTokens: 3,
      createdAt: fixture.now + 3,
    });

    const state = await t.run(async (ctx) => ({
      rows: await ctx.db
        .query("aiUsage")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", ids.generationId),
        )
        .take(10),
      legacy: await ctx.db
        .query("aiUsage")
        .withIndex("by_createdAt", (q) => q.eq("createdAt", fixture.now))
        .unique(),
    }));

    expect(state.rows).toHaveLength(2);
    expect(state.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generationId: ids.generationId,
          candidateRunId: ids.candidateRunId,
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          costUsd: 0,
        }),
        expect.objectContaining({
          generationId: ids.generationId,
          durationMs: 17,
          callSite: "generation:post-qa",
        }),
      ]),
    );
    const postQa = state.rows.find(
      (row) => row.callSite === "generation:post-qa",
    );
    expect(postQa?.candidateRunId).toBeUndefined();
    expect(state.legacy).toMatchObject({
      callSite: "legacy:unattributed",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(state.legacy?.generationId).toBeUndefined();
    expect(state.legacy?.candidateRunId).toBeUndefined();
    expect(state.legacy?.durationMs).toBeUndefined();
  });
});

describe("iterative style digest provenance", () => {
  async function insertIterativeGeneration(t: ReturnType<typeof convexTest>) {
    const fixture = await insertProjectFixture(t);
    const generationId = await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "running",
        requestedBy: fixture.userId,
        candidateMode: "iterative",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
      });
      await ctx.db.patch(fixture.projectId, {
        activeGenerationId: generationId,
        status: "generating",
      });
      return generationId;
    });
    return { ...fixture, generationId };
  }

  it("freezes the nonblank style digest id beside its guidance and restores it for section input", async () => {
    const t = convexTest(schema, modules);
    const { generationId } = await insertIterativeGeneration(t);
    const styleId = await insertDigest(t, {
      kind: "draft_style",
      content: "Frozen style guidance.",
      ordinal: 10,
    });

    await t.mutation(internal.generations.saveIterativeArtifacts, {
      generationId,
      analysis: JSON.stringify(TEST_ANALYSIS),
      brainBlocks: JSON.stringify({
        blocks: { s242: "exemplar block" },
        styleGuidance: "Frozen style guidance.",
        draftStyleDigestId: styleId,
        styleOverrides: NO_STYLE_OVERRIDES,
      }),
    });

    const input = await t.query(internal.generations.getIterativeSectionInput, {
      generationId,
      section: "s242",
    });
    expect(input?.draftStyleDigestId).toBe(styleId);
    expect(input?.styleGuidance).toBe("Frozen style guidance.");
    expect(input?.brainBlock).toBe("exemplar block");
  });

  it("restores no style digest id from a legacy or blank-style artifact", async () => {
    const t = convexTest(schema, modules);
    const { generationId } = await insertIterativeGeneration(t);

    await t.mutation(internal.generations.saveIterativeArtifacts, {
      generationId,
      analysis: JSON.stringify(TEST_ANALYSIS),
      brainBlocks: JSON.stringify({ blocks: {}, styleGuidance: "" }),
    });
    const legacy = await t.query(internal.generations.getIterativeSectionInput, {
      generationId,
      section: "s242",
    });
    expect(legacy).not.toBeNull();
    expect(legacy?.draftStyleDigestId).toBeUndefined();
    expect(legacy?.styleGuidance).toBe("");

    await t.mutation(internal.generations.saveIterativeArtifacts, {
      generationId,
      analysis: JSON.stringify(TEST_ANALYSIS),
      brainBlocks: JSON.stringify({
        blocks: {},
        styleGuidance: "",
        draftStyleDigestId: "not-a-learning-digest-id",
      }),
    });
    const malformed = await t.query(
      internal.generations.getIterativeSectionInput,
      { generationId, section: "s242" },
    );
    expect(malformed?.draftStyleDigestId).toBeUndefined();
  });
});

describe("generation entry handoffs through the real actions", () => {
  const OPENROUTER_MODEL = "openai/gpt-5.6-luna";
  const sortIds = (ids: Id<"learningDigests">[]) =>
    [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Usage rows are scheduled with runAfter(0); yield one macrotask so those
  // timers fire, then let the in-flight scheduled mutations finish.
  const flushScheduledUsage = async (t: ReturnType<typeof convexTest>) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  };

  it("pairs scheduled candidate digest ids with their payloads and attributes usage to the candidate run", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const styleText = "CANDIDATE STYLE DIGEST TEXT";
    const qaText = "CANDIDATE QA CALIBRATION TEXT";
    const [styleId, qaId] = await Promise.all([
      insertDigest(t, { kind: "draft_style", content: styleText, ordinal: 401 }),
      insertDigest(t, { kind: "qa_calibration", content: qaText, ordinal: 402 }),
    ]);
    const { generationId, candidateRunId } = await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "running",
        requestedBy: fixture.userId,
        candidateMode: "single",
        singleModelId: OPENROUTER_MODEL,
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
      });
      await ctx.db.patch(fixture.projectId, {
        activeGenerationId: generationId,
        status: "generating",
      });
      await ctx.db.insert("generationSources", {
        generationId,
        projectId: fixture.projectId,
        kind: "transcript",
        transcriptId: fixture.transcriptId,
        label: "Interview transcript",
        content: "A usable interview transcript.",
        contentHash: "candidate-transcript-hash",
        truncated: false,
        originalLength: 30,
        capturedAt: fixture.now,
      });
      await ctx.db.insert("generationSources", {
        generationId,
        projectId: fixture.projectId,
        kind: "project_document",
        label: "writer_notes:notes.md",
        content: CANDIDATE_DOCUMENT_BODY,
        contentHash: "candidate-document-hash",
        truncated: false,
        originalLength: CANDIDATE_DOCUMENT_BODY.length,
        // CAP-3: writer's-notes trust now comes from the uploader's role, so
        // this fixture carries an internal one to keep the WRITER'S NOTES
        // label the assertions below expect.
        uploaderRole: "writer",
        capturedAt: fixture.now,
      });
      // CAP-3: a legacy frozen writer_notes row with no uploaderRole, run
      // through the real entry action, must reach the analyzer as client
      // evidence — the whole seam in one traversal, not two tested halves.
      await ctx.db.insert("generationSources", {
        generationId,
        projectId: fixture.projectId,
        kind: "project_document",
        label: "writer_notes:legacy.md",
        content: LEGACY_DOCUMENT_BODY,
        contentHash: "legacy-document-hash",
        truncated: false,
        originalLength: LEGACY_DOCUMENT_BODY.length,
        capturedAt: fixture.now,
      });
      const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId: fixture.projectId,
        model: OPENROUTER_MODEL,
        label: "GPT-5.6 Luna",
        status: "queued",
        queuedAt: fixture.now,
      });
      return { generationId, candidateRunId };
    });
    const requests: OpenRouterRequest[] = [];
    const fetchMock = successfulOpenRouterFetch(requests);
    vi.stubGlobal("fetch", fetchMock);

    // The only production entry into runPipelineForModel: the scheduled
    // payload built by generateReport, forwarded positionally here.
    await t.action(internal.ai.pipeline.generateCandidate, {
      candidateRunId,
      generationId,
      brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
      qaCalibration: qaText,
      draftStyle: styleText,
      qaCalibrationDigestId: qaId,
      draftStyleDigestId: styleId,
    });
    const providerCalls = fetchMock.mock.calls.length;

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      run: await ctx.db.get(candidateRunId),
    }));
    expect(state.run?.status).toBe("succeeded");
    expect(state.generation?.learningDigestIds).toEqual(sortIds([styleId, qaId]));
    expect(state.generation?.promptVersion).toBe(PROMPT_VERSION);

    const bodies = requests.map((request) => JSON.stringify(request));
    const toolOf = (request: OpenRouterRequest) =>
      request.tool_choice?.function?.name;
    const sectionBodies = requests
      .filter((request) => toolOf(request) === undefined)
      .map((request) => JSON.stringify(request));
    const analyzerBody = bodies.find((_, index) =>
      toolOf(requests[index]!) === "submit_transcript_analysis",
    );
    const qaBody = bodies.find((_, index) =>
      toolOf(requests[index]!) === "submit_qa_scorecard",
    );
    expect(sectionBodies).toHaveLength(3);
    expect(sectionBodies.every((body) => body.includes(styleText))).toBe(true);
    expect(sectionBodies.some((body) => body.includes(qaText))).toBe(false);
    expect(qaBody).toContain(qaText);
    expect(qaBody).not.toContain(styleText);
    expect(analyzerBody).toBeDefined();
    expect(analyzerBody).not.toContain(styleText);
    expect(analyzerBody).not.toContain(qaText);
    // The trusted-context module is actually wired into the request: the
    // guidance ships on every analyzer call and every frozen source — the
    // transcript included — travels between BEGIN/END markers.
    const analyzerUser = JSON.parse(analyzerBody!) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userText = analyzerUser.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n");
    expect(userText).toContain(CONTEXT_INPUTS_GUIDANCE);
    expect(userText).toContain("--- BEGIN [INTERVIEW TRANSCRIPT] ---");
    expect(userText).toContain("--- END [INTERVIEW TRANSCRIPT] ---");
    expect(userText).toContain(
      "--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---",
    );
    expect(userText).toContain(
      "--- END [WRITER'S NOTES (unreliable narrator)] notes.md ---",
    );
    expect(userText).toContain(CANDIDATE_DOCUMENT_BODY);
    // The roleless legacy row is demoted end to end: OTHER SUPPORTING MATERIAL
    // label, never the WRITER'S NOTES header, and after the attributed notes.
    expect(userText).toContain(
      `--- BEGIN [OTHER SUPPORTING MATERIAL] legacy.md ---\n${LEGACY_DOCUMENT_BODY}\n--- END [OTHER SUPPORTING MATERIAL] legacy.md ---`,
    );
    expect(userText).not.toContain("[WRITER'S NOTES (unreliable narrator)] legacy.md");
    expect(
      userText.indexOf("--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---"),
    ).toBeLessThan(
      userText.indexOf("--- BEGIN [OTHER SUPPORTING MATERIAL] legacy.md ---"),
    );

    // Usage rows are scheduled at the transport boundary; flush them and read
    // through the Story 11 index. Every candidate-owned call carries the run
    // id; anything scheduled by completion (post-QA) is generation-only.
    await flushScheduledUsage(t);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("aiUsage")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .take(50),
    );
    const candidateRows = rows.filter((row) => row.candidateRunId === candidateRunId);
    expect(candidateRows).toHaveLength(providerCalls);
    expect(candidateRows.every((row) => row.generationId === generationId)).toBe(true);
    expect(
      candidateRows.every(
        (row) => typeof row.durationMs === "number" && row.durationMs >= 0,
      ),
    ).toBe(true);
    expect(candidateRows.every((row) => row.model === OPENROUTER_MODEL)).toBe(true);
  });

  it("declares the frozen style digest at the iterative section handoff and attributes its usage", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const frozenStyle = "FROZEN ITERATIVE STYLE TEXT";
    const styleId = await insertDigest(t, {
      kind: "draft_style",
      content: frozenStyle,
      ordinal: 411,
    });
    const generationId = await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "running",
        requestedBy: fixture.userId,
        candidateMode: "iterative",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
      });
      await ctx.db.patch(fixture.projectId, {
        activeGenerationId: generationId,
        status: "generating",
      });
      await ctx.db.insert("generationSectionRuns", {
        generationId,
        projectId: fixture.projectId,
        section: "s242",
        status: "queued",
        model: OPENROUTER_MODEL,
        label: "GPT-5.6 Luna",
        attempt: 1,
        queuedAt: fixture.now,
      });
      return generationId;
    });
    await t.mutation(internal.generations.saveIterativeArtifacts, {
      generationId,
      analysis: JSON.stringify(TEST_ANALYSIS),
      brainBlocks: JSON.stringify({
        blocks: { s242: "exemplar block" },
        styleGuidance: frozenStyle,
        draftStyleDigestId: styleId,
        styleOverrides: NO_STYLE_OVERRIDES,
      }),
    });
    const requests: OpenRouterRequest[] = [];
    const fetchMock = successfulOpenRouterFetch(requests);
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.ai.iterative.generateSection, {
      generationId,
      section: "s242",
    });

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      run: await ctx.db
        .query("generationSectionRuns")
        .withIndex("by_generationId_and_section", (q) =>
          q.eq("generationId", generationId).eq("section", "s242"),
        )
        .unique(),
    }));
    expect(state.run?.status).toBe("awaiting_review");
    expect(state.generation?.learningDigestIds).toEqual([styleId]);
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).toContain(frozenStyle);

    await flushScheduledUsage(t);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("aiUsage")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .take(10),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      generationId,
      model: OPENROUTER_MODEL,
      callSite: "generation:section:242",
    });
    expect(rows[0]?.candidateRunId).toBeUndefined();
    expect(rows[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("getGeneration attributable cost", () => {
  async function seedUsage(
    t: ReturnType<typeof convexTest>,
    rows: Array<{
      generationId?: Id<"generations">;
      projectId?: Id<"projects">;
      callSite: string;
      costUsd: number;
      createdAt: number;
    }>,
  ) {
    await t.run(async (ctx) => {
      for (const row of rows) {
        await ctx.db.insert("aiUsage", {
          ...(row.generationId ? { generationId: row.generationId } : {}),
          ...(row.projectId ? { projectId: row.projectId } : {}),
          callSite: row.callSite,
          model: "claude-sonnet-5",
          inputTokens: 10,
          outputTokens: 2,
          costUsd: row.costUsd,
          createdAt: row.createdAt,
        });
      }
    });
  }

  it("sums every recorded usage row, including failed and retried calls, and ignores other generations' rows", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const digestId = await insertDigest(t, {
      kind: "draft_style",
      content: "STYLE",
      ordinal: 900,
    });
    const { generationId, otherGenerationId } = await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "completed",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [digestId],
        startedAt: fixture.now,
        completedAt: fixture.now,
      });
      const otherGenerationId = await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "completed",
        promptVersion: RETRY_PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
        completedAt: fixture.now,
      });
      return { generationId, otherGenerationId };
    });
    await seedUsage(t, [
      { generationId, callSite: "generation:analyzer", costUsd: 0.25, createdAt: 1 },
      // A call whose generation later failed, and a retried call: both are
      // recorded spend and must count.
      { generationId, callSite: "generation:failed-attempt", costUsd: 0.5, createdAt: 2 },
      { generationId, callSite: "generation:retry-attempt", costUsd: 0.125, createdAt: 3 },
      // Noise that must not contribute.
      { generationId: otherGenerationId, callSite: "generation:other", costUsd: 99, createdAt: 4 },
      { callSite: "chat", costUsd: 42, createdAt: 5 },
      // Same project, no generationId: aggregating by project instead of by
      // generation would pull this in, so its absence from the sum is the
      // assertion that the query keys on by_generationId.
      {
        projectId: fixture.projectId,
        callSite: "chat",
        costUsd: 13,
        createdAt: 6,
      },
    ]);

    const view = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, { generationId });
    expect(view?.cost).toBe(0.875);
    expect(view?.promptVersion).toBe(PROMPT_VERSION);
    expect(view?.learningDigestIds).toEqual([digestId]);

    const otherView = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, {
        generationId: otherGenerationId,
      });
    expect(otherView?.cost).toBe(99);
    expect(otherView?.learningDigestIds).toEqual([]);
  });

  it("still sums recorded rows for a tracked generation that failed", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const digestId = await insertDigest(t, {
      kind: "qa_calibration",
      content: "CAL",
      ordinal: 920,
    });
    // Spend recorded before the generation died is still attributable spend:
    // the query must not gate the sum on a terminal-success status.
    const failedId = await t.run((ctx) =>
      ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "failed",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [digestId],
        startedAt: fixture.now,
        completedAt: fixture.now,
        error: "provider failed",
      }),
    );
    await seedUsage(t, [
      { generationId: failedId, callSite: "generation:analyzer", costUsd: 0.25, createdAt: 1 },
      { generationId: failedId, callSite: "generation:section:242", costUsd: 0.5, createdAt: 2 },
    ]);

    const view = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, { generationId: failedId });
    expect(view?.status).toBe("failed");
    expect(view?.cost).toBe(0.75);
    expect(view?.promptVersion).toBe(PROMPT_VERSION);
    expect(view?.learningDigestIds).toEqual([digestId]);
  });

  it("reports zero, not null, for a tracked generation with no usage rows", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const generationId = await t.run((ctx) =>
      ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "completed",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
        completedAt: fixture.now,
      }),
    );

    const view = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, { generationId });
    expect(view?.cost).toBe(0);
    expect(view?.cost).not.toBeNull();
    expect(view?.promptVersion).toBe(PROMPT_VERSION);
    expect(view?.learningDigestIds).toEqual([]);
  });

  it("returns null provenance for a legacy generation even when usage rows exist", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const legacyId = await t.run((ctx) =>
      ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "completed",
        startedAt: fixture.now,
        completedAt: fixture.now,
      }),
    );
    await seedUsage(t, [
      { generationId: legacyId, callSite: "generation:legacy", costUsd: 7, createdAt: 1 },
    ]);

    const view = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, { generationId: legacyId });
    expect(view).not.toBeNull();
    expect(view?.promptVersion).toBeNull();
    expect(view?.learningDigestIds).toBeNull();
    expect(view?.cost).toBeNull();
  });

  it("treats a new-format reservation as untracked until beginGeneration stamps the hash", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const generationId = await t
      .withIdentity({ subject: AUTH_ID })
      .mutation(api.generations.requestGeneration, {
        projectId: fixture.projectId,
        candidateMode: "single",
        singleModelId: "claude-sonnet-5",
      });
    const reserved = await t.run((ctx) => ctx.db.get(generationId));
    expect(reserved).toMatchObject({ status: "reserved", learningDigestIds: [] });
    expect(reserved?.promptVersion).toBeUndefined();

    const view = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, { generationId });
    expect(view?.promptVersion).toBeNull();
    expect(view?.learningDigestIds).toBeNull();
    expect(view?.cost).toBeNull();

    // Assert the stamp actually landed so a failed handoff (e.g. the project
    // not pointing at this reservation) does not surface later as a confusing
    // promptVersion mismatch.
    await expect(
      t.mutation(internal.generations.beginGeneration, {
        generationId,
        promptVersion: PROMPT_VERSION,
      }),
    ).resolves.toBe(true);
    const stamped = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, { generationId });
    expect(stamped?.promptVersion).toBe(PROMPT_VERSION);
    expect(stamped?.learningDigestIds).toEqual([]);
    expect(stamped?.cost).toBe(0);
  });

  it("reports the partial sum and partially grown digest union while a generation is in flight", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const [firstDigestId, secondDigestId] = await Promise.all([
      insertDigest(t, { kind: "qa_calibration", content: "CAL", ordinal: 910 }),
      insertDigest(t, { kind: "draft_style", content: "STYLE", ordinal: 911 }),
    ]);
    const generationId = await t.run((ctx) =>
      ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "running",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
      }),
    );
    await t.mutation(internal.generations.unionLearningDigestIds, {
      generationId,
      digestIds: [firstDigestId],
    });
    await seedUsage(t, [
      { generationId, callSite: "generation:brief", costUsd: 0.2, createdAt: 1 },
    ]);

    const midFlight = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, { generationId });
    expect(midFlight?.status).toBe("running");
    expect(midFlight?.cost).toBe(0.2);
    expect(midFlight?.learningDigestIds).toEqual([firstDigestId]);

    await t.mutation(internal.generations.unionLearningDigestIds, {
      generationId,
      digestIds: [secondDigestId],
    });
    await seedUsage(t, [
      { generationId, callSite: "generation:section:242", costUsd: 0.3, createdAt: 2 },
    ]);
    const later = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.generations.getGeneration, { generationId });
    expect(later?.cost).toBeCloseTo(0.5, 10);
    expect(later?.learningDigestIds).toEqual([firstDigestId, secondDigestId]);
  });

  it("serves an admin who did not create the project and still returns null for unauthorized callers", async () => {
    const t = convexTest(schema, modules);
    const fixture = await insertProjectFixture(t);
    const generationId = await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId: "generation-attribution-admin",
        role: "admin",
        name: "Attribution Admin",
      });
      await ctx.db.insert("users", {
        authId: "generation-attribution-anon",
        name: "Anonymous Visitor",
        isAnonymous: true,
      });
      await ctx.db.insert("users", {
        authId: "generation-attribution-roleless",
        name: "Role-less User",
      });
      return await ctx.db.insert("generations", {
        projectId: fixture.projectId,
        transcriptId: fixture.transcriptId,
        status: "completed",
        promptVersion: PROMPT_VERSION,
        learningDigestIds: [],
        startedAt: fixture.now,
        completedAt: fixture.now,
      });
    });
    await seedUsage(t, [
      { generationId, callSite: "generation:analyzer", costUsd: 1.5, createdAt: 1 },
    ]);

    const project = await t.run((ctx) => ctx.db.get(fixture.projectId));
    expect(project?.createdBy).toBe(fixture.userId);

    const asAdmin = await t
      .withIdentity({ subject: "generation-attribution-admin" })
      .query(api.generations.getGeneration, { generationId });
    expect(asAdmin?.cost).toBe(1.5);
    expect(asAdmin?.promptVersion).toBe(PROMPT_VERSION);
    expect(asAdmin?.learningDigestIds).toEqual([]);

    for (const subject of [
      "generation-attribution-anon",
      "generation-attribution-roleless",
      "generation-attribution-unmapped",
    ]) {
      expect(
        await t
          .withIdentity({ subject })
          .query(api.generations.getGeneration, { generationId }),
      ).toBeNull();
    }
    expect(
      await t.query(api.generations.getGeneration, { generationId }),
    ).toBeNull();

    // A generation id that no longer resolves returns null for the whole
    // document, exactly as before this story.
    await t.run((ctx) => ctx.db.delete(generationId));
    expect(
      await t
        .withIdentity({ subject: AUTH_ID })
        .query(api.generations.getGeneration, { generationId }),
    ).toBeNull();
  });
});

/**
 * A project with two transcripts and a generation that froze both, seeded at
 * the point where the write site under test is about to run.
 */
async function insertTwoTranscriptFixture(
  t: ReturnType<typeof convexTest>,
  input: {
    candidateMode: "single" | "iterative";
    status: "running" | "awaiting_input" | "completed";
  },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: AUTH_ID,
      role: "writer",
      name: "Attribution Writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Two transcript project",
      clientName: "Test client",
      status: "generating",
      createdBy: userId,
      shareToken: "two-transcript-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptIds: Id<"transcripts">[] = [];
    for (const [index, body] of ["Alpha body", "Bravo body"].entries()) {
      transcriptIds.push(
        await ctx.db.insert("transcripts", {
          projectId,
          label: index === 0 ? "First" : "Second",
          position: index,
          content: body,
          createdAt: now + index,
        }),
      );
    }
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId: transcriptIds[0],
      transcriptIds,
      status: input.status,
      requestedBy: userId,
      candidateMode: input.candidateMode,
      totalCandidates: 1,
      startedAt: now,
      ...(input.status === "completed" ? { completedAt: now } : {}),
    });
    await ctx.db.patch(projectId, {
      activeGenerationId: generationId,
      ownerId: userId,
    });
    return { now, userId, projectId, generationId, transcriptIds };
  });
}

describe("provenance sets on generated report artifacts (AC1)", () => {
  it("stamps the frozen set on the report and its generated snapshot", async () => {
    const t = convexTest(schema, modules);
    const { now, projectId, generationId, transcriptIds } =
      await insertTwoTranscriptFixture(t, {
        candidateMode: "single",
        status: "running",
      });
    const runId = await t.run(async (ctx) => {
      const candidateId = await ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        content: "Chosen draft",
        agentOutputs: "{}",
        createdAt: now,
      });
      return await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "running",
        candidateId,
        queuedAt: now,
        startedAt: now,
      });
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runId,
      content: "Chosen draft",
      agentOutputs: "{}",
    });

    const written = await t.run(async (ctx) => ({
      report: await ctx.db.query("reports").unique(),
      snapshots: await ctx.db.query("reportSnapshots").collect(),
    }));
    expect(written.report).toMatchObject({
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
    });
    expect(written.snapshots).toHaveLength(1);
    expect(written.snapshots[0]).toMatchObject({
      reason: "generated",
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
    });
  });

  it("stamps the frozen set on a ghost draft that lands after its generation completed", async () => {
    const t = convexTest(schema, modules);
    const { now, projectId, generationId, transcriptIds } =
      await insertTwoTranscriptFixture(t, {
        candidateMode: "iterative",
        status: "completed",
      });
    const ghostRunId = await t.run(async (ctx) => {
      await ctx.db.insert("reports", {
        projectId,
        generationId,
        sourceTranscriptId: transcriptIds[0],
        sourceTranscriptIds: transcriptIds,
        content: "Approved report",
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "running",
        ghost: true,
        queuedAt: now,
        startedAt: now,
      });
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: ghostRunId,
      content: "Late ghost draft",
      agentOutputs: "{}",
    });

    const snapshots = await t.run((ctx) =>
      ctx.db.query("reportSnapshots").collect(),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      reason: "generated",
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
    });
  });

  it("stamps the frozen set on the iterative report and its ghost comparison snapshot", async () => {
    const t = convexTest(schema, modules);
    const { now, projectId, generationId, transcriptIds } =
      await insertTwoTranscriptFixture(t, {
        candidateMode: "iterative",
        status: "awaiting_input",
      });
    await t.run(async (ctx) => {
      for (const [index, section] of (["s242", "s244", "s246"] as const).entries()) {
        await ctx.db.insert("generationSectionRuns", {
          generationId,
          projectId,
          section,
          status: section === "s246" ? "awaiting_review" : "approved",
          ...(section === "s246"
            ? { draftText: "Drafted 246" }
            : { approvedText: section === "s242" ? "It was uncertain whether this scales." : `Approved ${section}` }),
          model: "claude-sonnet-5",
          label: "Sonnet 5",
          attempt: 1,
          queuedAt: now + index,
        });
      }
      const ghostCandidateId = await ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        content: "Ghost one-shot draft",
        agentOutputs: "{}",
        createdAt: now,
      });
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "succeeded",
        ghost: true,
        candidateId: ghostCandidateId,
        queuedAt: now,
        completedAt: now,
      });
    });

    await t
      .withIdentity({ subject: AUTH_ID })
      .mutation(api.generations.approveSectionDraft, {
        generationId,
        section: "s246",
        text: "Approved 246",
      });

    const written = await t.run(async (ctx) => ({
      report: await ctx.db.query("reports").unique(),
      snapshots: await ctx.db.query("reportSnapshots").collect(),
    }));
    expect(written.report).toMatchObject({
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
    });
    if (!written.report) throw new Error("Missing iterative report");
    expect(await t.run(ctx => ctx.db.query("qaFindings").collect())).toEqual(expect.arrayContaining([expect.objectContaining({ reportId: written.report._id, revisionNumber: 0, contentHash: await sha256(written.report.content), section: "s242", check: "because_clause", blocking: true })]));
    expect(written.snapshots).toHaveLength(2);
    for (const snapshot of written.snapshots) {
      expect(snapshot).toMatchObject({
        reason: "generated",
        sourceTranscriptId: transcriptIds[0],
        sourceTranscriptIds: transcriptIds,
      });
    }
    expect(written.snapshots.map((row) => row.label)).toEqual([
      "AI draft (Iterative — Sonnet 5)",
      "One-shot ghost draft (comparison — Gemini 3.1 Pro)",
    ]);
  });
});


/**
 * Story 2: the budget outcome must actually be recorded by the production
 * entry actions — deleting the `recordContextBudget` call in either pipeline
 * has to fail here, not merely go unnoticed because the mutation is exercised
 * directly elsewhere.
 */
describe("the analyzer context budget is recorded by the entry actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Digest mode: the frozen full text is over budget by declaration
   * (`inputMode: "digest"`), and a stored digest for exactly its bytes lets
   * `ensureCondensedInputs` reuse it without a condense call — so the entry
   * action freezes a `transcript_digest` row and re-reads before analyzing.
   */
  const DIGEST_FULL_TEXT = `${"F".repeat(200)} FULL-TEXT SENTINEL`;
  const DIGEST_TEXT = "DIGEST SENTINEL";

  async function reservedGenerationWithSources(
    t: ReturnType<typeof convexTest>,
    candidateMode: "single" | "iterative",
    inputMode: "full" | "digest" = "full",
  ) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const transcriptText =
        inputMode === "digest" ? DIGEST_FULL_TEXT : "A usable interview transcript.";
      const userId = await ctx.db.insert("users", {
        authId: `budget-record-${candidateMode}`,
        role: "writer",
      });
      const projectId = await ctx.db.insert("projects", {
        title: "Budget recording project",
        clientName: "Test client",
        status: "draft",
        createdBy: userId,
        shareToken: `budget-record-${candidateMode}`,
        createdAt: now,
        updatedAt: now,
      });
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content: transcriptText,
        createdAt: now,
      });
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        transcriptIds: [transcriptId],
        ...(inputMode === "digest" ? { inputMode } : {}),
        status: "reserved",
        requestedAt: now,
        requestedBy: userId,
        candidateMode,
        ...(candidateMode === "single"
          ? { singleModelId: "claude-sonnet-5" }
          : {}),
        previousProjectStatus: "draft",
        learningDigestIds: [],
        startedAt: now,
      });
      await ctx.db.patch(projectId, {
        activeGenerationId: generationId,
        status: "generating",
      });
      await ctx.db.insert("generationSources", {
        generationId,
        projectId,
        kind: "transcript",
        transcriptId,
        label: "Interview transcript",
        content: transcriptText,
        contentHash: "budget-record-transcript-hash",
        truncated: false,
        originalLength: transcriptText.length,
        capturedAt: now,
      });
      if (inputMode === "digest") {
        await ctx.db.insert("transcriptDigests", {
          transcriptId,
          projectId,
          sourceContentHash: "budget-record-transcript-hash",
          condenseVersion: CONDENSE_VERSION,
          content: DIGEST_TEXT,
          structured: "[]",
          model: "claude-sonnet-5",
          promptVersion: PROMPT_VERSION,
          charCount: DIGEST_TEXT.length,
          originalLength: transcriptText.length,
          createdAt: now,
        });
      }
      await ctx.db.insert("generationSources", {
        generationId,
        projectId,
        kind: "project_document",
        label: "writer_notes:notes.md",
        content: CANDIDATE_DOCUMENT_BODY,
        contentHash: "budget-record-document-hash",
        truncated: false,
        originalLength: CANDIDATE_DOCUMENT_BODY.length,
        // CAP-3: an internal role is what earns the notes label; this fixture
        // carries one so its expected label is unchanged.
        uploaderRole: "writer",
        capturedAt: now,
      });
      return { generationId };
    });
  }

  /** The analyzer request's user text, whichever transport shape carried it. */
  function analyzerUserTextOf(requests: OpenRouterRequest[]): string {
    const bodies = requests.map((request) => JSON.stringify(request));
    const index = bodies.findIndex((body) =>
      body.includes("submit_transcript_analysis"),
    );
    expect(index).toBeGreaterThan(-1);
    const request = requests[index] as unknown as {
      messages: Array<{
        role: string;
        content: string | Array<{ type: string; text?: string }>;
      }>;
    };
    return request.messages
      .filter((message) => message.role === "user")
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content.map((block) => block.text ?? "").join("\n"),
      )
      .join("\n");
  }

  async function writeBudgetSettings(
    t: ReturnType<typeof convexTest>,
    values: Record<string, string>,
  ) {
    await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", {
        authId: `budget-admin-${Object.keys(values).join("-")}`,
        role: "admin",
      });
      for (const [key, value] of Object.entries(values)) {
        await ctx.db.insert("appSettings", {
          key,
          value,
          updatedBy: adminId,
          updatedAt: Date.now(),
        });
      }
    });
  }

  it.each([
    ["one-shot", internal.ai.pipeline.generateReport, "single"] as const,
    [
      "iterative",
      internal.ai.iterative.startIterativeGeneration,
      "iterative",
    ] as const,
  ])(
    "the %s entry action applies the admin-tuned budget and tells the writer what it cut",
    async (_label, action, candidateMode) => {
      const t = convexTest(schema, modules);
      const { generationId } = await reservedGenerationWithSources(
        t,
        candidateMode,
      );
      // 100 tokens total; a 1-token (4-char) document cap cuts the notes.
      await writeBudgetSettings(t, {
        "ai.analyzerContextBudgetTokens": "100",
        "ai.analyzerDocumentBudgetTokens": "1",
      });
      const requests: OpenRouterRequest[] = [];
      vi.stubGlobal("fetch", successfulOpenRouterFetch(requests));

      await t.action(action, { generationId });

      const rows = await t.run((ctx) =>
        ctx.db
          .query("generationSources")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .collect(),
      );
      const transcriptRow = rows.find((row) => row.kind === "transcript")!;
      const documentRow = rows.find((row) => row.kind === "project_document")!;
      expect(transcriptRow.contextBudget).toEqual({
        budgetTokens: 100,
        included: true,
        includedLength: transcriptRow.content.length,
        truncated: false,
      });
      expect(documentRow.contextBudget).toEqual({
        budgetTokens: 100,
        included: true,
        includedLength: 4,
        truncated: true,
      });
      // The frozen capture facts are untouched by the recording.
      expect(documentRow.content).toBe(CANDIDATE_DOCUMENT_BODY);
      expect(documentRow.truncated).toBe(false);

      const generation = await t.run((ctx) => ctx.db.get(generationId));
      expect(generation?.progressLog).toContain(
        "Using 1 frozen contextual document(s), weighted by SR&ED priority.",
      );
      expect(generation?.progressLog).toContain(
        "Context budget (100 tokens) shortened notes.md.",
      );

      if (candidateMode === "iterative") {
        const userText = analyzerUserTextOf(requests);
        expect(userText).toContain(
          `--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---\n${CANDIDATE_DOCUMENT_BODY.slice(0, 4)}\n[TRUNCATED: 38 of 42 characters omitted to fit the context budget.]\n--- END`,
        );
        expect(userText).not.toContain(CANDIDATE_DOCUMENT_BODY);
      }
    },
  );

  it("a candidate sends the budget it was scheduled with, not a later retune", async () => {
    const t = convexTest(schema, modules);
    const { generationId } = await reservedGenerationWithSources(t, "single");
    const candidateRunId = await t.run(async (ctx) => {
      const generation = (await ctx.db.get(generationId))!;
      // claimCandidateRun only hands out runs of a running generation.
      await ctx.db.patch(generationId, { status: "running" });
      return await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId: generation.projectId,
        model: "openai/gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        status: "queued",
        queuedAt: Date.now(),
      });
    });
    // Settings now say "documents are fine"; the scheduled payload says the
    // report was recorded with no documents at all. The payload wins.
    const requests: OpenRouterRequest[] = [];
    vi.stubGlobal("fetch", successfulOpenRouterFetch(requests));
    await t.action(internal.ai.pipeline.generateCandidate, {
      candidateRunId,
      generationId,
      brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
      contextBudget: { ...DEFAULT_CONTEXT_BUDGET, maxDocuments: 0 },
    });
    const userText = analyzerUserTextOf(requests);
    expect(userText).toContain("--- BEGIN [INTERVIEW TRANSCRIPT] ---");
    expect(userText).not.toContain("notes.md");
    expect(userText).not.toContain(CANDIDATE_DOCUMENT_BODY);
  });

  it("a candidate scheduled without a budget falls back to the frozen input's admin-tuned one", async () => {
    // The transition window: a candidate queued before `contextBudget` was in
    // the scheduler payload must still honour the settings, not the defaults.
    const t = convexTest(schema, modules);
    const { generationId } = await reservedGenerationWithSources(t, "single");
    const candidateRunId = await t.run(async (ctx) => {
      const generation = (await ctx.db.get(generationId))!;
      await ctx.db.patch(generationId, { status: "running" });
      return await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId: generation.projectId,
        model: "openai/gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        status: "queued",
        queuedAt: Date.now(),
      });
    });
    await writeBudgetSettings(t, { "ai.analyzerDocumentBudgetTokens": "1" });
    const requests: OpenRouterRequest[] = [];
    vi.stubGlobal("fetch", successfulOpenRouterFetch(requests));
    await t.action(internal.ai.pipeline.generateCandidate, {
      candidateRunId,
      generationId,
      brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
    });
    const userText = analyzerUserTextOf(requests);
    expect(userText).toContain(
      `--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---\n${CANDIDATE_DOCUMENT_BODY.slice(0, 4)}\n[TRUNCATED: 38 of 42 characters omitted to fit the context budget.]\n--- END`,
    );
    expect(userText).not.toContain(CANDIDATE_DOCUMENT_BODY);
  });

  it.each([
    ["one-shot", internal.ai.pipeline.generateReport, "single"] as const,
    [
      "iterative",
      internal.ai.iterative.startIterativeGeneration,
      "iterative",
    ] as const,
  ])(
    "the %s entry action analyzes and records the digest rows in digest mode, not the full text",
    async (_label, action, candidateMode) => {
      const t = convexTest(schema, modules);
      const { generationId } = await reservedGenerationWithSources(
        t,
        candidateMode,
        "digest",
      );
      const requests: OpenRouterRequest[] = [];
      vi.stubGlobal("fetch", successfulOpenRouterFetch(requests));

      await t.action(action, { generationId });

      const rows = await t.run((ctx) =>
        ctx.db
          .query("generationSources")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .collect(),
      );
      const fullTextRow = rows.find((row) => row.kind === "transcript")!;
      const digestRow = rows.find((row) => row.kind === "transcript_digest")!;
      const documentRow = rows.find((row) => row.kind === "project_document")!;
      expect(digestRow.content).toBe(DIGEST_TEXT);
      // Only the rows the analyzer read carry the budget outcome: the digest
      // it was built from and the documents, never the superseded full text.
      expect(fullTextRow.contextBudget).toBeUndefined();
      expect(digestRow.contextBudget).toEqual({
        budgetTokens: DEFAULT_CONTEXT_BUDGET.totalTokens,
        included: true,
        includedLength: DIGEST_TEXT.length,
        truncated: false,
      });
      expect(documentRow.contextBudget?.included).toBe(true);

      if (candidateMode === "iterative") {
        const userText = analyzerUserTextOf(requests);
        expect(userText).toContain(
          `--- BEGIN [INTERVIEW TRANSCRIPT] ---\n${DIGEST_TEXT}\n--- END [INTERVIEW TRANSCRIPT] ---`,
        );
        expect(userText).not.toContain("FULL-TEXT SENTINEL");
      }
    },
  );

  it.each([
    ["one-shot", internal.ai.pipeline.generateReport, "single"] as const,
    [
      "iterative",
      internal.ai.iterative.startIterativeGeneration,
      "iterative",
    ] as const,
  ])(
    "the %s entry action patches contextBudget onto every frozen source",
    async (_label, action, candidateMode) => {
      const t = convexTest(schema, modules);
      const { generationId } = await reservedGenerationWithSources(
        t,
        candidateMode,
      );
      const requests: OpenRouterRequest[] = [];
      vi.stubGlobal("fetch", successfulOpenRouterFetch(requests));

      // Whatever happens downstream, the recording is a committed mutation
      // that must have landed by the time the action returns.
      await t.action(action, { generationId });

      if (candidateMode === "iterative") {
        // The iterative flow calls the analyzer itself (one-shot delegates to
        // generateCandidate, fenced above): the message it sends must be the
        // trusted-context one, not the raw joined transcript.
        const userText = analyzerUserTextOf(requests);
        expect(userText).toContain(CONTEXT_INPUTS_GUIDANCE);
        expect(userText).toContain("--- BEGIN [INTERVIEW TRANSCRIPT] ---");
        expect(userText).toContain("--- END [INTERVIEW TRANSCRIPT] ---");
        expect(userText).toContain(
          "--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---",
        );
        expect(userText).toContain(CANDIDATE_DOCUMENT_BODY);
      }

      const rows = await t.run((ctx) =>
        ctx.db
          .query("generationSources")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .collect(),
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.contextBudget).toBeDefined();
        expect(row.contextBudget?.budgetTokens).toBe(
          DEFAULT_CONTEXT_BUDGET.totalTokens,
        );
        expect(row.contextBudget?.included).toBe(true);
        expect(row.contextBudget?.includedLength).toBe(row.content.length);
        expect(row.contextBudget?.truncated).toBe(false);
      }
    },
  );
});
