/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import fixture from "../../shared/__fixtures__/openrouter-models-2026-09-24.json";
import heliosKit from "../../test-data/helios-end-to-end-test.txt?raw";
import {
  EVAL_TASK_KINDS,
  ROLE_POLICIES,
  maxEvaluationCostUsd,
  maxRequestOutputTokens,
  parseOpenRouterModels,
  summarizeEvalRun,
  type EvalTaskKind,
} from "../../shared/modelCatalog";
import { registerModelEntries, resetRegisteredModelEntries } from "../../shared/generationModels";
import { applyCatalogRefreshRef, runEvaluationRef } from "../lib/modelCatalogRefs";
import { HELIOS_INTERVIEW, STYLE_EVAL_DOCUMENT } from "./modelEvalSet";
import {
  EVAL_ENVELOPE,
  JUDGE_TOOL,
  evalClient,
  runEvalSet,
  type MeteredClient,
} from "./modelEvaluation";
import { QA_REQUEST } from "./qaAgent";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import { CONDENSE_REQUEST } from "./condenseAgent";
import { RETRIEVAL_BRIEF_REQUEST } from "./brain/query";
import { STYLE_ANALYSIS_REQUEST } from "./styleAnalysis";
import { CHANGELOG_SYSTEM_PROMPT } from "./changelogPipeline";
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
const VALID_DIGEST = {
  participants: ["Marcus Lindqvist, CTO, Verdant Grid Technologies"],
  timeline: [],
  technologicalUncertainties: ["Whether negotiation converges when comms latency spikes."],
  hypotheses: ["Coordination had to be predictive, not reactive."],
  experiments: [
    { problem: "Voltage flicker", approach: "rule-based controller", result: "oscillated", conclusion: "needs prediction", dates: "" },
  ],
  resultsAndNumbers: ["In simulation, voltage excursions cut by about two-thirds versus the rule-based baseline."],
  namesAndSystems: ["distributed negotiation"],
  keyQuotes: ["Marcus: \"We genuinely didn't know if a useful forecast was even possible at the timescale we needed.\""],
};
const VALID_BRIEF = {
  problem: "Predictive load balancing for residential solar microgrids must hold feeder voltage while batteries shift load under bidirectional flow.",
  uncertainty: "It was unknown whether cluster-level net load could be forecast fast enough to act ahead of voltage events.",
  work: "Rule-based battery dispatch, forecast-driven dispatch and a distributed controller negotiation were built and tested in simulation.",
  advancement: "A distributed controller held voltage in band and cut excursions, with convergence under latency still open.",
};
const VALID_STYLE = {
  categories: {
    bannedWords: { addressed: true, evidence: "Never use the words \"innovative\", \"cutting-edge\" or \"novel\"" },
    paragraphDensity: { addressed: true, evidence: "Keep every paragraph to three sentences or fewer." },
    sentenceConstruction: { addressed: false, evidence: null },
    repetitionCaps: { addressed: false, evidence: null },
    openingClauses: { addressed: false, evidence: null },
    reportSkeleton: { addressed: false, evidence: null },
  },
  lockedConflicts: [],
};
const VALID_CHANGELOG = {
  title: "Excel timesheets and steadier uploads",
  summary: "You can now import Excel timesheets, and PD uploads recover from a dropped connection.",
  sections: {
    new: ["Import Excel timesheets on the financial page."],
    improved: [],
    fixed: ["PD uploads no longer fail when the connection drops for a moment."],
  },
};

type Overrides = {
  seeds?: unknown;
  draft?: string;
  digest?: unknown;
  brief?: unknown;
  style?: unknown;
  changelog?: unknown;
  judgeScore?: (text: string) => number | null;
};

