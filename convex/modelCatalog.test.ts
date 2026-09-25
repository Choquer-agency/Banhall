/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import fixture from "../shared/__fixtures__/openrouter-models-2026-09-24.json";
import { parseOpenRouterModels, type EvalTaskResult, type ModelRole } from "../shared/modelCatalog";
import {
  adminStateRef,
  applyCatalogRefreshRef,
  checkProductionErrorsRef,
  claimEvaluationRef,
  completeEvaluationRef,
  planEvaluationsRef,
  refreshCatalogRef,
  rollbackRoleRef,
  setAutoSwitchRef,
  setEvalBudgetRef,
  setRoleCostCapRef,
  setRoleModelRef,
} from "./lib/modelCatalogRefs";
import { generationPromptVersion } from "./ai/promptProgram";
import { EVAL_ENVELOPE } from "./ai/modelEvaluation";
import { MODEL_ROLES, ROLE_POLICIES, maxEvaluationCostUsd } from "../shared/modelCatalog";
import { recordCallOutcomeRef } from "./lib/modelCatalogRefs";
import { roleAutoSwitches } from "../shared/modelCatalog";
import reviewAgentSource from "./ai/reviewAgent.ts?raw";
import financialAgentSource from "./ai/financialAgent.ts?raw";
import ingestSource from "./ai/brain/ingest.ts?raw";
import learningSource from "./ai/learning.ts?raw";
import scienceCodeSource from "./scienceCodeSuggestions.ts?raw";
import modelFeedbackSource from "./ai/modelFeedback.ts?raw";
import changelogSource from "./ai/changelogPipeline.ts?raw";
import styleAnalysisSource from "./ai/styleAnalysis.ts?raw";
import { guardProviderNetwork } from "../tests/providerNetworkGuard";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

const NOW = Date.parse("2026-09-24T12:00:00Z");
const parsed = parseOpenRouterModels(fixture, NOW).models;
const ADMIN = "catalog-admin";
const WRITER = "catalog-writer";

guardProviderNetwork();
// Every timer is fake, not just Date: convex-test starts scheduled
// functions on setTimeout, and a planned evaluation or a reserved
// generation left to run by itself would call model providers. Tests that
// need scheduled work drive it themselves.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", { authId: ADMIN, role: "admin" });
    const writerId = await ctx.db.insert("users", { authId: WRITER, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Catalog project",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      shareToken: "catalog-token",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("transcripts", { projectId, content: "Interview body", createdAt: NOW });
    return { adminId, writerId, projectId };
  });
  await t.mutation(applyCatalogRefreshRef, { models: parsed, fetchedAt: NOW, complete: false });
  return {
    t,
    admin: t.withIdentity({ subject: ADMIN }),
    writer: t.withIdentity({ subject: WRITER }),
    ...ids,
  };
}

const row = (t: TestConvex, modelId: string) =>
  t.run((ctx) =>
    ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).first()
  );
const notices = (t: TestConvex) =>
  t.run((ctx) => ctx.db.query("errorReports").collect()).then((rows) =>
    rows.filter((r) => r.source === "model-catalog").map((r) => r.message)
  );
const writingModel = async (t: TestConvex) =>
  (await t.run((ctx) =>
    ctx.db.query("modelRoleAssignments").withIndex("by_role", (q) => q.eq("role", "writing")).unique()
  ))?.modelId ?? "claude-sonnet-5";

function results(overrides: Partial<EvalTaskResult> = {}): EvalTaskResult[] {
  return [
    { task: "seed_batch", structured: true, schemaValid: true, contractPassed: true, rubricScore: 8, costUsd: 0.05, ...overrides },
    { task: "section_draft", structured: false, schemaValid: true, contractPassed: true, rubricScore: 8, costUsd: 0.03 },
    { task: "qa_structured", structured: true, schemaValid: true, contractPassed: true, costUsd: 0.02 },
  ];
}
const incumbentResults = (): EvalTaskResult[] => [
  { task: "seed_batch", structured: true, schemaValid: true, contractPassed: true, rubricScore: 7, costUsd: 0.04 },
  { task: "section_draft", structured: false, schemaValid: true, contractPassed: true, rubricScore: 7, costUsd: 0.03 },
  { task: "qa_structured", structured: true, schemaValid: true, contractPassed: true, costUsd: 0.02 },
];

/** Queue and claim a writing-role evaluation of `modelId`. */
async function runningEvaluation(t: TestConvex, modelId: string, role: "writing" = "writing") {
  const evaluationId = await t.run((ctx) =>
    ctx.db.insert("modelEvaluations", {
      role,
      modelId,
      incumbentModelId: "claude-sonnet-5",
      evalSetVersion: "banhall-eval/v1",
      status: "queued",
      estimatedCostUsd: 0.5,
      createdAt: NOW,
    })
  );
  const claim = await t.mutation(claimEvaluationRef, { evaluationId, envelope: EVAL_ENVELOPE });
  expect(claim?.candidate.id).toBe(modelId);
  return evaluationId;
}

async function promote(t: TestConvex, modelId: string) {
  const evaluationId = await runningEvaluation(t, modelId);
  expect(
    await t.mutation(completeEvaluationRef, {
      evaluationId,
      candidateResults: results(),
      incumbentResults: incumbentResults(),
      evalCostUsd: 0.2,
    })
  ).toBe("promoted");
  return evaluationId;
}

describe("catalog refresh", () => {
  it("seeds the candidate models enabled and adds tool-capable OpenRouter models as candidates", async () => {
    const { t } = await setup();
    const gemini = await row(t, "google/gemini-3.5-flash");
    expect(gemini).toMatchObject({ status: "enabled", source: "seed", reasoning: true, maxCompletionTokens: 65536 });
    expect(await row(t, "claude-sonnet-5")).toMatchObject({ status: "enabled", gateway: "anthropic" });
    expect(await row(t, "x-ai/grok-4.7")).toMatchObject({ status: "candidate", source: "openrouter" });
    const all = await t.run((ctx) => ctx.db.query("modelCatalog").collect());
    expect(all.some((r) => r.modelId.startsWith("~") || r.modelId.includes(":"))).toBe(false);
    // Direct Anthropic rows borrow OpenRouter's benchmark but keep their own price.
    const sonnet = await row(t, "claude-sonnet-5");
    expect(sonnet?.benchmarks.find((b) => b.metric === "intelligence_index")?.value).toBe(38.2);
    expect(sonnet?.inputUsdPerMTok).toBe(2);
  });

  it("keeps seed reasoning and max-output declarations when the provider disagrees", async () => {
    const { t } = await setup();
    const drifted = parsed.map((model) =>
      model.openRouterId === "google/gemini-3.5-flash"
        ? { ...model, reasoning: false, maxCompletionTokens: 12345, inputUsdPerMTok: 1.25 }
        : model
    );
    await t.mutation(applyCatalogRefreshRef, { models: drifted, fetchedAt: NOW, complete: false });
    expect(await row(t, "google/gemini-3.5-flash")).toMatchObject({
      reasoning: true,
      maxCompletionTokens: 65536,
      inputUsdPerMTok: 1.25,
    });
  });

  it("notifies admins once for an in-use model that is renamed, expiring or gone", async () => {
    const { t } = await setup();
    const deepseek = await row(t, "deepseek/deepseek-v3.2");
    const grok = await row(t, "x-ai/grok-4.7");
    await t.run(async (ctx) => {
      await ctx.db.patch(deepseek!._id, { status: "enabled" });
      await ctx.db.patch(grok!._id, { status: "enabled" });
    });
    const next = parsed
      .filter((model) => model.openRouterId !== "x-ai/grok-4.7")
      .map((model) =>
        model.openRouterId === "openai/gpt-5.6-sol" ? { ...model, openRouterId: "openai/gpt-5.6-sol-v2" } : model
      );
    for (let run = 0; run < 2; run += 1) {
      await t.mutation(applyCatalogRefreshRef, { models: next, fetchedAt: NOW, complete: true });
    }
    const messages = await notices(t);
    expect(messages.filter((m) => m.includes("renamed"))).toHaveLength(1);
    expect(messages.filter((m) => m.includes("retired on 2026-09-28"))).toHaveLength(1);
    expect(messages.filter((m) => m.includes("no longer listed"))).toHaveLength(1);
    expect(await row(t, "openai/gpt-5.6-sol")).toMatchObject({ requestId: "openai/gpt-5.6-sol-v2", modelId: "openai/gpt-5.6-sol" });
    // An enabled model that vanished keeps its status; a candidate is retired.
    expect(await row(t, "x-ai/grok-4.7")).toMatchObject({ status: "enabled" });
    const glm = parsed.filter((model) => model.openRouterId !== "z-ai/glm-5.3");
    await t.mutation(applyCatalogRefreshRef, { models: glm, fetchedAt: NOW, complete: true });
    expect(await row(t, "z-ai/glm-5.3")).toMatchObject({ status: "retired" });
  });

  it("never marks models gone from a partial pull", async () => {
    const { t } = await setup();
    await t.mutation(applyCatalogRefreshRef, { models: [], fetchedAt: NOW, complete: false });
    const grok = await row(t, "x-ai/grok-4.7");
    expect(grok?.status).toBe("candidate");
    expect(grok?.missingSince).toBeUndefined();
  });

  it("runs the daily job end to end from OpenRouter's public API with no key", async () => {
    const { t } = await setup();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      if (url.endsWith("/api/v1/models")) return Response.json(fixture);
      return Response.json({
        data: { endpoints: [{ provider_name: "OpenAI", status: 0, supported_parameters: ["tools", "structured_outputs"] }] },
      });
    }));
    const result = await t.action(refreshCatalogRef, {});
    expect(result.fetched).toBe(parsed.length);
    expect(urls[0]).toBe("https://openrouter.ai/api/v1/models");
    expect(urls.some((url) => url.includes("/openai/gpt-5.6-sol-20260709/endpoints"))).toBe(true);
    expect(await row(t, "openai/gpt-5.6-sol")).toMatchObject({
      endpointSupport: { toolsAndStructuredProviders: ["OpenAI"] },
    });
    expect(result.evaluationsQueued).toBeLessThanOrEqual(2);
  });
});

