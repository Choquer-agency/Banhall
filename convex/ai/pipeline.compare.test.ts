/// <reference types="vite/client" />
import type Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { internal } from "../_generated/api";
import schema from "../schema";
import { MODEL } from "./model";
import { SECTION_242_REQUEST } from "./section242Agent";
import { SECTION_244_REQUEST } from "./section244Agent";
import { SECTION_246_REQUEST } from "./section246Agent";
import type { GenerationMessageParams } from "./openrouterCore";

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: network.create }; },
}));
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path, load,
  ]),
);
const pair = ["claude-opus-4-8", "claude-haiku-4-5-20251001"];
// Deliberately omit optional collections: real analyzer validation must default them.
const analysisOutput = {
  company_context: "Test company",
  project_goal: "Resolve the control uncertainty",
  business_problem: "Existing control fails",
  scientific_technical_problem: "Response under load is unknown",
  technological_objective: "A repeatable control",
  work_performed: {},
  project_status: "completed",
};
const qa = {
  overall_score: 88, section_scores: {}, cra_compliance: {},
  hallucination_risks: [], ai_language_flags: [], superlative_flags: [],
  gaps_requiring_client_followup: [], suggested_improvements: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in test"); }));
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name;
    const input = name === "submit_transcript_analysis" ? analysisOutput
      : name === "submit_qa_scorecard" ? qa : { entries: [] };
    return {
      content: name ? [{ type: "tool_use", id: "tool-1", name, input }]
        : [{ type: "text", text: "The team tested control response through prototype trials." }],
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 7 },
    };
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function fixture(t: ReturnType<typeof convexTest>, models = pair, mode: "single" | "compare" = "compare") {
  return t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "compare-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Control experiment", clientName: "Client", status: "draft",
      createdBy: userId, shareToken: "compare-token", createdAt: now, updatedAt: now,
    });
    const content = "The team tested control response through prototype trials.";
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content, createdAt: now });
    const generationId = await ctx.db.insert("generations", {
      projectId, transcriptId, transcriptIds: [transcriptId], status: "reserved",
      requestedAt: now, requestedBy: userId, startedAt: now, candidateMode: mode,
      compareModelIds: models, singleModelId: "claude-opus-4-8",
      previousProjectStatus: "draft", learningDigestIds: [],
    });
    await ctx.db.patch(projectId, { status: "generating", activeGenerationId: generationId });
    await ctx.db.insert("generationSources", {
      projectId, generationId, kind: "transcript", transcriptId,
      label: "Interview transcript", content, contentHash: "frozen-hash",
      truncated: false, originalLength: content.length, capturedAt: now,
    });
    return generationId;
  });
}

function analyzerCalls() {
  return network.create.mock.calls.filter(([params]) => params.tool_choice?.name === "submit_transcript_analysis");
}
async function candidateJobs(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect())
    .filter((job) => job.name === "ai/pipeline:generateCandidate"));
}

// Use the exact persisted scheduler payload; the action's validators still run.
async function runCandidates(t: ReturnType<typeof convexTest>) {
  for (const job of await candidateJobs(t)) {
    const args = job.args[0] as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>;
    await t.action(internal.ai.pipeline.generateCandidate, args);
  }
}

function userText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  return params.messages.filter((message) => message.role === "user")
    .map((message) => typeof message.content === "string" ? message.content
      : message.content.map((block) => block.type === "text" ? block.text : "").join(""))
    .join("\n");
}

// Execute only the durable usage payloads. Advancing every fake timer would
// also launch candidate or post-QA actions, obscuring ownership assertions.
async function flushScheduledUsage(t: ReturnType<typeof convexTest>) {
  const jobs = await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((job) => job.name === "aiUsage:logUsage"));
  for (const job of jobs) {
    await t.run((ctx) => ctx.scheduler.cancel(job._id));
    await t.mutation(internal.aiUsage.logUsage,
      job.args[0] as FunctionArgs<typeof internal.aiUsage.logUsage>);
  }
}

const sectionRequests = [SECTION_242_REQUEST, SECTION_244_REQUEST, SECTION_246_REQUEST];