/** The tool input (or text) a scripted model answers each request with. */
function answerFor(params: GenerationMessageParams, overrides: Overrides): { tool?: string; input?: unknown; text?: string } {
  const tool = params.tools?.[0]?.name;
  const user = typeof params.messages[0].content === "string"
    ? params.messages[0].content
    : params.messages[0].content.map((block) => block.text).join("");
  switch (tool) {
    case SEED_PROMPT_PROGRAM.request.toolName:
      return { tool, input: overrides.seeds ?? VALID_SEEDS };
    case QA_REQUEST.toolName:
      return { tool, input: VALID_QA };
    case CONDENSE_REQUEST.toolName:
      return { tool, input: overrides.digest ?? VALID_DIGEST };
    case RETRIEVAL_BRIEF_REQUEST.toolName:
      return { tool, input: overrides.brief ?? VALID_BRIEF };
    case STYLE_ANALYSIS_REQUEST.toolName:
      return { tool, input: overrides.style ?? VALID_STYLE };
    case JUDGE_TOOL: {
      const score = overrides.judgeScore ? overrides.judgeScore(user) : 8;
      return { tool, input: score === null ? { reason: "No grade." } : { score, reason: "Scored." } };
    }
  }
  if (params.system === CHANGELOG_SYSTEM_PROMPT) {
    return { text: JSON.stringify(overrides.changelog ?? VALID_CHANGELOG) };
  }
  return { text: overrides.draft ?? "Verdant Grid did not know whether net load could be forecast in time." };
}

/** A scripted model answering every eval task from fixtures. */
function scripted(overrides: Overrides = {}) {
  const calls: GenerationMessageParams[] = [];
  const create = async (params: GenerationMessageParams): Promise<GenerationResponse> => {
    calls.push(params);
    const answer = answerFor(params, overrides);
    return answer.tool
      ? { content: [{ type: "tool_use", id: "t", name: answer.tool, input: answer.input }] }
      : { content: [{ type: "text", text: answer.text ?? "" }] };
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

async function runOne(task: EvalTaskKind, overrides: Overrides = {}) {
  const [result] = await runEvalSet({
    tasks: [task],
    model: "m",
    makeClient: () => scripted(overrides).metered(0),
    judge: scripted(overrides).metered(0),
    judgeModel: "j",
  });
  return result;
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
    expect(model.calls.map((call) => call.tools?.[0]?.name ?? "text").sort()).toEqual(
      [QA_REQUEST.toolName, SEED_PROMPT_PROGRAM.request.toolName, "text"].sort()
    );
    expect(judge.calls.every((call) => call.model === "judge-model")).toBe(true);
  });

  it("fails schema validity on a malformed seed batch and the contract on a broken one", async () => {
    expect(await runOne("seed_batch", { seeds: { seeds: "nope" } })).toMatchObject({ schemaValid: false, contractPassed: false });
    expect(await runOne("seed_batch", { seeds: { seeds: VALID_SEEDS.seeds.slice(0, 2) } })).toMatchObject({
      schemaValid: true,
      contractPassed: false,
    });
    expect(await runOne("section_draft", { draft: "Voltage held \u2014 mostly." })).toMatchObject({ contractPassed: false });
  });

  it("finding 8: valid seeds plus one malformed seed fail schema validity", async () => {
    for (const malformed of [
      { bullets: ["An extra field."], tags: ["technical"], provenance: [], note: "not in the schema" },
      { bullets: ["A tag outside the enum."], tags: ["bold"], provenance: [] },
      { bullets: ["Provenance missing its offsets."], tags: ["technical"], provenance: [{ sourceId: "s" }] },
    ]) {
      const result = await runOne("seed_batch", { seeds: { seeds: [...VALID_SEEDS.seeds, malformed] } });
      expect(result.schemaValid).toBe(false);
      expect(result.contractPassed).toBe(false);
    }
  });

  it("finding 2: a judge that returns no valid grade leaves the rubric missing, never a free score", async () => {
    const result = await runOne("section_draft", { judgeScore: () => null });
    expect(result.rubricScore).toBeUndefined();
    const outOfRange = await runOne("section_draft", { judgeScore: () => 11 });
    expect(outOfRange.rubricScore).toBeUndefined();
  });
});

