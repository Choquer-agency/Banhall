/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import fixture from "../../shared/__fixtures__/openrouter-models-2026-09-24.json";
import heliosKit from "../../test-data/helios-end-to-end-test.txt?raw";
import { parseOpenRouterModels, summarizeEvalRun } from "../../shared/modelCatalog";
import { resetRegisteredModelEntries } from "../../shared/generationModels";
import { applyCatalogRefreshRef, runEvaluationRef } from "../lib/modelCatalogRefs";
import { HELIOS_INTERVIEW } from "./modelEvalSet";
import { JUDGE_TOOL, runEvalSet, type MeteredClient } from "./modelEvaluation";
import { QA_REQUEST } from "./qaAgent";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import type { GenerationMessageParams, GenerationResponse } from "./openrouterCore";

// Vite keys this directory's own files as "./x.ts"; convex-test resolves
// function names from the convex root, so map them back under "../ai/".
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ])
);
const NOW = Date.parse("2026-09-24T12:00:00Z");

const VALID_SEEDS = {
  seeds: [
    { bullets: ["It was unknown whether cluster net load could be forecast in time."], tags: ["conservative"], provenance: [] },
    { bullets: ["Negotiation between home controllers could fail to converge under latency."], tags: ["technical"], provenance: [] },
    { bullets: ["The team could not tell when distributed control is provably stable."], tags: ["detailed"], provenance: [] },
  ],
};
const VALID_QA = {
  overall_score: 82,
  section_scores: { "242": { score: 80, issues: [], strengths: ["Clear uncertainty."] } },
};

/** A scripted model: seeds, QA and prose answered by what the call asks for. */
function scripted(options: { seeds?: unknown; draft?: string; judgeScore?: (text: string) => number } = {}) {
  const calls: GenerationMessageParams[] = [];
  const create = async (params: GenerationMessageParams): Promise<GenerationResponse> => {
    calls.push(params);
    const tool = params.tools?.[0]?.name;
    const user = typeof params.messages[0].content === "string"
      ? params.messages[0].content
      : params.messages[0].content.map((block) => block.text).join("");
    if (tool === SEED_PROMPT_PROGRAM.request.toolName) {
      return { content: [{ type: "tool_use", id: "t1", name: tool, input: options.seeds ?? VALID_SEEDS }] };
    }
    if (tool === QA_REQUEST.toolName) {
      return { content: [{ type: "tool_use", id: "t2", name: tool, input: VALID_QA }] };
    }
    if (tool === JUDGE_TOOL) {
      return { content: [{ type: "tool_use", id: "t3", name: tool, input: { score: options.judgeScore?.(user) ?? 8, reason: "Grounded." } }] };
    }
    return { content: [{ type: "text", text: options.draft ?? "Verdant Grid did not know whether net load could be forecast in time." }] };
  };
  const metered = (cost: number): MeteredClient => {
    const meter = { costUsd: 0 };
    return {
      meter,
      client: {
        messages: {
          create: async (params) => {
            meter.costUsd += cost;
            return await create(params);
          },
        },
      },
    };
  };
  return { calls, metered };
}

describe("eval set", () => {
  it("is built from the repo's end-to-end transcript fixture, verbatim", () => {
    expect(heliosKit).toContain(HELIOS_INTERVIEW);
    expect(HELIOS_INTERVIEW).toMatch(/^Interviewer \(Dana\):/);
  });
});

describe("eval harness", () => {
  it("scores schema validity, the seed contract and the judge's rubric, with cost per task", async () => {
    const model = scripted();
    const judge = scripted();
    const results = await runEvalSet({
      tasks: ["seed_batch", "section_draft", "qa_structured"],
      model: "candidate-model",
      makeClient: () => model.metered(0.01),
      judge: judge.metered(0.001),
      judgeModel: "judge-model",
    });
    expect(results).toEqual([
      { task: "seed_batch", structured: true, schemaValid: true, contractPassed: true, rubricScore: 8, costUsd: 0.01 },
      { task: "section_draft", structured: false, schemaValid: true, contractPassed: true, rubricScore: 8, costUsd: 0.01 },
      { task: "qa_structured", structured: true, schemaValid: true, contractPassed: true, costUsd: 0.01 },
    ]);
    expect(summarizeEvalRun(results)).toEqual({ schemaValidity: 1, contractPassRate: 1, rubricScore: 8, costUsd: 0.03, tasks: 3 });
    // The seed task used the real seed tool schema and the QA task its own.
    expect(model.calls.map((call) => call.tools?.[0]?.name ?? "text").sort()).toEqual(
      [QA_REQUEST.toolName, SEED_PROMPT_PROGRAM.request.toolName, "text"].sort()
    );
    expect(judge.calls.every((call) => call.model === "judge-model")).toBe(true);
  });

  it("fails schema validity on a malformed seed batch and the contract on a broken one", async () => {
    const malformed = await runEvalSet({
      tasks: ["seed_batch"],
      model: "m",
      makeClient: () => scripted({ seeds: { seeds: "nope" } }).metered(0),
      judge: scripted().metered(0),
      judgeModel: "j",
    });
    expect(malformed[0]).toMatchObject({ schemaValid: false, contractPassed: false });
    const twoSeeds = await runEvalSet({
      tasks: ["seed_batch"],
      model: "m",
      makeClient: () => scripted({ seeds: { seeds: VALID_SEEDS.seeds.slice(0, 2) } }).metered(0),
      judge: scripted().metered(0),
      judgeModel: "j",
    });
    expect(twoSeeds[0]).toMatchObject({ schemaValid: true, contractPassed: false });
    const dashed = await runEvalSet({
      tasks: ["section_draft"],
      model: "m",
      makeClient: () => scripted({ draft: "Voltage held — mostly." }).metered(0),
      judge: scripted().metered(0),
      judgeModel: "j",
    });
    expect(dashed[0]).toMatchObject({ contractPassed: false });
  });
});