describe("evaluation planning", () => {
  it("queues at most two evaluations, one per role, each beating its role on paper", async () => {
    const { t } = await setup();
    const ids = await t.mutation(planEvaluationsRef, {});
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(2);
    const queued = await t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
    expect(new Set(queued.map((e) => e?.role)).size).toBe(queued.length);
    for (const evaluation of queued) {
      expect(evaluation?.status).toBe("queued");
      expect(evaluation!.benchmarkScore!).toBeGreaterThanOrEqual((evaluation!.incumbentBenchmarkScore ?? 0) + 2);
    }
    // A second run the same day queues nothing for roles still pending.
    const again = await t.mutation(planEvaluationsRef, {});
    const again2 = await t.run((ctx) => Promise.all(again.map((id) => ctx.db.get(id))));
    for (const evaluation of again2) expect(queued.map((e) => e?.role)).not.toContain(evaluation?.role);
  });

  it("queues nothing with the kill switch off or the month's budget spent", async () => {
    const { t, admin } = await setup();
    await admin.mutation(setAutoSwitchRef, { enabled: false });
    expect(await t.mutation(planEvaluationsRef, {})).toEqual([]);
    await admin.mutation(setAutoSwitchRef, { enabled: true });
    await admin.mutation(setEvalBudgetRef, { monthlyUsd: 0 });
    expect(await t.mutation(planEvaluationsRef, {})).toEqual([]);
  });

  it("respects a lowered cost cap", async () => {
    const { t, admin } = await setup();
    for (const role of MODEL_ROLES) {
      await admin.mutation(setRoleCostCapRef, { role, maxInputUsdPerMTok: 0.01, maxOutputUsdPerMTok: 0.01, maxCostRatio: 2 });
    }
    expect(await t.mutation(planEvaluationsRef, {})).toEqual([]);
  });

  it("rejects cost caps that are not positive numbers and non-admin callers", async () => {
    const { admin, writer } = await setup();
    await expect(
      admin.mutation(setRoleCostCapRef, { role: "writing", maxInputUsdPerMTok: -1, maxOutputUsdPerMTok: 1, maxCostRatio: 1 })
    ).rejects.toThrow();
    await expect(writer.mutation(setAutoSwitchRef, { enabled: false })).rejects.toThrow();
    expect(await writer.query(adminStateRef, {})).toBeNull();
  });
});

describe("automatic promotion", () => {
  it("switches the role, logs the event with eval results and cost, and tells admins", async () => {
    const { t, admin } = await setup();
    const evaluationId = await promote(t, "x-ai/grok-4.7");
    expect(await writingModel(t)).toBe("x-ai/grok-4.7");
    const events = await t.run((ctx) => ctx.db.query("modelSwitchEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      role: "writing",
      fromModelId: "claude-sonnet-5",
      toModelId: "x-ai/grok-4.7",
      kind: "promotion",
      actor: "system",
      evaluationId,
      costComparison: { fromInputUsdPerMTok: 2, toInputUsdPerMTok: 1.6, toEvalCostUsd: 0.1 },
    });
    expect(events[0].evalResults?.gates.every((gate) => gate.passed)).toBe(true);
    expect(await row(t, "x-ai/grok-4.7")).toMatchObject({ status: "enabled" });
    expect((await notices(t)).some((m) => m.startsWith("Model catalog: Switched the Writing role"))).toBe(true);
    const state = await admin.query(adminStateRef, {});
    expect(state?.roles.find((role) => role.role === "writing")).toMatchObject({
      modelLabel: "Grok 4.7",
      previousLabel: "Sonnet 5",
      assignedBy: "system",
    });
  });

  it.each([
    ["schema validity", results({ schemaValid: false })],
    ["contract pass rate", results({ contractPassed: false })],
    ["rubric margin", results({ rubricScore: 6.8 })],
    ["cost", results({ costUsd: 1 })],
  ])("holds back a candidate that fails the %s gate", async (_gate, candidateResults) => {
    const { t } = await setup();
    const evaluationId = await runningEvaluation(t, "x-ai/grok-4.7");
    expect(
      await t.mutation(completeEvaluationRef, {
        evaluationId,
        candidateResults,
        incumbentResults: incumbentResults(),
        evalCostUsd: 0.2,
      })
    ).toBe("held");
    expect(await writingModel(t)).toBe("claude-sonnet-5");
    const evaluation = await t.run((ctx) => ctx.db.get(evaluationId));
    expect(evaluation?.status).toBe("failed");
    expect(evaluation?.outcome).toMatch(/^held back: /);
  });

  it("the kill switch stops a switch even after the candidate passed", async () => {
    const { t, admin } = await setup();
    const evaluationId = await runningEvaluation(t, "x-ai/grok-4.7");
    await admin.mutation(setAutoSwitchRef, { enabled: false });
    expect(
      await t.mutation(completeEvaluationRef, {
        evaluationId,
        candidateResults: results(),
        incumbentResults: incumbentResults(),
        evalCostUsd: 0.2,
      })
    ).toBe("held");
    expect(await writingModel(t)).toBe("claude-sonnet-5");
    expect((await t.run((ctx) => ctx.db.get(evaluationId)))?.outcome).toBe("passed; automatic switching is off");
  });
});

describe("rollback", () => {
  it("returns a role to its previous model in one call and logs it", async () => {
    const { t, admin } = await setup();
    await expect(admin.mutation(rollbackRoleRef, { role: "writing" })).rejects.toThrow();
    await promote(t, "x-ai/grok-4.7");
    await admin.mutation(rollbackRoleRef, { role: "writing" });
    expect(await writingModel(t)).toBe("claude-sonnet-5");
    const events = await t.run((ctx) => ctx.db.query("modelSwitchEvents").collect());
    expect(events.map((e) => [e.kind, e.actor])).toEqual([["promotion", "system"], ["rollback", "user"]]);
  });

  it("a manual choice is a logged switch and chat only takes direct Anthropic models", async () => {
    const { t, admin } = await setup();
    await admin.mutation(setRoleModelRef, { role: "chat", modelId: "claude-opus-4-8" });
    await expect(admin.mutation(setRoleModelRef, { role: "chat", modelId: "openai/gpt-5.6-sol" })).rejects.toThrow();
    const events = await t.run((ctx) => ctx.db.query("modelSwitchEvents").collect());
    expect(events).toMatchObject([{ role: "chat", kind: "manual", actor: "user", toModelId: "claude-opus-4-8" }]);
    // The legacy default-model mutation is now the writing role, logged too.
    await admin.mutation(api.appSettings.setDefaultModel, { modelId: "claude-opus-4-8" });
    expect(await writingModel(t)).toBe("claude-opus-4-8");
  });
});

