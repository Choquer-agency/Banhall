import { describe, expect, test } from "vitest";
import fixture from "./__fixtures__/openrouter-models-2026-09-24.json";
import { CANDIDATE_MODELS } from "./generationModels";
import {
  AUTOMATION_THRESHOLDS,
  ROLE_POLICIES,
  artificialAnalysisScore,
  bestIntelligenceScore,
  diffCatalog,
  estimateEvaluationCostUsd,
  maxPriceFor,
  openRouterProviderPreferences,
  parseArtificialAnalysis,
  parseCostCap,
  parseEndpointSupport,
  parseOpenRouterModels,
  prefilterCandidate,
  productionErrorVerdict,
  promotionGates,
  refreshedFields,
  seedCatalogModels,
  selectEvaluations,
  summarizeEvalRun,
  type CatalogModel,
  type EvalSummary,
  type ExistingCatalogRow,
  type ParsedModel,
  type PrefilterModel,
} from "./modelCatalog";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const parsed = parseOpenRouterModels(fixture, NOW);
const bySlug = (slug: string) => {
  const model = parsed.models.find((m) => m.openRouterId === slug);
  if (!model) throw new Error(`fixture is missing ${slug}`);
  return model;
};

describe("OpenRouter catalog parsing", () => {
  test("skips aliases and variants and keeps one row per canonical slug", () => {
    const ids = parsed.models.map((model) => model.openRouterId);
    expect(ids).not.toContain("~openai/gpt-sol-latest");
    expect(ids.some((id) => id.includes(":"))).toBe(false);
    expect(parsed.skipped.alias).toBe(1);
    expect(parsed.skipped.variant).toBe(1);
    expect(new Set(parsed.models.map((m) => m.canonicalSlug)).size).toBe(parsed.models.length);
  });

  test("converts per-token prices to USD per million tokens and reads flags", () => {
    const opus = bySlug("anthropic/claude-opus-5.5");
    expect(opus.canonicalSlug).toBe("anthropic/claude-opus-5.5-20260921");
    expect(opus.inputUsdPerMTok).toBe(4);
    expect(opus.outputUsdPerMTok).toBe(20);
    expect(opus.provider).toBe("Anthropic");
    expect(opus.displayName).toBe("Claude Opus 5.5");
    expect(opus.supportsTools).toBe(true);
    expect(opus.supportsStructuredOutputs).toBe(true);
    expect(opus.contextLength).toBe(1_000_000);
    expect(opus.maxOutputTokens).toBe(128_000);
    expect(bestIntelligenceScore(opus.benchmarks)).toEqual({
      value: 57.6,
      source: "openrouter_aa",
    });
  });

  test("records expiration dates", () => {
    expect(bySlug("deepseek/deepseek-v3.2").expirationDate).toBe("2026-09-28");
  });
});

function row(model: ParsedModel, overrides: Partial<ExistingCatalogRow> = {}): ExistingCatalogRow {
  return {
    modelId: model.openRouterId,
    gateway: "openrouter",
    canonicalSlug: model.canonicalSlug,
    status: "candidate",
    ...overrides,
  };
}

