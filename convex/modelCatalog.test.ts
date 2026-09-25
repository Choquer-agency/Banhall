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
  const claim = await t.mutation(claimEvaluationRef, { evaluationId });
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
    for (const role of ["writing", "structured_helper", "condense", "retrieval_brief", "analysis"] as const) {
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
  async function failingCalls(t: TestConvex, model: string, successes: number, failures: number) {
    await t.run(async (ctx) => {
      for (let i = 0; i < successes; i += 1) {
        await ctx.db.insert("aiUsage", {
          callSite: "generation:section:242",
          model,
          inputTokens: 10,
          outputTokens: 10,
          costUsd: 0,
          createdAt: NOW,
        });
      }
      for (let i = 0; i < failures; i += 1) {
        await ctx.db.insert("modelCallFailures", { model, callSite: "generation:section:242", code: "malformed_output", at: NOW });
      }
    });
  }

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