describe("production error rollback", () => {
  /** Record outcomes through the real per-request outcome mutation. */
  async function failingCalls(t: TestConvex, model: string, successes: number, failures: number) {
    const callSite = "generation:section:242";
    for (let i = 0; i < successes; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model, callSite, outcome: "success" });
    }
    for (let i = 0; i < failures; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model, callSite, outcome: "failure", code: "malformed_output" });
    }
  }

  it("counts exactly above any read cap: 10,000 successes and 300 failures is 2.9 percent, no rollback", async () => {
    const { t } = await setup();
    await promote(t, "x-ai/grok-4.7");
    // Hourly buckets hold both counts, so neither side is ever truncated
    // on its own (finding 5).
    await t.run(async (ctx) => {
      await ctx.db.insert("modelCallBuckets", {
        model: "x-ai/grok-4.7",
        hourStart: Math.floor(NOW / 3_600_000) * 3_600_000,
        successes: 10_000,
        failures: 300,
      });
    });
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    expect(await writingModel(t)).toBe("x-ai/grok-4.7");
  });

  it("adds each request outcome to its model's hourly bucket", async () => {
    const { t } = await setup();
    await failingCalls(t, "x-ai/grok-4.7", 3, 2);
    const buckets = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
    expect(buckets).toMatchObject([
      { model: "x-ai/grok-4.7", successes: 3, failures: 2, lastFailureCode: "malformed_output" },
    ]);
  });

  it("rolls back a switched model that fails over the threshold, once, and blocks it for the role", async () => {
    const { t } = await setup();
    await promote(t, "x-ai/grok-4.7");
    await failingCalls(t, "x-ai/grok-4.7", 15, 6);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
      { role: "writing", modelId: "x-ai/grok-4.7", rolledBack: true },
    ]);
    expect(await writingModel(t)).toBe("claude-sonnet-5");
    const rollback = (await t.run((ctx) => ctx.db.query("modelSwitchEvents").collect())).at(-1);
    expect(rollback).toMatchObject({ kind: "rollback", reason: "production_error_rate", actor: "system" });
    expect(rollback?.errorRate?.failures).toBe(6);
    // The check never flips back after a rollback.
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    const planned = await t.mutation(planEvaluationsRef, {});
    const models = await t.run((ctx) => Promise.all(planned.map((id) => ctx.db.get(id))));
    expect(models.some((e) => e?.role === "writing" && e.modelId === "x-ai/grok-4.7")).toBe(false);
  });

  it("stays below the threshold and, with the kill switch off, only notifies", async () => {
    const { t, admin } = await setup();
    await promote(t, "x-ai/grok-4.7");
    await failingCalls(t, "x-ai/grok-4.7", 17, 3);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    await failingCalls(t, "x-ai/grok-4.7", 0, 5);
    await admin.mutation(setAutoSwitchRef, { enabled: false });
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
      { role: "writing", modelId: "x-ai/grok-4.7", rolledBack: false },
    ]);
    await t.mutation(checkProductionErrorsRef, {});
    expect(await writingModel(t)).toBe("x-ai/grok-4.7");
    expect((await notices(t)).filter((m) => m.includes("was not rolled back"))).toHaveLength(1);
  });
});

describe("models frozen per generation", () => {
  it("freezes the writing model and every helper role at reservation", async () => {
    const { t, writer, projectId } = await setup();
    const first = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const frozen = (await t.run((ctx) => ctx.db.get(first)))?.modelFreeze;
    expect(frozen?.roles).toEqual({
      writing: "claude-sonnet-5",
      condense: "claude-sonnet-5",
      retrieval_brief: "claude-haiku-4-5-20251001",
      analysis: "claude-sonnet-5",
    });
    expect((await t.run((ctx) => ctx.db.get(first)))?.singleModelId).toBe("claude-sonnet-5");

    await promote(t, "x-ai/grok-4.7");
    // The running generation keeps what it froze; its retry does too.
    expect((await t.run((ctx) => ctx.db.get(first)))?.modelFreeze).toEqual(frozen);
    await t.run(async (ctx) => {
      await ctx.db.patch(first, { status: "failed" });
      await ctx.db.patch(projectId, { activeGenerationId: undefined, status: "draft" });
    });
    const retry = await writer.mutation(api.generations.retryGeneration, { generationId: first });
    const retried = await t.run((ctx) => ctx.db.get(retry));
    expect(retried?.singleModelId).toBe("claude-sonnet-5");
    expect(retried?.modelFreeze).toEqual(frozen);

    // A new reservation picks up the switched role, with its price ceiling.
    await t.run(async (ctx) => {
      await ctx.db.patch(retry, { status: "failed" });
      await ctx.db.patch(projectId, { activeGenerationId: undefined, status: "draft" });
    });
    const next = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const nextRow = await t.run((ctx) => ctx.db.get(next));
    expect(nextRow?.singleModelId).toBe("x-ai/grok-4.7");
    expect(nextRow?.modelFreeze?.entries.find((entry) => entry.id === "x-ai/grok-4.7")).toMatchObject({
      gateway: "openrouter",
      maxPrice: { prompt: 5, completion: 30 },
    });
  });

  it("accepts only models a writer may pick", async () => {
    const { writer, projectId } = await setup();
    await expect(
      writer.mutation(api.generations.requestGeneration, {
        projectId,
        candidateMode: "compare",
        compareModelIds: ["x-ai/grok-4.7", "claude-sonnet-5"],
      })
    ).rejects.toThrow(/Pick exactly two models/);
    await expect(
      writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single", singleModelId: "x-ai/grok-4.7" })
    ).rejects.toThrow(/supported generation model/);
  });

  it("hashes only the generation's own models into its prompt version", async () => {
    const { t, writer, projectId } = await setup();
    const generationId: Id<"generations"> = await writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "single",
    });
    const version = () => t.action(async (ctx) => await generationPromptVersion(ctx, generationId));
    const before = await version();
    expect(before).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Unrelated catalog changes: a price and score update, a new model, a
    // role switch after reservation.
    const grok = await row(t, "x-ai/grok-4.7");
    await t.run(async (ctx) => {
      await ctx.db.patch(grok!._id, { inputUsdPerMTok: 0.5, benchmarks: [] });
    });
    await t.mutation(applyCatalogRefreshRef, {
      models: [...parsed, { ...parsed[0], openRouterId: "acme/new-model", canonicalSlug: "acme/new-model-20260924" }],
      fetchedAt: NOW,
      complete: false,
    });
    await promote(t, "x-ai/grok-4.7");
    expect(await version()).toBe(before);
    // A generation frozen on another model has another version.
    await t.run(async (ctx) => {
      await ctx.db.patch(generationId, { status: "failed" });
      await ctx.db.patch(projectId, { activeGenerationId: undefined, status: "draft" });
    });
    const other = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const otherVersion = await t.action(async (ctx) => await generationPromptVersion(ctx, other));
    expect(otherVersion).not.toBe(before);
  });
});