describe("catalog diffing", () => {
  test("flags new tool-capable models only", () => {
    const changes = diffCatalog([], parsed.models, NOW);
    const added = changes.filter((c) => c.kind === "new").map((c) => c.kind === "new" && c.model.openRouterId);
    expect(added).toContain("x-ai/grok-4.7");
    const noTools = parsed.models.filter((m) => !m.supportsTools).map((m) => m.openRouterId);
    expect(noTools.length).toBeGreaterThan(0);
    for (const id of noTools) expect(added).not.toContain(id);
  });

  test("detects a rename by canonical slug", () => {
    const grok = bySlug("x-ai/grok-4.7");
    const changes = diffCatalog([row(grok, { modelId: "x-ai/grok-4.7-old" })], [grok], NOW);
    expect(changes).toContainEqual({
      kind: "renamed",
      modelId: "x-ai/grok-4.7-old",
      fromId: "x-ai/grok-4.7-old",
      toId: "x-ai/grok-4.7",
    });
    expect(changes.some((c) => c.kind === "new")).toBe(false);
  });

  test("detects a model expiring within 30 days", () => {
    const deepseek = bySlug("deepseek/deepseek-v3.2");
    const changes = diffCatalog([row(deepseek)], [deepseek], NOW);
    expect(changes).toContainEqual({
      kind: "expiring",
      modelId: "deepseek/deepseek-v3.2",
      expirationDate: "2026-09-28",
      daysLeft: 4,
    });
  });

  test("marks a vanished OpenRouter model gone once, never a direct Anthropic row", () => {
    const grok = bySlug("x-ai/grok-4.7");
    const gone = diffCatalog(
      [
        row(grok),
        { modelId: "claude-opus-4-8", gateway: "anthropic", canonicalSlug: "anthropic/not-listed", status: "enabled" },
      ],
      [],
      NOW
    );
    expect(gone).toEqual([{ kind: "gone", modelId: "x-ai/grok-4.7" }]);
    expect(diffCatalog([row(grok, { missingSince: NOW - 1 })], [], NOW)).toEqual([]);
    expect(diffCatalog([row(grok, { missingSince: NOW - 1 })], [grok], NOW)).toContainEqual({
      kind: "returned",
      modelId: "x-ai/grok-4.7",
    });
  });

  test("adopts a seed row by id when its recorded slug drifted", () => {
    const sol = bySlug("openai/gpt-5.6-sol");
    const changes = diffCatalog(
      [row(sol, { canonicalSlug: "openai/gpt-5.6-sol-old", status: "enabled" })],
      [sol],
      NOW
    );
    expect(changes.some((c) => c.kind === "new")).toBe(false);
    // Same id still listed: adopted, never also reported gone (finding 10).
    expect(changes.some((c) => c.kind === "gone")).toBe(false);
    expect(changes).toContainEqual({ kind: "update", modelId: "openai/gpt-5.6-sol", model: sol });
    // A drifted row already marked missing comes back on adoption.
    const back = diffCatalog(
      [row(sol, { canonicalSlug: "openai/gpt-5.6-sol-old", status: "enabled", missingSince: NOW - 1 })],
      [sol],
      NOW
    );
    expect(back).toContainEqual({ kind: "returned", modelId: "openai/gpt-5.6-sol" });
  });

  test("a refresh keeps seed declarations and never reprices direct rows", () => {
    const gemini = bySlug("google/gemini-3.5-flash");
    const seedRefresh = refreshedFields({ source: "seed", gateway: "openrouter", modelId: gemini.openRouterId }, gemini);
    expect(seedRefresh.reasoning).toBeUndefined();
    expect(seedRefresh.maxCompletionTokens).toBeUndefined();
    expect(seedRefresh.displayName).toBeUndefined();
    expect(seedRefresh.inputUsdPerMTok).toBe(gemini.inputUsdPerMTok);
    const sonnet = bySlug("anthropic/claude-sonnet-5");
    const direct = refreshedFields({ source: "seed", gateway: "anthropic", modelId: "claude-sonnet-5" }, sonnet);
    expect(direct.inputUsdPerMTok).toBeUndefined();
    expect(direct.requestId).toBeUndefined();
    expect(direct.benchmarks?.length).toBeGreaterThan(0);
  });
});

