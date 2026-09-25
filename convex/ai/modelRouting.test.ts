/// <reference types="vite/client" />
/**
 * Model catalog routing at the HTTP boundary: what actually goes over the
 * wire to OpenRouter (require_parameters on tool calls, max_price from the
 * frozen or role cap, fallback models for helper roles only), how a model
 * the catalog added after this deployment is resolved from the generation's
 * freeze before its first call, and which failures count against a model.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import fixture from "../../shared/__fixtures__/openrouter-models-2026-09-24.json";
import { parseOpenRouterModels } from "../../shared/modelCatalog";
import {
  gatewayForModel,
  registerModelEntries,
  resetRegisteredModelEntries,
} from "../../shared/generationModels";
import { applyCatalogRefreshRef, checkProductionErrorsRef } from "../lib/modelCatalogRefs";
import {
  clientForModel,
  clientForRole,
  OUTCOME_RECORD_DEADLINE_MS,
  resetGenerationModelCache,
  seedClientForModel,
  withOutcomeRecording,
} from "./providers";
import { z } from "zod";
import { evalClient } from "./modelEvaluation";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import type { GenerationMessageParams } from "./openrouterCore";
import { generateStructured } from "./structured";

const structuredArgs = (model: string) => ({
  model,
  system: "System.",
  user: "Hello.",
  toolName: "record",
  description: "Record it.",
  schema: { type: "object" as const },
  attempts: 1,
});

// Vite keys this directory's own files as "./x.ts"; convex-test resolves
// function names from the convex root, so map them back under "../ai/".
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ])
);
const NOW = Date.parse("2026-09-24T12:00:00Z");

type Captured = { url: string; body: Record<string, unknown> };
let captured: Captured[];
let reply: (url: string) => Response;

const toolReply = (argumentsJson = JSON.stringify({ ok: true }), model?: string) =>
  Response.json({
    ...(model ? { model } : {}),
    choices: [
      {
        message: { content: null, tool_calls: [{ id: "call-1", function: { name: "record", arguments: argumentsJson } }] },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
  });

const toolParams = (model: string): GenerationMessageParams => ({
  model,
  max_tokens: 1000,
  system: "System.",
  messages: [{ role: "user", content: "Hello." }],
  tools: [{ name: "record", description: "Record it.", input_schema: { type: "object" } }],
  tool_choice: { type: "tool", name: "record" },
});

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  resetRegisteredModelEntries();
  resetGenerationModelCache();
  captured = [];
  reply = () => toolReply();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      captured.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
      return reply(request.url);
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetRegisteredModelEntries();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(applyCatalogRefreshRef, {
    models: parseOpenRouterModels(fixture, NOW).models,
    fetchedAt: NOW,
    complete: false,
  });
  return t;
}

describe("OpenRouter request fields", () => {
  it("requires parameters and sends the registered price ceiling on a tool call", async () => {
    const t = await setup();
    await t.action(async (ctx) => {
      registerModelEntries([
        {
          id: "x-ai/grok-4.7",
          label: "Grok 4.7",
          provider: "xAI",
          gateway: "openrouter",
          reasoning: true,
          maxCompletionTokens: 450000,
          requestId: "x-ai/grok-4.7-renamed",
          maxPrice: { prompt: 5, completion: 30 },
        },
      ]);
      await clientForModel(ctx, "x-ai/grok-4.7", { callSite: "routing-test" }).messages.create(
        toolParams("x-ai/grok-4.7")
      );
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(captured[0].body).toMatchObject({
      model: "x-ai/grok-4.7-renamed",
      provider: { require_parameters: true, max_price: { prompt: 5, completion: 30 } },
    });
    // A generation model is never given fallbacks.
    expect(captured[0].body.models).toBeUndefined();
  });

  it("sends no require_parameters on a plain text call", async () => {
    const t = await setup();
    reply = () =>
      Response.json({ choices: [{ message: { content: "Plain." }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    await t.action(async (ctx) => {
      await clientForModel(ctx, "openai/gpt-5.6-sol", { callSite: "routing-test" }).messages.create({
        model: "openai/gpt-5.6-sol",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hi." }],
      });
    });
    expect(captured[0].body.provider).toBeUndefined();
  });

  it("resolves a catalog-only model from the generation's freeze before its first call", async () => {
    const t = await setup();
    const generationId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "routing-writer", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Routing",
        clientName: "Client",
        status: "draft",
        createdBy: userId,
        shareToken: "routing-token",
        createdAt: NOW,
        updatedAt: NOW,
      });
      return await ctx.db.insert("generations", {
        projectId,
        status: "running",
        startedAt: NOW,
        singleModelId: "x-ai/grok-4.7",
        modelFreeze: {
          entries: [
            {
              id: "x-ai/grok-4.7",
              label: "Grok 4.7",
              provider: "xAI",
              gateway: "openrouter",
              reasoning: true,
              maxCompletionTokens: 450000,
              maxPrice: { prompt: 3, completion: 12 },
            },
          ],
          roles: {
            writing: "x-ai/grok-4.7",
            condense: "claude-sonnet-5",
            retrieval_brief: "claude-haiku-4-5-20251001",
            analysis: "claude-sonnet-5",
          },
          frozenAt: NOW,
        },
      });
    });
    // Unknown to the static seed: a synchronous lookup would route it to
    // Anthropic.
    expect(gatewayForModel("x-ai/grok-4.7")).toBe("anthropic");
    await t.action(async (ctx) => {
      await clientForModel(ctx, "x-ai/grok-4.7", {
        callSite: "generation:analyzer",
        attribution: { generationId },
      }).messages.create(toolParams("x-ai/grok-4.7"));
    });
    expect(captured[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(captured[0].body).toMatchObject({
      model: "x-ai/grok-4.7",
      provider: { require_parameters: true, max_price: { prompt: 3, completion: 12 } },
    });
  });

  it("gives a helper role its previous OpenRouter model as a fallback and bills the model that answered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("modelRoleAssignments", {
        role: "structured_helper",
        modelId: "z-ai/glm-5.3-flash",
        previousModelId: "xiaomi/mimo-v2.6-pro",
        assignedAt: NOW,
        assignedBy: "system",
      });
    });
    reply = () => toolReply(JSON.stringify({ ok: true }), "xiaomi/mimo-v2.6-pro");
    await t.action(async (ctx) => {
      const { client, model } = await clientForRole(ctx, "structured_helper", { callSite: "routing-test" });
      expect(model).toBe("z-ai/glm-5.3-flash");
      await client.messages.create(toolParams(model));
    });
    expect(captured[0].body).toMatchObject({
      model: "z-ai/glm-5.3-flash",
      models: ["z-ai/glm-5.3-flash", "xiaomi/mimo-v2.6-pro"],
      provider: { require_parameters: true, max_price: { prompt: 1.5, completion: 8 } },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
    expect(usage.map((row) => row.model)).toEqual(["xiaomi/mimo-v2.6-pro"]);
    vi.useRealTimers();
  });
});

describe("model outcome recording", () => {
  const drain = async (t: Awaited<ReturnType<typeof setup>>) =>
    await t.finishAllScheduledFunctions(vi.runAllTimers);

  it("records malformed output against the model, never an auth failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await setup();
    reply = () => toolReply("{not json");
    await t.action(async (ctx) => {
      await expect(
        clientForModel(ctx, "openai/gpt-5.6-sol", { callSite: "routing-test" }).messages.create(
          toolParams("openai/gpt-5.6-sol")
        )
      ).rejects.toThrow(/malformed JSON/);
    });
    reply = () => Response.json({ error: { message: "bad key" } }, { status: 401 });
    await t.action(async (ctx) => {
      await expect(
        clientForModel(ctx, "openai/gpt-5.6-sol", { callSite: "routing-test" }).messages.create(
          toolParams("openai/gpt-5.6-sol")
        )
      ).rejects.toThrow();
    });
    await drain(t);
    const buckets = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
    expect(buckets).toMatchObject([
      { model: "openai/gpt-5.6-sol", successes: 0, failures: 1, lastFailureCode: "malformed_output", lastFailureCallSite: "routing-test" },
    ]);
    vi.useRealTimers();
  });

  it("finding 6: a billed malformed response is one failure, never also a success, so 5 of 20 rolls back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("modelRoleAssignments", {
        role: "writing",
        modelId: "openai/gpt-5.6-sol",
        previousModelId: "claude-sonnet-5",
        assignedAt: NOW - 60 * 60 * 1000,
        assignedBy: "system",
      });
    });
    let call = 0;
    // Every response is billed (usage.cost present); every fourth carries
    // tool JSON the gateway adapter cannot parse.
    reply = () => {
      call += 1;
      return toolReply(call % 4 === 0 ? "{broken" : JSON.stringify({ ok: true }));
    };
    await t.action(async (ctx) => {
      const client = clientForModel(ctx, "openai/gpt-5.6-sol", { callSite: "generation:analyzer" });
      for (let i = 0; i < 20; i += 1) {
        // Every production forced-tool call goes through generateStructured.
        await generateStructured(client, structuredArgs("openai/gpt-5.6-sol")).catch(() => null);
      }
    });
    await drain(t);
    // All 20 were billed...
    expect(await t.run((ctx) => ctx.db.query("aiUsage").collect())).toHaveLength(20);
    // ...but only 15 succeeded.
    const [bucket] = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
    expect(bucket).toMatchObject({ successes: 15, failures: 5 });
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
      { role: "writing", modelId: "openai/gpt-5.6-sol", rolledBack: true },
    ]);
    vi.useRealTimers();
  });
});

describe("finding 1: seed evaluations send the production seed request", () => {
  it("gives a reasoning model the same output budget in evaluation as in production", async () => {
    const t = await setup();
    const reasoning = {
      id: "x-ai/grok-4.7",
      label: "Grok 4.7",
      provider: "xAI",
      gateway: "openrouter" as const,
      reasoning: true,
      maxCompletionTokens: 450000,
    };
    const params = (): GenerationMessageParams => ({
      ...toolParams(reasoning.id),
      max_tokens: SEED_PROMPT_PROGRAM.request.maxTokens,
    });
    await t.action(async (ctx) => {
      registerModelEntries([reasoning]);
      await seedClientForModel(ctx, reasoning.id, { callSite: "generation:seeds:company_context" }).messages.create(params());
      await evalClient(ctx, reasoning, "seed_batch", { input: 1.6, output: 4.8 }).client.messages.create(params());
    });
    expect(captured).toHaveLength(2);
    const [production, evaluation] = captured.map((request) => request.body);
    expect(production.max_tokens).toBe(SEED_PROMPT_PROGRAM.request.maxTokens);
    expect(evaluation.max_tokens).toBe(production.max_tokens);
    expect(evaluation.provider).toEqual(production.provider);
  });
});

describe("second review: outcome attribution and recording", () => {
  const drain = async (t: Awaited<ReturnType<typeof setup>>) =>
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  const buckets = (t: Awaited<ReturnType<typeof setup>>) =>
    t.run((ctx) => ctx.db.query("modelCallBuckets").collect());

  it("E: a fallback's answers, good or malformed, count for the fallback model", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("modelRoleAssignments", {
        role: "structured_helper",
        modelId: "z-ai/glm-5.3-flash",
        previousModelId: "xiaomi/mimo-v2.6-pro",
        assignedAt: NOW,
        assignedBy: "system",
      });
    });
    let call = 0;
    reply = () => {
      call += 1;
      return toolReply(call === 2 ? "{broken" : JSON.stringify({ ok: true }), "xiaomi/mimo-v2.6-pro");
    };
    await t.action(async (ctx) => {
      const { client, model } = await clientForRole(ctx, "structured_helper", { callSite: "routing-test" });
      await generateStructured(client, structuredArgs(model));
      await generateStructured(client, structuredArgs(model)).catch(() => null);
    });
    await drain(t);
    expect(await buckets(t)).toMatchObject([
      { model: "xiaomi/mimo-v2.6-pro", successes: 1, failures: 1 },
    ]);
    vi.useRealTimers();
  });

  it("F: valid JSON in an unusable shape is a failure, recorded after validation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await setup();
    reply = () => toolReply(JSON.stringify({ unexpected: true }));
    await t.action(async (ctx) => {
      const client = clientForModel(ctx, "openai/gpt-5.6-sol", { callSite: "routing-test" });
      await expect(
        generateStructured(client, {
          ...structuredArgs("openai/gpt-5.6-sol"),
          validate: z.object({ required: z.string() }),
        })
      ).rejects.toThrow(/unexpected shape/);
      // A usable answer is the one success.
      reply = () => toolReply(JSON.stringify({ required: "yes" }));
      await generateStructured(client, {
        ...structuredArgs("openai/gpt-5.6-sol"),
        validate: z.object({ required: z.string() }),
      });
    });
    await drain(t);
    expect(await buckets(t)).toMatchObject([
      { model: "openai/gpt-5.6-sol", successes: 1, failures: 1, lastFailureCode: "invalid_output" },
    ]);
    vi.useRealTimers();
  });

  it("F: a slow or failing outcome write never holds up or fails the request, and is logged", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const answer = { content: [{ type: "text" as const, text: "ok" }] };
    const inner = { messages: { create: async () => answer } };
    const hanging = withOutcomeRecording(
      { runMutation: () => new Promise(() => {}) } as never,
      "m",
      "routing-test",
      inner
    );
    const pending = hanging.messages.create({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
    await vi.advanceTimersByTimeAsync(OUTCOME_RECORD_DEADLINE_MS);
    await expect(pending).resolves.toBe(answer);
    expect(errors).toHaveBeenCalledWith("model call outcome not recorded in time", expect.objectContaining({ model: "m" }));
    const rejecting = withOutcomeRecording(
      { runMutation: () => Promise.reject(new Error("write failed")) } as never,
      "m",
      "routing-test",
      inner
    );
    await expect(
      rejecting.messages.create({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }] })
    ).resolves.toBe(answer);
    expect(errors).toHaveBeenCalledWith(
      "model call outcome not recorded",
      expect.objectContaining({ model: "m", error: "Error: write failed" })
    );
    errors.mockRestore();
    vi.useRealTimers();
  });
});

describe("round 3: financial extraction settles after its own validation", () => {
  it("6: an unparseable timesheet reply is a failure and a valid one a success, end to end", async () => {
    const t = await setup();
    const { projectId, uploads } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "financial-writer", role: "admin" });
      const projectId = await ctx.db.insert("projects", {
        title: "Financial",
        clientName: "Client",
        status: "draft",
        createdBy: userId,
        shareToken: "financial-token",
        createdAt: NOW,
        updatedAt: NOW,
      });
      const upload = () =>
        ctx.db.insert("financialUploads", {
          projectId,
          fileName: "log.txt",
          fileType: "slack_export",
          content: "[2025-03-03] Priya: 4 hours of latency tests",
          createdAt: NOW,
          processingStatus: "queued",
        });
      return { projectId, uploads: [await upload(), await upload()] };
    });
    const anthropicText = (text: string) =>
      Response.json({
        id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5",
        content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    reply = () => anthropicText("I could not find any timesheet entries.");
    await t.action(internal.ai.financialAgent.processFinancialUpload, { projectId, uploadId: uploads[0] });
    reply = () =>
      anthropicText(JSON.stringify({
        entries: [{
          personName: "Priya", date: "2025-03-03", hours: 4, hoursBasis: "explicit",
          description: "Latency tests.", sredEligible: true, confidence: "high", source: "Slack",
        }],
      }));
    await t.action(internal.ai.financialAgent.processFinancialUpload, { projectId, uploadId: uploads[1] });
    const [failed, done] = await t.run((ctx) => Promise.all(uploads.map((id) => ctx.db.get(id))));
    expect(failed?.processingStatus).toBe("failed");
    expect(done?.processingStatus).toBe("completed");
    const buckets = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
    expect(buckets).toMatchObject([
      { model: "claude-sonnet-5", successes: 1, failures: 1, lastFailureCode: "invalid_output", lastFailureCallSite: "financial" },
    ]);
  });
});