describe("review fixes", () => {
  it("finding 2: never promotes when the incumbent's judge grades are missing on one side", async () => {
    const { t } = await setup();
    const evaluationId = await runningEvaluation(t, "x-ai/grok-4.7");
    const ungraded = incumbentResults().map(({ rubricScore: _drop, ...rest }) => rest);
    expect(
      await t.mutation(completeEvaluationRef, {
        evaluationId,
        candidateResults: results(),
        incumbentResults: ungraded,
        evalCostUsd: 0.2,
      })
    ).toBe("held");
    const evaluation = await t.run((ctx) => ctx.db.get(evaluationId));
    expect(evaluation?.status).toBe("incomplete");
    expect(evaluation?.outcome).toBe(
      "incomplete: no judge grade for incumbent seed_batch, incumbent section_draft"
    );
    expect(await writingModel(t)).toBe("claude-sonnet-5");
  });

  it("finding 2: a partial judge failure on either side is incomplete too", async () => {
    const { t } = await setup();
    for (const side of ["candidate", "incumbent"] as const) {
      const evaluationId = await runningEvaluation(t, "x-ai/grok-4.7");
      const partial = (side === "candidate" ? results() : incumbentResults()).map((result) =>
        result.task === "section_draft" ? { ...result, rubricScore: undefined } : result
      );
      await t.mutation(completeEvaluationRef, {
        evaluationId,
        candidateResults: side === "candidate" ? partial : results(),
        incumbentResults: side === "incumbent" ? partial : incumbentResults(),
        evalCostUsd: 0.2,
      });
      expect((await t.run((ctx) => ctx.db.get(evaluationId)))?.outcome).toBe(
        `incomplete: no judge grade for ${side} section_draft`
      );
    }
    expect(await writingModel(t)).toBe("claude-sonnet-5");
  });

  it("finding 2: a candidate failing a gate of its own is held back, not incomplete", async () => {
    const { t } = await setup();
    const evaluationId = await runningEvaluation(t, "x-ai/grok-4.7");
    await t.mutation(completeEvaluationRef, {
      evaluationId,
      candidateResults: results({ schemaValid: false, rubricScore: undefined }),
      incumbentResults: incumbentResults(),
      evalCostUsd: 0.2,
    });
    expect((await t.run((ctx) => ctx.db.get(evaluationId)))?.status).toBe("failed");
  });

  it("finding 4: each evaluation is scheduled in the same transaction as its row", async () => {
    const { t } = await setup();
    const ids = await t.mutation(planEvaluationsRef, {});
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const row = await t.run((ctx) => ctx.db.get(id));
      expect(row?.scheduledJobId).toBeDefined();
      const job = await t.run((ctx) => ctx.db.system.get(row!.scheduledJobId!));
      expect(job?.name).toBe("ai/modelEvaluation:runEvaluation");
      expect(job?.args[0]).toEqual({ evaluationId: id });
    }
  });

  it("finding 4: a stranded queued evaluation is released and its role planned again", async () => {
    const { t } = await setup();
    const stranded = await t.run((ctx) =>
      ctx.db.insert("modelEvaluations", {
        role: "writing",
        modelId: "x-ai/grok-4.7",
        incumbentModelId: "claude-sonnet-5",
        evalSetVersion: "banhall-eval/v1",
        status: "queued",
        estimatedCostUsd: 0.5,
        createdAt: NOW - 1,
      })
    );
    const ids = await t.mutation(planEvaluationsRef, {});
    expect(await t.run((ctx) => ctx.db.get(stranded))).toMatchObject({
      status: "error",
      error: "The evaluation never started",
      evalCostUsd: 0,
    });
    const planned = await t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
    expect(planned.some((row) => row?.role === "writing")).toBe(true);
  });

  it("finding 7: claim reserves the full envelope and completion releases it to the actual spend", async () => {
    const { t } = await setup();
    const evaluationId = await runningEvaluation(t, "x-ai/grok-4.7");
    const running = await t.run((ctx) => ctx.db.get(evaluationId));
    const [grok, sonnet] = await Promise.all([row(t, "x-ai/grok-4.7"), row(t, "claude-sonnet-5")]);
    const priced = (r: NonNullable<typeof grok>) => ({
      gateway: r.gateway,
      reasoning: r.reasoning,
      maxCompletionTokens: r.maxCompletionTokens,
      inputUsdPerMTok: r.inputUsdPerMTok,
      outputUsdPerMTok: r.outputUsdPerMTok,
    });
    const expected = maxEvaluationCostUsd({
      tasks: ROLE_POLICIES.writing.evalTasks,
      envelope: EVAL_ENVELOPE,
      candidate: priced(grok!),
      incumbent: priced(sonnet!),
      judge: priced(sonnet!),
    });
    expect(running?.reservedCostUsd).toBeCloseTo(expected, 10);
    expect(expected).toBeGreaterThan(running!.estimatedCostUsd);
    await t.mutation(completeEvaluationRef, {
      evaluationId,
      candidateResults: results(),
      incumbentResults: incumbentResults(),
      evalCostUsd: 0.2,
    });
    const done = await t.run((ctx) => ctx.db.get(evaluationId));
    expect(done?.reservedCostUsd).toBeUndefined();
    expect(done?.evalCostUsd).toBe(0.2);
  });

  it("finding 7: a budget lowered to zero, or below the envelope, stops a queued evaluation at claim", async () => {
    const { t, admin } = await setup();
    for (const monthlyUsd of [0, 0.6]) {
      await admin.mutation(setEvalBudgetRef, { monthlyUsd });
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
      expect(await t.mutation(claimEvaluationRef, { evaluationId, envelope: EVAL_ENVELOPE })).toBeNull();
      const stopped = await t.run((ctx) => ctx.db.get(evaluationId));
      expect(stopped?.status).toBe("error");
      expect(stopped?.error).toMatch(/^Over the monthly evaluation budget/);
    }
  });

  it("finding 9: every automatic role runs its own task; chat stays manual and says why", async () => {
    const { t, admin } = await setup();
    expect(ROLE_POLICIES.writing.evalTasks).toEqual(["seed_batch", "section_draft", "qa_structured"]);
    expect(ROLE_POLICIES.condense.evalTasks).toEqual(["condense_digest"]);
    expect(ROLE_POLICIES.retrieval_brief.evalTasks).toEqual(["retrieval_queries"]);
    expect(ROLE_POLICIES.analysis.evalTasks).toEqual(["style_classification"]);
    expect(ROLE_POLICIES.structured_helper.evalTasks).toEqual(["changelog_summary"]);
    const state = await admin.query(adminStateRef, {});
    const chat = state?.roles.find((role) => role.role === "chat");
    expect(chat).toMatchObject({ autoSwitch: false });
    expect(chat?.manualOnlyReason).toMatch(/no evaluation covers a streamed chat turn/);
    // A chat evaluation that somehow queued never runs.
    const evaluationId = await t.run((ctx) =>
      ctx.db.insert("modelEvaluations", {
        role: "chat",
        modelId: "claude-opus-4-8",
        incumbentModelId: "claude-sonnet-5",
        evalSetVersion: "banhall-eval/v1",
        status: "queued",
        estimatedCostUsd: 0.1,
        createdAt: NOW,
      })
    );
    expect(await t.mutation(claimEvaluationRef, { evaluationId, envelope: EVAL_ENVELOPE })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(evaluationId)))?.error).toBe(
      "This role has no evaluation task of its own"
    );
  });

  it("finding 10: a drifted canonical slug is adopted by id through refresh application", async () => {
    const { t } = await setup();
    const sol = await row(t, "openai/gpt-5.6-sol");
    await t.run((ctx) => ctx.db.patch(sol!._id, { canonicalSlug: "openai/gpt-5.6-sol-old" }));
    await t.mutation(applyCatalogRefreshRef, { models: parsed, fetchedAt: NOW, complete: true });
    const adopted = await row(t, "openai/gpt-5.6-sol");
    expect(adopted?.missingSince).toBeUndefined();
    expect(adopted).toMatchObject({ status: "enabled", canonicalSlug: "openai/gpt-5.6-sol-20260709" });
    expect((await notices(t)).some((m) => m.includes("no longer listed"))).toBe(false);
    // A row already wrongly marked missing is cleared by the adoption.
    await t.run((ctx) =>
      ctx.db.patch(sol!._id, { canonicalSlug: "openai/gpt-5.6-sol-older", missingSince: NOW - 1, goneNoticeAt: NOW - 1 })
    );
    await t.mutation(applyCatalogRefreshRef, { models: parsed, fetchedAt: NOW, complete: true });
    expect((await row(t, "openai/gpt-5.6-sol"))?.missingSince).toBeUndefined();
  });
});