describe("evaluation action", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    resetRegisteredModelEntries();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetRegisteredModelEntries();
  });

  it("runs candidate and incumbent through both gateways, judges on the writing model and promotes on a pass", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(applyCatalogRefreshRef, {
      models: parseOpenRouterModels(fixture, NOW).models,
      fetchedAt: NOW,
      complete: false,
    });
    const evaluationId = await t.run((ctx) =>
      ctx.db.insert("modelEvaluations", {
        role: "writing",
        modelId: "x-ai/grok-4.7",
        incumbentModelId: "claude-sonnet-5",
        evalSetVersion: "banhall-eval/v1",
        status: "queued",
        estimatedCostUsd: 0.5,
        createdAt: NOW,
      })
    );
    const hits: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(url, init);
      const body = (await request.json()) as {
        model: string;
        tools?: Array<{ name?: string; function?: { name: string } }>;
        messages: Array<{ content: unknown }>;
      };
      const openRouter = request.url.includes("openrouter.ai");
      hits.push(`${openRouter ? "openrouter" : "anthropic"}:${body.model}`);
      const tool = body.tools?.[0]?.name ?? body.tools?.[0]?.function?.name;
      const text = JSON.stringify(body.messages);
      const input =
        tool === SEED_PROMPT_PROGRAM.request.toolName ? VALID_SEEDS
        : tool === QA_REQUEST.toolName ? VALID_QA
        : tool === JUDGE_TOOL ? { score: text.includes("GROK DRAFT") ? 9 : 7, reason: "Scored." }
        : null;
      const draft = openRouter ? "GROK DRAFT of the uncertainty." : "Sonnet draft of the uncertainty.";
      if (openRouter) {
        return Response.json({
          choices: [{
            message: input
              ? { content: null, tool_calls: [{ id: "c", function: { name: tool, arguments: JSON.stringify(input) } }] }
              : { content: draft },
            finish_reason: input ? "tool_calls" : "stop",
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0003 },
        });
      }
      return Response.json({
        id: "msg", type: "message", role: "assistant", model: body.model,
        content: input ? [{ type: "tool_use", id: "tu", name: tool, input }] : [{ type: "text", text: draft }],
        stop_reason: input ? "tool_use" : "end_turn", stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      });
    }));

    await t.action(runEvaluationRef, { evaluationId });

    const evaluation = await t.run((ctx) => ctx.db.get(evaluationId));
    expect(evaluation).toMatchObject({ status: "passed", outcome: "promoted" });
    // Judged 9 on its draft and 7 on the shared seed batch: mean 8.
    expect(evaluation?.candidate).toMatchObject({ schemaValidity: 1, contractPassRate: 1, rubricScore: 8 });
    expect(evaluation?.incumbent).toMatchObject({ rubricScore: 7 });
    expect(evaluation?.evalCostUsd).toBeGreaterThan(0);
    expect(hits.filter((hit) => hit.startsWith("openrouter:x-ai/grok-4.7"))).toHaveLength(3);
    expect(hits.filter((hit) => hit === "anthropic:claude-sonnet-5").length).toBeGreaterThanOrEqual(3 + 4);
    const assignment = await t.run((ctx) =>
      ctx.db.query("modelRoleAssignments").withIndex("by_role", (q) => q.eq("role", "writing")).unique()
    );
    expect(assignment?.modelId).toBe("x-ai/grok-4.7");
  });
});