describe("finding 9: each helper role's own production task", () => {
  it("condense keeps every required fact and only verbatim quotes", async () => {
    expect(await runOne("condense_digest")).toMatchObject({ schemaValid: true, contractPassed: true, rubricScore: 8 });
    expect(
      await runOne("condense_digest", { digest: { ...VALID_DIGEST, resultsAndNumbers: ["Excursions fell a lot."] } })
    ).toMatchObject({ schemaValid: true, contractPassed: false });
    expect(
      await runOne("condense_digest", { digest: { ...VALID_DIGEST, keyQuotes: ["Marcus: \"We had no idea whether forecasting could work.\""] } })
    ).toMatchObject({ contractPassed: false });
    expect(await runOne("condense_digest", { digest: { participants: [] } })).toMatchObject({ schemaValid: false });
  });

  it("retrieval queries are usable, technical and name no one", async () => {
    expect(await runOne("retrieval_queries")).toMatchObject({ schemaValid: true, contractPassed: true });
    expect(
      await runOne("retrieval_queries", { brief: { ...VALID_BRIEF, problem: "Verdant Grid needed load balancing across its microgrid clusters." } })
    ).toMatchObject({ contractPassed: false });
    expect(await runOne("retrieval_queries", { brief: { ...VALID_BRIEF, work: "Tests." } })).toMatchObject({ contractPassed: false });
    expect(await runOne("retrieval_queries", { brief: { problem: "Only one field." } })).toMatchObject({ schemaValid: false });
  });

  it("the settings classifier finds exactly the categories the document legislates", async () => {
    expect(STYLE_EVAL_DOCUMENT).toContain("three sentences");
    expect(await runOne("style_classification")).toMatchObject({ schemaValid: true, contractPassed: true });
    const overreach = {
      ...VALID_STYLE,
      categories: { ...VALID_STYLE.categories, reportSkeleton: { addressed: true, evidence: "My rules" } },
    };
    expect(await runOne("style_classification", { style: overreach })).toMatchObject({ contractPassed: false });
    const paraphrased = {
      ...VALID_STYLE,
      categories: { ...VALID_STYLE.categories, bannedWords: { addressed: true, evidence: "avoid buzzwords" } },
    };
    expect(await runOne("style_classification", { style: paraphrased })).toMatchObject({ contractPassed: false });
  });

  it("release notes follow the changelog JSON and leak no implementation terms", async () => {
    expect(await runOne("changelog_summary")).toMatchObject({ schemaValid: true, contractPassed: true });
    expect(
      await runOne("changelog_summary", {
        changelog: { ...VALID_CHANGELOG, sections: { ...VALID_CHANGELOG.sections, fixed: ["Fixed the retry in documents.ts."] } },
      })
    ).toMatchObject({ schemaValid: true, contractPassed: false });
    expect(await runOne("changelog_summary", { changelog: { title: "Only a title" } })).toMatchObject({ schemaValid: false });
  });
});

type WireBody = {
  model: string;
  max_tokens: number;
  tools?: Array<{ name?: string; function?: { name: string } }>;
  messages: Array<{ content: unknown }>;
  system?: unknown;
};