describe("second review", () => {
  it("A: every call site resolves its own role; automatic roles are covered by a task each", async () => {
    const roleOf = (source: string) =>
      [...source.matchAll(/clientForRole\(ctx, "([a-z_]+)"/g)].map((match) => match[1]);
    expect(roleOf(reviewAgentSource)).toEqual(["pd_review"]);
    expect(roleOf(financialAgentSource)).toEqual(["financial_extraction"]);
    expect(roleOf(ingestSource)).toEqual(["brain_context"]);
    expect(roleOf(learningSource)).toEqual(["learning_digest"]);
    expect(roleOf(scienceCodeSource)).toEqual(["science_code"]);
    expect(roleOf(modelFeedbackSource)).toEqual(["feedback_summary"]);
    expect(roleOf(changelogSource)).toEqual(["structured_helper"]);
    expect(roleOf(styleAnalysisSource)).toEqual(["analysis"]);
    const automatic = MODEL_ROLES.filter(roleAutoSwitches);
    expect(automatic).toEqual([
      "writing",
      "condense",
      "retrieval_brief",
      "analysis",
      "structured_helper",
      "pd_review",
      "financial_extraction",
      "brain_context",
    ]);
    expect(ROLE_POLICIES.pd_review.evalTasks).toEqual(["pd_review_report"]);
    expect(ROLE_POLICIES.financial_extraction.evalTasks).toEqual(["timesheet_extraction"]);
    expect(ROLE_POLICIES.brain_context.evalTasks).toEqual(["chunk_context"]);
    for (const role of automatic) {
      for (const task of ROLE_POLICIES[role].evalTasks) expect(EVAL_ENVELOPE[task], `${role} ${task}`).toBeDefined();
    }
    // Uses without a fixture stay manual, say why, and keep today's models.
    const { t, admin } = await setup();
    const state = await admin.query(adminStateRef, {});
    for (const [role, model] of [
      ["chat", "claude-sonnet-5"],
      ["learning_digest", "claude-sonnet-5"],
      ["science_code", "claude-sonnet-5"],
      ["feedback_summary", "claude-haiku-4-5-20251001"],
      ["pd_review", "claude-sonnet-5"],
      ["financial_extraction", "claude-sonnet-5"],
      ["brain_context", "claude-haiku-4-5-20251001"],
    ] as const) {
      const entry = state?.roles.find((item) => item.role === role);
      expect(entry?.modelId, role).toBe(model);
      if (!roleAutoSwitches(role)) {
        expect(entry?.autoSwitch).toBe(false);
        expect(entry?.manualOnlyReason).toBeTruthy();
        expect(entry?.evaluatedOn).toEqual([]);
      } else {
        expect(entry?.evaluatedOn.length).toBeGreaterThan(0);
      }
    }
    // Manual roles are still switchable by an admin.
    await admin.mutation(setRoleModelRef, { role: "learning_digest", modelId: "claude-opus-4-8" });
    const learning = await t.run((ctx) =>
      ctx.db.query("modelRoleAssignments").withIndex("by_role", (q) => q.eq("role", "learning_digest")).unique()
    );
    expect(learning?.modelId).toBe("claude-opus-4-8");
  });

  async function assignWriting(t: TestConvex, modelId: string, assignedAt: number) {
    await t.run((ctx) =>
      ctx.db.insert("modelRoleAssignments", {
        role: "writing",
        modelId,
        previousModelId: "claude-sonnet-5",
        assignedAt,
        assignedBy: "system",
      })
    );
  }
  async function outcomesAt(t: TestConvex, at: number, model: string, successes: number, failures: number) {
    vi.setSystemTime(at);
    for (let i = 0; i < successes; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model, callSite: "generation:analyzer", outcome: "success" });
    }
    for (let i = 0; i < failures; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model, callSite: "generation:analyzer", outcome: "failure", code: "unknown" });
    }
  }

  it("D: outcomes from before a mid-hour assignment never count", async () => {
    const { t } = await setup();
    const hour = Date.parse("2026-09-24T10:00:00Z");
    await outcomesAt(t, hour + 50 * 60_000, "x-ai/grok-4.7", 15, 5);
    await assignWriting(t, "x-ai/grok-4.7", hour + 55 * 60_000);
    vi.setSystemTime(hour + 90 * 60_000);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    // The same failures after the assignment do count.
    await outcomesAt(t, hour + 95 * 60_000, "x-ai/grok-4.7", 15, 5);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
      { role: "writing", modelId: "x-ai/grok-4.7", rolledBack: true },
    ]);
  });

  it("D: outcomes older than the rolling 24 hours never count, even in the window's first hour", async () => {
    const { t } = await setup();
    const now = Date.parse("2026-09-24T12:30:00Z");
    await assignWriting(t, "x-ai/grok-4.7", now - 3 * 24 * 3_600_000);
    // 12:10 yesterday: 20 minutes outside a window that opens at 12:30.
    await outcomesAt(t, now - 24 * 3_600_000 - 20 * 60_000, "x-ai/grok-4.7", 15, 5);
    // A little healthy traffic inside the window, in a full hour and the
    // current one: counted with the stale failures it would reach 20.8
    // percent of 24 calls and roll back.
    await outcomesAt(t, now - 5 * 3_600_000, "x-ai/grok-4.7", 3, 0);
    await outcomesAt(t, now - 10 * 60_000, "x-ai/grok-4.7", 1, 0);
    vi.setSystemTime(now);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    // Inside the window the full-hour bucket and the partial hour both count.
    await outcomesAt(t, now - 5 * 3_600_000, "x-ai/grok-4.7", 12, 5);
    vi.setSystemTime(now);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
      { role: "writing", modelId: "x-ai/grok-4.7", rolledBack: true },
    ]);
  });

  it("F: a queued evaluation from last month claimed this month counts against this month's budget", async () => {
    const { t, admin } = await setup();
    const lastMonth = Date.parse("2026-08-31T23:00:00Z");
    const insertQueued = () =>
      t.run((ctx) =>
        ctx.db.insert("modelEvaluations", {
          role: "writing",
          modelId: "x-ai/grok-4.7",
          incumbentModelId: "claude-sonnet-5",
          evalSetVersion: "banhall-eval/v1",
          status: "queued",
          estimatedCostUsd: 0.01,
          createdAt: lastMonth,
          accountedAt: lastMonth,
        })
      );
    const first = await insertQueued();
    const second = await insertQueued();
    const claimed = await t.mutation(claimEvaluationRef, { evaluationId: first, envelope: EVAL_ENVELOPE });
    expect(claimed).not.toBeNull();
    const reservation = claimed!.reservedCostUsd;
    await admin.mutation(setEvalBudgetRef, { monthlyUsd: reservation * 1.5 });
    expect(await t.mutation(claimEvaluationRef, { evaluationId: second, envelope: EVAL_ENVELOPE })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(second)))?.error).toMatch(/^Over the monthly evaluation budget/);
  });
});

describe("round 3", () => {
  const queued = (t: TestConvex, fields: Partial<Doc<"modelEvaluations">> = {}) =>
    t.run((ctx) =>
      ctx.db.insert("modelEvaluations", {
        role: "writing",
        modelId: "x-ai/grok-4.7",
        incumbentModelId: "claude-sonnet-5",
        evalSetVersion: "banhall-eval/v1",
        status: "queued",
        estimatedCostUsd: 0.01,
        createdAt: NOW,
        ...fields,
      })
    );

  it("1: settled and running rows written before accountedAt still count this month", async () => {
    const { t, admin } = await setup();
    await admin.mutation(setEvalBudgetRef, { monthlyUsd: 20 });
    // A completed evaluation from before the field existed spent the budget.
    const legacyDone = await queued(t, { status: "passed", evalCostUsd: 19.99, completedAt: NOW });
    const blocked = await queued(t);
    expect(await t.mutation(claimEvaluationRef, { evaluationId: blocked, envelope: EVAL_ENVELOPE })).toBeNull();
    // A running evaluation from before the field existed holds its reservation.
    await t.run((ctx) => ctx.db.patch(legacyDone, { status: "error", evalCostUsd: 0 }));
    await queued(t, { status: "running", reservedCostUsd: 19.99, startedAt: NOW });
    const blockedAgain = await queued(t);
    expect(await t.mutation(claimEvaluationRef, { evaluationId: blockedAgain, envelope: EVAL_ENVELOPE })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(blockedAgain)))?.error).toMatch(/^Over the monthly evaluation budget/);
  });

  it("4: a reservation claimed before midnight still blocks the new month until it settles", async () => {
    const { t, admin } = await setup();
    const beforeMidnight = Date.parse("2026-08-31T23:59:00Z");
    await queued(t, {
      status: "running",
      reservedCostUsd: 19.99,
      createdAt: beforeMidnight,
      startedAt: beforeMidnight,
      accountedAt: beforeMidnight,
    });
    await admin.mutation(setEvalBudgetRef, { monthlyUsd: 20 });
    const next = await queued(t);
    expect(await t.mutation(claimEvaluationRef, { evaluationId: next, envelope: EVAL_ENVELOPE })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(next)))?.error).toMatch(/^Over the monthly evaluation budget/);
  });

  it("2: split roles start from a customised predecessor and then move independently", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", { authId: ADMIN, role: "admin" });
      // Before the split an admin customised both old roles.
      await ctx.db.insert("modelRoleAssignments", {
        role: "analysis",
        modelId: "claude-opus-4-8",
        previousModelId: "claude-sonnet-5",
        assignedAt: NOW - 1000,
        assignedBy: "user",
        assignedByUserId: adminId,
      });
      await ctx.db.insert("modelRoleAssignments", {
        role: "structured_helper",
        modelId: "openai/gpt-5.6-luna",
        previousModelId: "claude-haiku-4-5-20251001",
        assignedAt: NOW - 1000,
        assignedBy: "user",
        assignedByUserId: adminId,
      });
    });
    const admin = t.withIdentity({ subject: ADMIN });
    const modelOf = async (role: string) =>
      (await admin.query(adminStateRef, {}))?.roles.find((item) => item.role === role)?.modelId;
    // Right after the deploy, before anything ran: the split roles already
    // run what the old roles were customised to.
    for (const role of ["pd_review", "financial_extraction", "learning_digest", "science_code"]) {
      expect(await modelOf(role), role).toBe("claude-opus-4-8");
    }
    for (const role of ["brain_context", "feedback_summary"]) {
      expect(await modelOf(role), role).toBe("openai/gpt-5.6-luna");
    }
    // The daily refresh materializes them.
    await t.mutation(applyCatalogRefreshRef, { models: parsed, fetchedAt: NOW, complete: false });
    const learning = await t.run((ctx) =>
      ctx.db.query("modelRoleAssignments").withIndex("by_role", (q) => q.eq("role", "learning_digest")).unique()
    );
    expect(learning).toMatchObject({ modelId: "claude-opus-4-8", origin: "role_split" });
    expect((await admin.query(adminStateRef, {}))?.roles.find((item) => item.role === "learning_digest")?.carriedOverFrom).toBe(
      "Style analysis"
    );
    // The old roles moving no longer drags the split roles along...
    await admin.mutation(setRoleModelRef, { role: "analysis", modelId: "claude-sonnet-5" });
    await admin.mutation(setRoleModelRef, { role: "structured_helper", modelId: "claude-haiku-4-5-20251001" });
    expect(await modelOf("learning_digest")).toBe("claude-opus-4-8");
    expect(await modelOf("feedback_summary")).toBe("openai/gpt-5.6-luna");
    // ...and a later independent choice stays put.
    await admin.mutation(setRoleModelRef, { role: "pd_review", modelId: "claude-sonnet-5" });
    await admin.mutation(setRoleModelRef, { role: "analysis", modelId: "claude-opus-4-8" });
    expect(await modelOf("pd_review")).toBe("claude-sonnet-5");
  });

  it("2: a switch before any refresh materializes the split first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: ADMIN, role: "admin" });
      await ctx.db.insert("modelRoleAssignments", {
        role: "analysis",
        modelId: "claude-opus-4-8",
        assignedAt: NOW - 1000,
        assignedBy: "system",
      });
    });
    const admin = t.withIdentity({ subject: ADMIN });
    await admin.mutation(setRoleModelRef, { role: "analysis", modelId: "claude-sonnet-5" });
    expect((await admin.query(adminStateRef, {}))?.roles.find((item) => item.role === "financial_extraction")?.modelId).toBe(
      "claude-opus-4-8"
    );
  });

  it("3: retention deletes every expired outcome row in continuing batches and keeps recent ones", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { t } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 1_200; i += 1) {
        await ctx.db.insert("modelCallOutcomes", { model: "x-ai/grok-4.7", at: NOW - 3 * 86_400_000 + i, outcome: "success" });
      }
      for (let i = 0; i < 10; i += 1) {
        await ctx.db.insert("modelCallOutcomes", { model: "x-ai/grok-4.7", at: NOW - 60_000 + i, outcome: "success" });
      }
    });
    await t.mutation(checkProductionErrorsRef, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run((ctx) => ctx.db.query("modelCallOutcomes").collect());
    expect(left).toHaveLength(10);
    expect(left.every((row) => row.at >= NOW - 60_000)).toBe(true);
  });
});

