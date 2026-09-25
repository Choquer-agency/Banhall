/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import fixture from "../shared/__fixtures__/openrouter-models-2026-09-24.json";
import { parseOpenRouterModels, type EvalTaskResult } from "../shared/modelCatalog";
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

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

const NOW = Date.parse("2026-09-24T12:00:00Z");
const parsed = parseOpenRouterModels(fixture, NOW).models;
const ADMIN = "catalog-admin";
const WRITER = "catalog-writer";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
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