/** A fetch stub answering both gateways from the scripted fixtures. */
function stubProviders(options: {
  hits?: string[];
  bodies?: WireBody[];
  openRouterCost?: number | null;
  openRouterOverrides?: Overrides;
  judgeScore?: (text: string) => number | null;
}) {
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(url, init);
    const body = (await request.json()) as WireBody;
    options.bodies?.push(body);
    const openRouter = request.url.includes("openrouter.ai");
    options.hits?.push(`${openRouter ? "openrouter" : "anthropic"}:${body.model}`);
    const toolName = body.tools?.[0]?.name ?? body.tools?.[0]?.function?.name;
    const system = typeof body.system === "string"
      ? body.system
      : Array.isArray(body.system)
        ? (body.system as Array<{ text?: string }>).map((block) => block.text ?? "").join("")
        : (body.messages[0] as { role?: string; content?: unknown })?.role === "system"
          ? String((body.messages[0] as { content: unknown }).content)
          : undefined;
    const text = JSON.stringify(body.messages);
    const overrides: Overrides = {
      draft: openRouter ? "GROK DRAFT of the uncertainty." : "Sonnet draft of the uncertainty.",
      ...(openRouter ? options.openRouterOverrides : {}),
      judgeScore: options.judgeScore ?? ((user) => (user.includes("GROK") ? 9 : 7)),
    };
    const answer = answerFor(
      {
        model: body.model,
        max_tokens: body.max_tokens,
        system: system ?? (text.includes("You write release notes for Banhall") ? CHANGELOG_SYSTEM_PROMPT : undefined),
        messages: [{ role: "user", content: text }],
        ...(toolName ? { tools: [{ name: toolName, input_schema: { type: "object" } }] } : {}),
      },
      overrides
    );
    if (openRouter) {
      return Response.json({
        choices: [{
          message: answer.tool
            ? { content: null, tool_calls: [{ id: "c", function: { name: answer.tool, arguments: JSON.stringify(answer.input) } }] }
            : { content: answer.text },
          finish_reason: answer.tool ? "tool_calls" : "stop",
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          ...(options.openRouterCost === null ? {} : { cost: options.openRouterCost ?? 0.0003 }),
        },
      });
    }
    return Response.json({
      id: "msg", type: "message", role: "assistant", model: body.model,
      content: answer.tool ? [{ type: "tool_use", id: "tu", name: answer.tool, input: answer.input }] : [{ type: "text", text: answer.text }],
      stop_reason: answer.tool ? "tool_use" : "end_turn", stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  }));
}

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

  async function setup(role: "writing" | "condense", candidate = "x-ai/grok-4.7") {
    const t = convexTest(schema, modules);
    await t.mutation(applyCatalogRefreshRef, {
      models: parseOpenRouterModels(fixture, NOW).models,
      fetchedAt: NOW,
      complete: false,
    });
    const evaluationId = await t.run((ctx) =>
      ctx.db.insert("modelEvaluations", {
        role,
        modelId: candidate,
        incumbentModelId: "claude-sonnet-5",
        evalSetVersion: "banhall-eval/v1",
        status: "queued",
        estimatedCostUsd: 0.5,
        createdAt: NOW,
      })
    );
    return { t, evaluationId };
  }

  it("runs candidate and incumbent through both gateways, judges on the writing model and promotes on a pass", async () => {
    const { t, evaluationId } = await setup("writing");
    const hits: string[] = [];
    stubProviders({ hits });
    await t.action(runEvaluationRef, { evaluationId });
    const evaluation = await t.run((ctx) => ctx.db.get(evaluationId));
    expect(evaluation).toMatchObject({ status: "passed", outcome: "promoted" });
    // Judged 9 on its draft and 7 on the shared seed batch: mean 8.
    expect(evaluation?.candidate).toMatchObject({ schemaValidity: 1, contractPassRate: 1, rubricScore: 8 });
    expect(evaluation?.incumbent).toMatchObject({ rubricScore: 7 });
    expect(evaluation?.evalCostUsd).toBeGreaterThan(0);
    expect(evaluation?.reservedCostUsd).toBeUndefined();
    expect(hits.filter((hit) => hit.startsWith("openrouter:x-ai/grok-4.7"))).toHaveLength(3);
    expect(hits.filter((hit) => hit === "anthropic:claude-sonnet-5").length).toBeGreaterThanOrEqual(3 + 4);
    const assignment = await t.run((ctx) =>
      ctx.db.query("modelRoleAssignments").withIndex("by_role", (q) => q.eq("role", "writing")).unique()
    );
    expect(assignment?.modelId).toBe("x-ai/grok-4.7");
  });

  it("finding 9: evaluates the condense role on condensing, and promotes on its own task", async () => {
    const { t, evaluationId } = await setup("condense");
    const hits: string[] = [];
    stubProviders({
      hits,
      openRouterOverrides: { digest: { ...VALID_DIGEST, namesAndSystems: ["distributed negotiation", "GROK MARKER"] } },
    });
    await t.action(runEvaluationRef, { evaluationId });
    const evaluation = await t.run((ctx) => ctx.db.get(evaluationId));
    expect(evaluation).toMatchObject({ status: "passed", outcome: "promoted" });
    expect(evaluation?.candidate).toMatchObject({ tasks: 1, schemaValidity: 1, contractPassRate: 1, rubricScore: 9 });
    // Only the condense task ran: one call per model plus one judge call each.
    expect(hits.filter((hit) => hit.startsWith("openrouter:"))).toHaveLength(1);
    expect(hits.filter((hit) => hit.startsWith("anthropic:"))).toHaveLength(3);
  });

  it("finding 3: meters a catalog-only model without a native cost at its catalog price", async () => {
    const { t, evaluationId } = await setup("writing");
    const grok = await t.run((ctx) =>
      ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", "x-ai/grok-4.7")).first()
    );
    // The static table does not know this model; the catalog lists it at $5/$25.
    await t.run((ctx) => ctx.db.patch(grok!._id, { inputUsdPerMTok: 5, outputUsdPerMTok: 25 }));
    stubProviders({ openRouterCost: null });
    await t.action(runEvaluationRef, { evaluationId });
    const evaluation = await t.run((ctx) => ctx.db.get(evaluationId));
    const perCall = (100 * 5 + 20 * 25) / 1_000_000;
    const sonnetCall = (100 * 2 + 20 * 10) / 1_000_000;
    expect(evaluation?.candidate?.costUsd).toBeCloseTo(3 * perCall, 12);
    expect(evaluation?.incumbent?.costUsd).toBeCloseTo(3 * sonnetCall, 12);
    // Two judged tasks per side, on Sonnet.
    expect(evaluation?.evalCostUsd).toBeCloseTo(3 * perCall + 3 * sonnetCall + 4 * sonnetCall, 12);
    // $0.003 against a $0.0012 incumbent is 2.5 times: over the 2x cap.
    expect(evaluation).toMatchObject({ status: "failed", outcome: "held back: cost" });
  });
});