/**
 * `role` becomes the only role with room under its cost cap, and `modelId`
 * its best candidate on paper, so a plan queues `modelId` for `role` unless
 * something excludes it.
 */
async function onlyRoleCanPlan(t: TestConvex, role: ModelRole, modelId: string) {
  const admin = t.withIdentity({ subject: ADMIN });
  for (const other of MODEL_ROLES) {
    if (other === role) continue;
    await admin.mutation(setRoleCostCapRef, { role: other, maxInputUsdPerMTok: 0.01, maxOutputUsdPerMTok: 0.01, maxCostRatio: 2 });
  }
  await t.run(async (ctx) => {
    const row = await ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).first();
    await ctx.db.patch(row!._id, {
      benchmarks: [{ source: "openrouter_aa", metric: "intelligence_index", value: 99, fetchedAt: NOW }],
    });
  });
}

async function plan(t: TestConvex) {
  const ids = await t.mutation(planEvaluationsRef, {});
  const rows = await t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
  return rows.map((row) => ({ id: row!._id, role: row!.role, modelId: row!.modelId }));
}

/**
 * Drops evaluations that were planned but never started: a queued one
 * marks its role busy, and a settled one would put its model on the
 * evaluation cooldown, which must not stand in for the rollback check.
 */
async function dropQueued(t: TestConvex) {
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("modelEvaluations").withIndex("by_status", (q) => q.eq("status", "queued")).collect()) {
      await ctx.db.delete(row._id);
    }
  });
}

/** Deletes `role`'s rollbacks from `modelId`: the negative control for an exclusion. */
async function forgetRollbacks(t: TestConvex, role: ModelRole, modelId: string) {
  await t.run(async (ctx) => {
    for (const event of await ctx.db
      .query("modelSwitchEvents")
      .withIndex("by_role_and_kind_and_fromModelId_and_at", (q) =>
        q.eq("role", role).eq("kind", "rollback").eq("fromModelId", modelId)
      )
      .collect()) {
      await ctx.db.delete(event._id);
    }
  });
}