describe("catalog seed", () => {
  test("seeds every candidate model enabled, keeping reasoning and max output", () => {
    const seeds = seedCatalogModels(NOW);
    expect(seeds.map((s) => s.modelId)).toEqual(CANDIDATE_MODELS.map((m) => m.id));
    for (const seed of seeds) expect(seed.status).toBe("enabled");
    const gemini = seeds.find((s) => s.modelId === "google/gemini-3.5-flash")!;
    expect(gemini.reasoning).toBe(true);
    expect(gemini.maxCompletionTokens).toBe(65536);
    const sonnet = seeds.find((s) => s.modelId === "claude-sonnet-5")!;
    expect(sonnet.reasoning).toBe(false);
    expect(sonnet.inputUsdPerMTok).toBe(2);
    expect(sonnet.canonicalSlug).toBe("anthropic/claude-sonnet-5-20260630");
  });
});

function candidateView(model: ParsedModel, overrides: Partial<PrefilterModel> = {}): PrefilterModel {
  return {
    modelId: model.openRouterId,
    gateway: "openrouter",
    status: "candidate",
    inputUsdPerMTok: model.inputUsdPerMTok,
    outputUsdPerMTok: model.outputUsdPerMTok,
    contextLength: model.contextLength,
    maxOutputTokens: model.maxOutputTokens,
    supportsTools: model.supportsTools,
    supportsStructuredOutputs: model.supportsStructuredOutputs,
    expirationDate: model.expirationDate,
    benchmarks: model.benchmarks,
    ...overrides,
  };
}

const incumbent: PrefilterModel = {
  ...candidateView(bySlug("anthropic/claude-sonnet-5")),
  modelId: "claude-sonnet-5",
  gateway: "anthropic",
  status: "enabled",
};
const writingCap = ROLE_POLICIES.writing.defaultCostCap;