describe("finding 7: the request envelope bounds every real request", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    resetRegisteredModelEntries();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetRegisteredModelEntries();
  });

  it("never sends more output budget, requests or input than the reservation assumes", async () => {
    const t = convexTest(schema, modules);
    const reasoning = {
      id: "x-ai/grok-4.7",
      label: "Grok 4.7",
      provider: "xAI",
      gateway: "openrouter" as const,
      reasoning: true,
      maxCompletionTokens: 450000,
    };
    const bodies: WireBody[] = [];
    stubProviders({ bodies, openRouterCost: 0.001 });
    for (const task of EVAL_TASK_KINDS) {
      bodies.length = 0;
      await t.action(async (ctx) => {
        registerModelEntries([reasoning]);
        const pricing = { input: 1.6, output: 4.8 };
        await runEvalSet({
          tasks: [task],
          model: reasoning.id,
          makeClient: (kind) => evalClient(ctx, reasoning, kind, pricing),
          judge: evalClient(ctx, reasoning, "judge", pricing),
          judgeModel: reasoning.id,
        });
      });
      const bound = EVAL_ENVELOPE[task];
      const judgeBound = EVAL_ENVELOPE.judge;
      const judged = bodies.filter((body) => body.tools?.[0]?.function?.name === JUDGE_TOOL);
      const own = bodies.filter((body) => body.tools?.[0]?.function?.name !== JUDGE_TOOL);
      expect(own.length, task).toBeGreaterThan(0);
      expect(own.length, task).toBeLessThanOrEqual(bound.requests);
      for (const body of own) {
        expect(body.max_tokens, task).toBeLessThanOrEqual(maxRequestOutputTokens(reasoning, bound));
        // Characters over-count tokens several times; half of them is a safe ceiling.
        expect(JSON.stringify(body).length / 2, task).toBeLessThanOrEqual(bound.maxInputTokens);
      }
      for (const body of judged) {
        expect(body.max_tokens).toBeLessThanOrEqual(maxRequestOutputTokens(reasoning, judgeBound));
        expect(JSON.stringify(body).length / 2).toBeLessThanOrEqual(judgeBound.maxInputTokens);
      }
    }
    // The reservation for a full writing evaluation covers every request.
    const priced = { gateway: "openrouter" as const, reasoning: true, maxCompletionTokens: 450000, inputUsdPerMTok: 1.6, outputUsdPerMTok: 4.8 };
    expect(
      maxEvaluationCostUsd({ tasks: ROLE_POLICIES.writing.evalTasks, envelope: EVAL_ENVELOPE, candidate: priced, incumbent: priced, judge: priced })
    ).toBeGreaterThan(0);
  });
});