describe("round 4", () => {
  const A = "claude-sonnet-5";
  const B = "claude-opus-4-8";
  const SWITCHED_AT = NOW - 2 * 3_600_000;
  const NOTICED_AT = SWITCHED_AT + 60_000;
  const ANALYSIS_CHILDREN = ["pd_review", "financial_extraction", "learning_digest", "science_code"] as const;

  const assignmentOf = (t: TestConvex, role: Doc<"modelRoleAssignments">["role"]) =>
    t.run((ctx) =>
      ctx.db.query("modelRoleAssignments").withIndex("by_role", (q) => q.eq("role", role)).unique()
    );
  const eventsOf = (t: TestConvex, role: Doc<"modelSwitchEvents">["role"]) =>
    t.run((ctx) =>
      ctx.db.query("modelSwitchEvents").withIndex("by_role_and_at", (q) => q.eq("role", role)).collect()
    );

  /** A deployment from before the split: only the old roles have assignments. */
  async function beforeSplit(analysis: { modelId: string; previousModelId: string; rolledBack: boolean }) {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: ADMIN, role: "admin" });
      const promotedAt = analysis.rolledBack ? SWITCHED_AT - 3_600_000 : SWITCHED_AT;
      await ctx.db.insert("modelSwitchEvents", {
        role: "analysis",
        fromModelId: A,
        toModelId: B,
        kind: "promotion",
        reason: "evaluation_passed",
        actor: "system",
        at: promotedAt,
      });
      if (analysis.rolledBack) {
        await ctx.db.insert("modelSwitchEvents", {
          role: "analysis",
          fromModelId: B,
          toModelId: A,
          kind: "rollback",
          reason: "production_error_rate",
          actor: "system",
          at: SWITCHED_AT,
        });
      }
      await ctx.db.insert("modelRoleAssignments", {
        role: "analysis",
        modelId: analysis.modelId,
        previousModelId: analysis.previousModelId,
        assignedAt: SWITCHED_AT,
        assignedBy: "system",
        errorNoticeAt: NOTICED_AT,
      });
    });
    return t;
  }

  /** 6 of 21 calls fail (28.6 percent), an hour after the switch. */
  async function failing(t: TestConvex, model: string) {
    vi.setSystemTime(NOW - 3_600_000);
    for (let i = 0; i < 15; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model, callSite: "pd-review", outcome: "success" });
    }
    for (let i = 0; i < 6; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model, callSite: "pd-review", outcome: "failure", code: "malformed_output" });
    }
    vi.setSystemTime(NOW);
  }

  it("4: split roles carried over from a failing switched predecessor roll back with it on the first refresh", async () => {
    // Before the deploy: analysis was promoted from A to B, and an admin
    // had already given science code suggestions a model of their own.
    const t = await beforeSplit({ modelId: B, previousModelId: A, rolledBack: false });
    const independentId = await t.run(async (ctx) => {
      const adminId = (await ctx.db.query("users").first())!._id;
      return await ctx.db.insert("modelRoleAssignments", {
        role: "science_code",
        modelId: "claude-haiku-4-5-20251001",
        previousModelId: A,
        assignedAt: SWITCHED_AT - 60_000,
        assignedBy: "user",
        assignedByUserId: adminId,
      });
    });
    const independent = await t.run((ctx) => ctx.db.get(independentId));
    await failing(t, B);

    // The daily job: the refresh materializes the split, then the
    // production error check runs.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/v1/models")
        ? Response.json(fixture)
        : Response.json({ data: { endpoints: [] } })
    ));
    await t.action(refreshCatalogRef, {});

    expect(await assignmentOf(t, "analysis")).toMatchObject({ modelId: A, previousModelId: B });
    for (const role of ["pd_review", "financial_extraction", "learning_digest"] as const) {
      expect(await assignmentOf(t, role), role).toMatchObject({ modelId: A, previousModelId: B });
      expect((await assignmentOf(t, role))?.origin, role).toBeUndefined();
      expect(await eventsOf(t, role), role).toMatchObject([
        { kind: "rollback", reason: "production_error_rate", fromModelId: B, toModelId: A, actor: "system" },
      ]);
    }
    // Both automatic split roles are among them.
    expect(roleAutoSwitches("pd_review") && roleAutoSwitches("financial_extraction")).toBe(true);
    // The role an admin had already assigned is untouched.
    expect(await t.run((ctx) => ctx.db.get(independentId))).toEqual(independent);
    expect(await eventsOf(t, "science_code")).toEqual([]);
    // Nothing flips back afterwards.
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
  });

  it("4: materializing keeps the predecessor's rollback target, switch time and last notice", async () => {
    const t = await beforeSplit({ modelId: B, previousModelId: A, rolledBack: false });
    await t.mutation(applyCatalogRefreshRef, { models: parsed, fetchedAt: NOW, complete: false });
    for (const role of ANALYSIS_CHILDREN) {
      expect(await assignmentOf(t, role), role).toMatchObject({
        modelId: B,
        previousModelId: A,
        assignedAt: SWITCHED_AT,
        errorNoticeAt: NOTICED_AT,
        assignedBy: "system",
        origin: "role_split",
        inheritedHistory: { role: "analysis", until: SWITCHED_AT },
      });
    }
    const admin = t.withIdentity({ subject: ADMIN });
    const pdReview = (await admin.query(adminStateRef, {}))?.roles.find((item) => item.role === "pd_review");
    expect(pdReview).toMatchObject({ carriedOverFrom: "Style analysis", previousModelId: A });
  });

  it("4: a predecessor rolled back by hand before any refresh leaves its split roles watched", async () => {
    const t = await beforeSplit({ modelId: B, previousModelId: A, rolledBack: false });
    await failing(t, B);
    const admin = t.withIdentity({ subject: ADMIN });
    await admin.mutation(rollbackRoleRef, { role: "analysis" });
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual(
      ANALYSIS_CHILDREN.map((role) => ({ role, modelId: B, rolledBack: true }))
    );
    for (const role of ANALYSIS_CHILDREN) {
      expect((await assignmentOf(t, role))?.modelId, role).toBe(A);
    }
  });

  it("4: a split role never flips back after a rollback its predecessor made before the split, even after its own promotion", async () => {
    // Before the deploy: analysis was rolled back from B to A.
    const t = await beforeSplit({ modelId: A, previousModelId: B, rolledBack: true });
    await t.mutation(applyCatalogRefreshRef, { models: parsed, fetchedAt: NOW, complete: false });
    for (const role of ANALYSIS_CHILDREN) {
      expect(await assignmentOf(t, role), role).toMatchObject({
        modelId: A,
        previousModelId: B,
        assignedAt: SWITCHED_AT,
        origin: "role_split",
      });
    }
    // A now fails too: no role goes back to the model it was rolled back from.
    await failing(t, A);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    for (const role of ANALYSIS_CHILDREN) {
      expect((await assignmentOf(t, role))?.modelId, role).toBe(A);
    }
    // Nor is B evaluated again for them, though it is PD review's best
    // candidate on paper and the only role left with room under its cap.
    const admin = t.withIdentity({ subject: ADMIN });
    for (const role of MODEL_ROLES) {
      if (role === "pd_review") continue;
      await admin.mutation(setRoleCostCapRef, { role, maxInputUsdPerMTok: 0.01, maxOutputUsdPerMTok: 0.01, maxCostRatio: 2 });
    }
    await t.run(async (ctx) => {
      const opus = await ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", B)).first();
      await ctx.db.patch(opus!._id, {
        benchmarks: [{ source: "openrouter_aa", metric: "intelligence_index", value: 99, fetchedAt: NOW }],
      });
    });
    const planned = await t.mutation(planEvaluationsRef, {});
    const queued = await t.run((ctx) => Promise.all(planned.map((id) => ctx.db.get(id))));
    expect(queued.map((evaluation) => evaluation?.role)).toEqual(["pd_review"]);
    expect(queued.some((evaluation) => evaluation?.modelId === B)).toBe(false);

    // PD review then switches on its own: the planned candidate C passes
    // and is promoted from A, which clears the carried-over marker.
    const [evaluationId] = planned;
    const claim = await t.mutation(claimEvaluationRef, { evaluationId, envelope: EVAL_ENVELOPE });
    const C = claim!.candidate.id;
    expect([A, B]).not.toContain(C);
    const pdReview = (rubricScore: number): EvalTaskResult[] => [
      { task: "pd_review_report", structured: true, schemaValid: true, contractPassed: true, rubricScore, costUsd: 0.05 },
    ];
    expect(
      await t.mutation(completeEvaluationRef, {
        evaluationId,
        candidateResults: pdReview(8),
        incumbentResults: pdReview(7),
        evalCostUsd: 0.1,
      })
    ).toBe("promoted");
    const promoted = await assignmentOf(t, "pd_review");
    expect(promoted).toMatchObject({ modelId: C, previousModelId: A });
    expect(promoted?.origin).toBeUndefined();
    expect(await eventsOf(t, "pd_review")).toMatchObject([{ kind: "promotion", fromModelId: A, toModelId: C }]);
    // B still beats C on paper, and the next plan still leaves it out.
    const next = await t.mutation(planEvaluationsRef, {});
    const nextQueued = await t.run((ctx) => Promise.all(next.map((id) => ctx.db.get(id))));
    expect(nextQueued.some((evaluation) => evaluation?.modelId === B)).toBe(false);
    // The error check goes by PD review's own last switch now: a failing C
    // is rolled back to A, while the roles still on A stay put.
    vi.setSystemTime(NOW + 30 * 60_000);
    for (let i = 0; i < 21; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model: C, callSite: "pd-review", outcome: i < 6 ? "failure" : "success" });
    }
    vi.setSystemTime(NOW + 3_600_000);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([{ role: "pd_review", modelId: C, rolledBack: true }]);
    expect((await assignmentOf(t, "pd_review"))?.modelId).toBe(A);
  });

  describe("round 6", () => {
    const D = "claude-haiku-4-5-20251001";

    /** PD review promotes the candidate its planned evaluation measured. */
    async function promotePdReview(t: TestConvex, evaluationId: Id<"modelEvaluations">) {
      const claim = await t.mutation(claimEvaluationRef, { evaluationId, envelope: EVAL_ENVELOPE });
      const result = (rubricScore: number): EvalTaskResult[] => [
        { task: "pd_review_report", structured: true, schemaValid: true, contractPassed: true, rubricScore, costUsd: 0.05 },
      ];
      expect(
        await t.mutation(completeEvaluationRef, {
          evaluationId,
          candidateResults: result(8),
          incumbentResults: result(7),
          evalCostUsd: 0.1,
        })
      ).toBe("promoted");
      return claim!.candidate.id;
    }

    it("6: a split role materialized before inheritedHistory existed keeps its predecessor's rollback after the upgrade", async () => {
      // Before the upgrade: analysis rolled B back to A, and the previous
      // version had already materialized PD review from it, without the field.
      const t = await beforeSplit({ modelId: A, previousModelId: B, rolledBack: true });
      const legacy = {
        role: "pd_review" as const,
        modelId: A,
        previousModelId: B,
        assignedAt: SWITCHED_AT,
        assignedBy: "system" as const,
        origin: "role_split" as const,
      };
      const { legacyId, independentId } = await t.run(async (ctx) => {
        const adminId = (await ctx.db.query("users").first())!._id;
        return {
          legacyId: await ctx.db.insert("modelRoleAssignments", legacy),
          independentId: await ctx.db.insert("modelRoleAssignments", {
            role: "science_code",
            modelId: D,
            previousModelId: A,
            assignedAt: SWITCHED_AT - 60_000,
            assignedBy: "user",
            assignedByUserId: adminId,
          }),
        };
      });
      const independent = await t.run((ctx) => ctx.db.get(independentId));

      // A fails before anything has run since the upgrade: PD review is
      // not sent back to the model its predecessor rolled back from.
      await failing(t, A);
      expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
      expect((await assignmentOf(t, "pd_review"))?.modelId).toBe(A);

      // The first refresh writes the field on the legacy row, and only there.
      await t.mutation(applyCatalogRefreshRef, { models: parsed, fetchedAt: NOW, complete: false });
      expect(await t.run((ctx) => ctx.db.get(legacyId))).toMatchObject({
        ...legacy,
        inheritedHistory: { role: "analysis", until: SWITCHED_AT },
      });
      expect(await t.run((ctx) => ctx.db.get(independentId))).toEqual(independent);

      // B stays out of PD review's plans, also once its own promotion has
      // cleared the role_split marker.
      await onlyRoleCanPlan(t, "pd_review", B);
      const [first] = await plan(t);
      expect(first).toMatchObject({ role: "pd_review" });
      expect(first.modelId).not.toBe(B);
      await promotePdReview(t, first.id);
      expect((await assignmentOf(t, "pd_review"))?.origin).toBeUndefined();
      expect((await plan(t)).some((item) => item.modelId === B)).toBe(false);
      // Negative control: without analysis's rollback, the same plan picks B.
      await dropQueued(t);
      await forgetRollbacks(t, "analysis", B);
      expect((await plan(t)).filter((item) => item.modelId === B).map((item) => item.role)).toEqual(["pd_review"]);
    });

    it("6: a predecessor's rollback stays excluded however many switches its split role makes", async () => {
      // Analysis rolled B back to A, then was switched by hand 49 more
      // times: that rollback is its 50th newest event at the split.
      const t = convexTest(schema, modules);
      const start = SWITCHED_AT - 60 * 60_000;
      const lastAt = start + 49 * 60_000;
      await t.run(async (ctx) => {
        await ctx.db.insert("users", { authId: ADMIN, role: "admin" });
        await ctx.db.insert("modelSwitchEvents", {
          role: "analysis",
          fromModelId: B,
          toModelId: A,
          kind: "rollback",
          reason: "production_error_rate",
          actor: "system",
          at: start,
        });
        for (let i = 1; i <= 49; i += 1) {
          await ctx.db.insert("modelSwitchEvents", {
            role: "analysis",
            fromModelId: i % 2 === 1 ? A : D,
            toModelId: i % 2 === 1 ? D : A,
            kind: "manual",
            reason: "admin_choice",
            actor: "user",
            at: start + i * 60_000,
          });
        }
        // The 49th switch, the last, went from A to D.
        await ctx.db.insert("modelRoleAssignments", {
          role: "analysis",
          modelId: D,
          previousModelId: A,
          assignedAt: lastAt,
          assignedBy: "user",
        });
      });
      await t.mutation(applyCatalogRefreshRef, { models: parsed, fetchedAt: NOW, complete: false });
      expect((await assignmentOf(t, "pd_review"))?.inheritedHistory).toEqual({ role: "analysis", until: lastAt });
      const newestFifty = await t.run((ctx) =>
        ctx.db
          .query("modelSwitchEvents")
          .withIndex("by_role_and_at", (q) => q.eq("role", "analysis").lte("at", lastAt))
          .order("desc")
          .take(50)
      );
      expect(newestFifty).toHaveLength(50);
      expect(newestFifty.at(-1)).toMatchObject({ kind: "rollback", fromModelId: B });

      await onlyRoleCanPlan(t, "pd_review", B);
      const [first] = await plan(t);
      expect(first).toMatchObject({ role: "pd_review" });
      expect(first.modelId).not.toBe(B);
      // One switch of its own...
      await promotePdReview(t, first.id);
      expect((await plan(t)).some((item) => item.modelId === B)).toBe(false);
      // ...and many more.
      await dropQueued(t);
      const admin = t.withIdentity({ subject: ADMIN });
      for (let i = 0; i < 60; i += 1) {
        await admin.mutation(setRoleModelRef, { role: "pd_review", modelId: i % 2 === 0 ? A : D });
      }
      expect(await eventsOf(t, "pd_review")).toHaveLength(61);
      const last = await plan(t);
      expect(last.map((item) => item.role)).toEqual(["pd_review"]);
      expect(last.some((item) => item.modelId === B)).toBe(false);
      // Negative control: without analysis's rollback, the same plan picks B.
      await dropQueued(t);
      await forgetRollbacks(t, "analysis", B);
      expect((await plan(t)).filter((item) => item.modelId === B).map((item) => item.role)).toEqual(["pd_review"]);
    });
  });
});