describe("prefilter", () => {
  test("passes a stronger, capable model within the cap", () => {
    const result = prefilterCandidate({
      role: "writing",
      candidate: candidateView(bySlug("openai/gpt-6-sol")),
      incumbent,
      cap: writingCap,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, reasons: [], score: 47.5, incumbentScore: 38.2 });
  });

  test.each([
    ["over the role's price cap", { inputUsdPerMTok: 10 }],
    ["missing tools or structured outputs", { supportsStructuredOutputs: false }],
    ["context too small", { contextLength: 100_000 }],
    ["output limit too small", { maxOutputTokens: 8_000 }],
    ["expires within 30 days", { expirationDate: "2026-10-01" }],
    ["no longer listed", { missingSince: NOW - 1 }],
    ["no endpoint serves tools and structured outputs", { endpointSupport: { checkedAt: NOW, endpointCount: 2, toolsAndStructuredProviders: [] } }],
    ["benchmark not better by the margin", { benchmarks: [{ source: "openrouter_aa" as const, metric: "intelligence_index" as const, value: 39, fetchedAt: NOW }] }],
    ["no benchmark score", { benchmarks: [] }],
  ])("rejects: %s", (reason, overrides) => {
    const result = prefilterCandidate({
      role: "writing",
      candidate: candidateView(bySlug("openai/gpt-6-sol"), overrides as Partial<PrefilterModel>),
      incumbent,
      cap: writingCap,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  test("keeps chat on direct Anthropic models and honours the block list", () => {
    const chat = prefilterCandidate({
      role: "chat",
      candidate: candidateView(bySlug("openai/gpt-6-sol")),
      incumbent,
      cap: ROLE_POLICIES.chat.defaultCostCap,
      now: NOW,
    });
    expect(chat.reasons).toContain("gateway not allowed for role");
    const blocked = prefilterCandidate({
      role: "writing",
      candidate: candidateView(bySlug("openai/gpt-6-sol")),
      incumbent,
      cap: writingCap,
      now: NOW,
      blocked: true,
    });
    expect(blocked.reasons).toEqual(["evaluated recently or rolled back"]);
  });

  test("a cheaper cost cap excludes an otherwise eligible model", () => {
    const result = prefilterCandidate({
      role: "writing",
      candidate: candidateView(bySlug("openai/gpt-6-sol")),
      incumbent,
      cap: { maxInputUsdPerMTok: 1, maxOutputUsdPerMTok: 5, maxCostRatio: 2 },
      now: NOW,
    });
    expect(result.reasons).toEqual(["over the role's price cap"]);
  });
});

describe("evaluation selection caps", () => {
  const item = (role: "writing" | "analysis" | "condense", modelId: string, score: number, cost = 1) => ({
    role,
    modelId,
    score,
    estimatedCostUsd: cost,
  });

  test("takes at most two per run, one per role, best score first", () => {
    const { selected, deferred } = selectEvaluations({
      eligible: [item("writing", "a", 40), item("writing", "b", 50), item("analysis", "c", 45), item("condense", "d", 44)],
      budgetRemainingUsd: 100,
    });
    expect(selected.map((s) => s.modelId)).toEqual(["b", "c"]);
    expect(deferred.map((s) => s.modelId)).toEqual(["d", "a"]);
  });

  test("stops when the monthly budget cannot cover the estimate", () => {
    const { selected } = selectEvaluations({
      eligible: [item("writing", "a", 50, 3), item("analysis", "b", 45, 3)],
      budgetRemainingUsd: 4,
    });
    expect(selected.map((s) => s.modelId)).toEqual(["a"]);
    expect(selectEvaluations({ eligible: [item("writing", "a", 50, 3)], budgetRemainingUsd: 0 }).selected).toEqual([]);
  });

  test("estimates reasoning models at twice the output", () => {
    const plain = estimateEvaluationCostUsd([{ inputUsdPerMTok: 1, outputUsdPerMTok: 10, reasoning: false }]);
    const reasoning = estimateEvaluationCostUsd([{ inputUsdPerMTok: 1, outputUsdPerMTok: 10, reasoning: true }]);
    expect(plain).toBeCloseTo(0.06 + 0.12, 10);
    expect(reasoning).toBeCloseTo(0.06 + 0.24, 10);
  });
});

describe("eval scoring and promotion gates", () => {
  const incumbentSummary: EvalSummary = {
    schemaValidity: 1,
    contractPassRate: 0.5,
    rubricScore: 7,
    costUsd: 0.2,
    tasks: 3,
  };
  const passing: EvalSummary = {
    schemaValidity: 1,
    contractPassRate: 1,
    rubricScore: 7.5,
    costUsd: 0.3,
    tasks: 3,
  };
  const prices = { inputUsdPerMTok: 2, outputUsdPerMTok: 10 };

  test("summarizes schema validity, contract pass rate, rubric and cost", () => {
    expect(
      summarizeEvalRun([
        { task: "seed_batch", structured: true, schemaValid: true, contractPassed: true, rubricScore: 8, costUsd: 0.1 },
        { task: "section_draft", structured: false, schemaValid: true, rubricScore: 6, costUsd: 0.05 },
        { task: "qa_structured", structured: true, schemaValid: false, contractPassed: false, costUsd: 0.02 },
      ])
    ).toEqual({ schemaValidity: 0.5, contractPassRate: 0.5, rubricScore: 7, costUsd: 0.17, tasks: 3 });
  });

  test("promotes when every gate passes", () => {
    const result = promotionGates({ candidate: passing, incumbent: incumbentSummary, candidatePrices: prices, cap: writingCap });
    expect(result.passed).toBe(true);
    expect(result.gates.map((g) => g.passed)).toEqual([true, true, true, true]);
  });

  test.each([
    ["schema_validity", { schemaValidity: 0.99 }],
    ["contract_pass_rate", { contractPassRate: 0.4 }],
    ["rubric", { rubricScore: 7.4 }],
    ["cost", { costUsd: 0.41 }],
  ] as const)("holds back when %s fails", (gate, overrides) => {
    const result = promotionGates({
      candidate: { ...passing, ...overrides },
      incumbent: incumbentSummary,
      candidatePrices: prices,
      cap: writingCap,
    });
    expect(result.passed).toBe(false);
    expect(result.gates.filter((g) => !g.passed).map((g) => g.gate)).toEqual([gate]);
  });

  test("the cost gate also fails on per-token prices above the cap", () => {
    const result = promotionGates({
      candidate: passing,
      incumbent: incumbentSummary,
      candidatePrices: { inputUsdPerMTok: 6, outputUsdPerMTok: 10 },
      cap: writingCap,
    });
    expect(result.gates.find((g) => g.gate === "cost")).toMatchObject({ passed: false, detail: "price over the role's cap" });
  });
});

describe("production error rollback", () => {
  test("rolls back above the error rate once enough calls ran", () => {
    expect(productionErrorVerdict({ successes: 15, failures: 5 })).toEqual({ rollback: true, calls: 20, failures: 5, errorRate: 0.25 });
    expect(productionErrorVerdict({ successes: 16, failures: 4 }).rollback).toBe(false);
    expect(productionErrorVerdict({ successes: 2, failures: 10 }).rollback).toBe(false);
    expect(productionErrorVerdict({ successes: 0, failures: 0 })).toMatchObject({ rollback: false, errorRate: 0 });
    expect(AUTOMATION_THRESHOLDS.maxErrorRate).toBe(0.2);
  });
});

describe("settings, endpoints and routing", () => {
  test("parses cost caps with per-field fallback", () => {
    expect(parseCostCap(undefined, writingCap)).toBe(writingCap);
    expect(parseCostCap("nope", writingCap)).toBe(writingCap);
    expect(parseCostCap(JSON.stringify({ maxInputUsdPerMTok: 1, maxOutputUsdPerMTok: -1 }), writingCap)).toEqual({
      maxInputUsdPerMTok: 1,
      maxOutputUsdPerMTok: writingCap.maxOutputUsdPerMTok,
      maxCostRatio: writingCap.maxCostRatio,
    });
  });

  test("reads per-provider endpoint support", () => {
    const support = parseEndpointSupport(
      {
        data: {
          endpoints: [
            { provider_name: "OpenAI", status: 0, supported_parameters: ["tools", "structured_outputs"] },
            { provider_name: "Azure", status: 0, supported_parameters: ["tools"] },
          ],
        },
      },
      NOW
    );
    expect(support).toEqual({ checkedAt: NOW, endpointCount: 2, toolsAndStructuredProviders: ["OpenAI"] });
  });

  test("requires parameters on tool calls and raises max price to an explicit pick", () => {
    expect(openRouterProviderPreferences({ usesTools: false })).toBeUndefined();
    expect(openRouterProviderPreferences({ usesTools: true, maxPrice: { prompt: 5, completion: 30 } })).toEqual({
      require_parameters: true,
      max_price: { prompt: 5, completion: 30 },
    });
    expect(maxPriceFor(writingCap, { inputUsdPerMTok: 10, outputUsdPerMTok: 20 })).toEqual({ prompt: 10, completion: 30 });
  });

  test("matches Artificial Analysis scores by normalized name", () => {
    const index = parseArtificialAnalysis({
      data: [{ slug: "gpt-6-sol", name: "GPT-6 Sol", evaluations: { artificial_analysis_intelligence_index: 48 } }],
    });
    expect(artificialAnalysisScore({ modelId: "openai/gpt-6-sol", displayName: "GPT-6 Sol" }, index)).toBe(48);
    expect(bestIntelligenceScore([
      { source: "openrouter_aa", metric: "intelligence_index", value: 47.5, fetchedAt: NOW },
      { source: "artificial_analysis", metric: "intelligence_index", value: 48, fetchedAt: NOW },
    ])).toEqual({ value: 48, source: "artificial_analysis" });
  });
});

// Keep the type import honest: a CatalogModel is a superset of the fields.
const _typeCheck: Pick<CatalogModel, "modelId"> = { modelId: "x" };
void _typeCheck;