describe("shared generation analysis", () => {
  it.each([pair, [...pair].reverse()])("analyzes once before fanout and shares persisted validated analysis (%s, %s)", async (...models) => {
    const t = convexTest(schema, modules);
    const generationId = await fixture(t, models);
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    expect(analyzerCalls()).toHaveLength(1);
    const analyzerRequest = analyzerCalls()[0][0];
    expect(analyzerRequest.system).toEqual([{
      type: "text", text: expect.any(String), cache_control: { type: "ephemeral" },
    }]);
    expect(analyzerRequest.messages).toEqual([{ role: "user", content: [{
      type: "text", text: expect.stringContaining("--- BEGIN [INTERVIEW TRANSCRIPT] ---"),
      cache_control: { type: "ephemeral" },
    }] }]);
    const before = await t.run((ctx) => ctx.db.query("generationArtifacts").collect());
    const frozenAnalysis = before.find((row) => row.kind === "analysis");
    expect(frozenAnalysis).toBeDefined();
    const jobs = await candidateJobs(t);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) expect(job.args[0].analysis).toBe(frozenAnalysis?.content);
    const brain = before.find((row) => row.kind === "brain_blocks");
    expect(JSON.parse(brain?.content ?? "null")).toMatchObject({
      blocks: { analyzer: "", s242: "", s244: "", s246: "" },
      styleGuidance: expect.any(String),
      styleOverrides: expect.any(Object),
    });
    await runCandidates(t);
    expect(await t.run((ctx) => ctx.db.query("generationArtifacts").collect())).toEqual(before);
    expect(analyzerCalls()).toHaveLength(1);
    expect(analyzerCalls()[0][0].model).toBe(MODEL);
    const artifacts = await t.run((ctx) => ctx.db.query("generationArtifacts").collect());
    const analyses = artifacts.filter((row) => row.kind === "analysis");
    expect(analyses).toHaveLength(1);
    const analysis = JSON.parse(analyses[0].content);
    expect(analysis.useful_quotes).toEqual([]);
    const candidates = await t.run((ctx) => ctx.db.query("reportCandidates").collect());
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(JSON.parse(candidate.agentOutputs ?? "null").analyzer).toEqual(analysis);
    }
    for (const model of models) {
      for (const section of sectionRequests) {
        const drafts = network.create.mock.calls.filter(([params]) =>
          params.model === model && userText(params).startsWith(section.userPrefix));
        expect(drafts).toHaveLength(1);
        expect(userText(drafts[0][0])).toContain(JSON.stringify(analysis, null, section.jsonIndentation));
      }
    }
    await flushScheduledUsage(t);
    const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
    const analyzerUsage = usage.filter((row) => row.callSite === "generation:analyzer");
    expect(analyzerUsage).toHaveLength(1);
    expect(analyzerUsage[0]).toMatchObject({
      generationId, model: MODEL, inputTokens: 10, outputTokens: 5,
      cacheCreationInputTokens: 3, cacheReadInputTokens: 7,
    });
    expect(analyzerUsage[0].candidateRunId).toBeUndefined();
    const runs = await t.run((ctx) => ctx.db.query("generationCandidateRuns").collect());
    for (const run of runs) {
      const owned = usage.filter((row) => row.candidateRunId === run._id);
      expect(owned.map((row) => row.callSite).sort()).toEqual([
        "generation:chronology", "generation:qa", "generation:section:242",
        "generation:section:244", "generation:section:246",
      ]);
      expect(owned.every((row) => row.generationId === generationId && row.model === run.model)).toBe(true);
    }
  });
});