describe("round 7", () => {
  const INCUMBENT = "claude-sonnet-5";
  const CANDIDATE = "claude-opus-4-8";
  const HAIKU = "claude-haiku-4-5-20251001";

  const writingEvents = (t: TestConvex) =>
    t.run((ctx) =>
      ctx.db.query("modelSwitchEvents").withIndex("by_role_and_at", (q) => q.eq("role", "writing")).collect()
    );

  /** The daily plan queues CANDIDATE for writing, which runs INCUMBENT. */
  async function plannedCandidate(t: TestConvex) {
    await onlyRoleCanPlan(t, "writing", CANDIDATE);
    const [queued] = await plan(t);
    expect(queued).toMatchObject({ role: "writing", modelId: CANDIDATE });
    return queued.id;
  }

  /** An admin tries CANDIDATE by hand, and it is rolled back to INCUMBENT. */
  async function triedAndRolledBack(admin: ReturnType<TestConvex["withIdentity"]>, t: TestConvex) {
    await admin.mutation(setRoleModelRef, { role: "writing", modelId: CANDIDATE });
    await admin.mutation(rollbackRoleRef, { role: "writing" });
    expect(await writingModel(t)).toBe(INCUMBENT);
  }

  it("7: an evaluation that finishes after its role was rolled back from the candidate is held, not promoted", async () => {
    const { t, admin } = await setup();
    const evaluationId = await plannedCandidate(t);
    expect(await t.mutation(claimEvaluationRef, { evaluationId, envelope: EVAL_ENVELOPE })).not.toBeNull();
    // While it runs, an admin tries the candidate by hand and rolls it back.
    await triedAndRolledBack(admin, t);
    // The role runs the incumbent again, and the candidate passes every gate.
    const complete = () =>
      t.mutation(completeEvaluationRef, {
        evaluationId,
        candidateResults: results(),
        incumbentResults: incumbentResults(),
        evalCostUsd: 0.2,
      });
    expect(await complete()).toBe("held");
    expect(await t.run((ctx) => ctx.db.get(evaluationId))).toMatchObject({
      status: "passed",
      outcome: "passed; the role was rolled back from this model",
      evalCostUsd: 0.2,
    });
    expect(await writingModel(t)).toBe(INCUMBENT);
    expect((await writingEvents(t)).map((event) => event.kind)).toEqual(["manual", "rollback"]);

    // Negative control: the same finished run promotes once the rollback is gone.
    await forgetRollbacks(t, "writing", CANDIDATE);
    await t.run((ctx) => ctx.db.patch(evaluationId, { status: "running", outcome: undefined }));
    expect(await complete()).toBe("promoted");
    expect(await writingModel(t)).toBe(CANDIDATE);
  });

  it("7: a queued evaluation of a model its role was rolled back from never starts", async () => {
    const { t, admin } = await setup();
    const evaluationId = await plannedCandidate(t);
    await triedAndRolledBack(admin, t);
    expect(await t.mutation(claimEvaluationRef, { evaluationId, envelope: EVAL_ENVELOPE })).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(evaluationId))).toMatchObject({
      status: "error",
      error: "The role was rolled back from this model",
      evalCostUsd: 0,
    });
    // Negative control: without the rollback the same evaluation starts.
    await forgetRollbacks(t, "writing", CANDIDATE);
    await t.run((ctx) =>
      ctx.db.patch(evaluationId, { status: "queued", error: undefined, evalCostUsd: undefined, completedAt: undefined })
    );
    expect(await t.mutation(claimEvaluationRef, { evaluationId, envelope: EVAL_ENVELOPE })).not.toBeNull();
  });

  it("7: a rollback excludes the same model under its other gateway id", async () => {
    const { t, admin } = await setup();
    const listing = "anthropic/claude-opus-4.8";
    expect((await row(t, listing))?.canonicalSlug).toBe((await row(t, CANDIDATE))?.canonicalSlug);
    await triedAndRolledBack(admin, t);
    await onlyRoleCanPlan(t, "writing", listing);
    expect((await plan(t)).some((item) => item.modelId === listing || item.modelId === CANDIDATE)).toBe(false);
    // Negative control: without the rollback, the OpenRouter listing is planned.
    await dropQueued(t);
    await forgetRollbacks(t, "writing", CANDIDATE);
    expect((await plan(t)).map((item) => [item.role, item.modelId])).toEqual([["writing", listing]]);
  });

  it("7: a role's own rollback stays excluded after more than 50 later switches", async () => {
    const { t, admin } = await setup();
    await triedAndRolledBack(admin, t);
    for (let i = 0; i < 55; i += 1) {
      await admin.mutation(setRoleModelRef, { role: "writing", modelId: i % 2 === 0 ? HAIKU : INCUMBENT });
    }
    const newestFifty = await t.run((ctx) =>
      ctx.db.query("modelSwitchEvents").withIndex("by_role_and_at", (q) => q.eq("role", "writing")).order("desc").take(50)
    );
    expect(newestFifty.some((event) => event.kind === "rollback")).toBe(false);
    await onlyRoleCanPlan(t, "writing", CANDIDATE);
    expect((await plan(t)).some((item) => item.modelId === CANDIDATE)).toBe(false);
    // Negative control: without the rollback, the same plan picks the candidate.
    await dropQueued(t);
    await forgetRollbacks(t, "writing", CANDIDATE);
    expect((await plan(t)).map((item) => [item.role, item.modelId])).toEqual([["writing", CANDIDATE]]);
  });
});