describe("shared analysis failure and compatibility", () => {
  it("keeps the selected single-mode analyzer model", async () => {
    const t = convexTest(schema, modules);
    const generationId = await fixture(t, pair, "single");
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    expect(analyzerCalls()).toHaveLength(1);
    expect(analyzerCalls()[0][0].model).toBe("claude-opus-4-8");
    expect(await candidateJobs(t)).toHaveLength(1);
    await runCandidates(t);
    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation).toMatchObject({ status: "completed", candidatesDone: 1, candidatesFailed: 0 });
    const reports = await t.run((ctx) => ctx.db.query("reports").collect());
    expect(reports).toHaveLength(1);
    expect(reports[0].content).toContain("prototype trials");
    expect(await t.run((ctx) => ctx.db.query("reportCandidates").collect())).toHaveLength(0);
    const projects = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(projects[0].status).toBe("review");
    expect(projects[0].activeGenerationId).toBeUndefined();
    expect(analyzerCalls()).toHaveLength(1);
  });

  it("fails generation without scheduling candidates when shared analysis rejects", async () => {
    const successful = network.create.getMockImplementation();
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      if (params.tool_choice?.name === "submit_transcript_analysis") throw new Error("Analyzer unavailable");
      return successful?.(params);
    });
    const t = convexTest(schema, modules);
    const generationId = await fixture(t);
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    expect(await candidateJobs(t)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("generationCandidateRuns").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("generationArtifacts").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(generationId))).toMatchObject({ status: "failed" });
    expect(analyzerCalls()).toHaveLength(1);
  });

  it.each(["{", "{}", "null"])("fails invalid shared analysis %s before any provider request", async (analysis) => {
    const t = convexTest(schema, modules);
    const generationId = await fixture(t);
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    const [job] = await candidateJobs(t);
    const args = job.args[0] as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>;
    network.create.mockClear();
    await t.action(internal.ai.pipeline.generateCandidate, { ...args, analysis });
    expect(network.create).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(args.candidateRunId))).toMatchObject({ status: "failed" });
  });

  it("runs the existing analyzer fallback for a queued payload with no analysis", async () => {
    const t = convexTest(schema, modules);
    const generationId = await fixture(t);
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    const [job] = await candidateJobs(t);
    const { analysis: _analysis, ...legacy } = job.args[0] as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>;
    network.create.mockClear();
    await t.action(internal.ai.pipeline.generateCandidate, legacy);
    expect(analyzerCalls()).toHaveLength(1);
    expect(analyzerCalls()[0][0].model).toBe(pair[0]);
    expect(await t.run((ctx) => ctx.db.get(legacy.candidateRunId))).toMatchObject({ status: "succeeded" });
  });
});


it("shares one analysis across Anthropic and OpenRouter candidates without changing gateway message strings", async () => {
  const requests: Array<{
    model: string;
    messages: Array<{ role: string; content: string }>;
    tool_choice?: { function?: { name?: string } };
  }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (typeof url !== "string" || !url.startsWith("https://openrouter.ai/")) {
      throw new Error("Non-OpenRouter network disabled in mixed-provider test");
    }
    if (typeof init?.body !== "string") throw new Error("Missing OpenRouter body");
    const request = JSON.parse(init.body);
    requests.push(request);
    const name = request.tool_choice?.function?.name;
    const input = name === "submit_qa_scorecard" ? qa : { entries: [] };
    return new Response(JSON.stringify({
      choices: [{ message: name ? { content: null, tool_calls: [{
        id: "tool-1", function: { name, arguments: JSON.stringify(input) },
      }] } : { content: "The team tested control response through prototype trials." },
      finish_reason: name ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  const t = convexTest(schema, modules);
  const gatewayModel = "openai/gpt-5.6-luna";
  const generationId = await fixture(t, [pair[0], gatewayModel]);
  await t.action(internal.ai.pipeline.generateReport, { generationId });
  await runCandidates(t);
  expect(analyzerCalls()).toHaveLength(1);
  expect(analyzerCalls()[0][0].model).toBe(MODEL);
  expect(requests.some((request) => request.tool_choice?.function?.name === "submit_transcript_analysis")).toBe(false);
  const artifacts = await t.run((ctx) => ctx.db.query("generationArtifacts").collect());
  const analysis = JSON.parse(artifacts.find((row) => row.kind === "analysis")?.content ?? "null");
  const candidates = await t.run((ctx) => ctx.db.query("reportCandidates").collect());
  expect(candidates.map((row) => row.model).sort()).toEqual([pair[0], gatewayModel].sort());
  for (const candidate of candidates) expect(JSON.parse(candidate.agentOutputs).analyzer).toEqual(analysis);
  expect(requests).toHaveLength(5);
  for (const request of requests) {
    expect(request.model).toBe(gatewayModel);
    expect(request.messages.every((message) => typeof message.content === "string")).toBe(true);
    expect(JSON.stringify(request)).not.toContain("cache_control");
  }
  for (const section of sectionRequests) {
    const gatewayDrafts = requests.filter((request) => request.messages.some((message) =>
      message.role === "user" && message.content.startsWith(section.userPrefix)));
    expect(gatewayDrafts).toHaveLength(1);
    expect(gatewayDrafts[0].messages.find((message) => message.role === "user")?.content)
      .toContain(JSON.stringify(analysis, null, section.jsonIndentation));
    const directDrafts = network.create.mock.calls.filter(([params]) =>
      params.model === pair[0] && userText(params).startsWith(section.userPrefix));
    expect(directDrafts).toHaveLength(1);
    expect(userText(directDrafts[0][0])).toContain(JSON.stringify(analysis, null, section.jsonIndentation));
  }
});
