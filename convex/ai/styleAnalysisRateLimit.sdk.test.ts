/// <reference types="vite/client" />
/**
 * 2026-10-22: the Settings check ("Check again") when the AI provider
 * answers 429, as on 2026-10-13. The writer is told in plain words to try
 * again shortly instead of seeing a crash. The model catalog,
 * clientForRole, the OpenRouter transport, the Anthropic SDK, the
 * structured decoding and the coverage write stay real; only `fetch` is
 * replaced (AGENTS: prove the SDK boundary through the real request and
 * response path).
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import fixture from "../../shared/__fixtures__/openrouter-models-2026-09-24.json";
import { parseOpenRouterModels } from "../../shared/modelCatalog";
import { STYLE_OVERRIDE_KEYS } from "../../shared/styleOverrides";
import { resetRegisteredModelEntries } from "../../shared/generationModels";
import { applyCatalogRefreshRef } from "../lib/modelCatalogRefs";
import { resetGenerationModelCache } from "./providers";
import { STYLE_CHECK_BUSY_MESSAGE } from "./styleAnalysis";
import { guardProviderNetwork } from "../../tests/providerNetworkGuard";

beforeAll(async () => {
  await import("../providerCredit");
});

guardProviderNetwork();

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ]),
);

const NOW = Date.parse("2026-10-13T12:00:00Z");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SAVED = "Short sentences, active voice.";

const categories = Object.fromEntries(
  STYLE_OVERRIDE_KEYS.map((key) => [
    key,
    key === "sentenceConstruction"
      ? { addressed: true, evidence: "Short sentences" }
      : { addressed: false, evidence: null },
  ]),
);

/** OpenRouter's upstream rate limit, as logged on 2026-10-13. */
const openRouter429 = () =>
  Response.json(
    { error: { code: 429, message: "Provider returned error" } },
    // Zero keeps the transport's one retry immediate in the test.
    { status: 429, headers: { "retry-after": "0" } },
  );

const anthropicAnswer = (model: string) =>
  Response.json(
    {
      id: "msg_style",
      type: "message",
      role: "assistant",
      model,
      content: [
        { type: "tool_use", id: "toolu_1", name: "submit_style_analysis", input: { categories, lockedConflicts: [] } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 40, output_tokens: 12 },
    },
    { headers: { "request-id": "req_style" } },
  );

const anthropic429 = () =>
  Response.json(
    { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your rate limit." } },
    { status: 429, headers: { "retry-after": "0", "request-id": "req_limited" } },
  );

type Seen = { url: string; body: Record<string, unknown> };
let seen: Seen[];
let answer: (url: string) => Response;

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  resetRegisteredModelEntries();
  resetGenerationModelCache();
  seen = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
      return answer(request.url);
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetRegisteredModelEntries();
});

async function setup(options: { onOpenRouter?: boolean } = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.mutation(applyCatalogRefreshRef, {
    models: parseOpenRouterModels(fixture, NOW).models,
    fetchedAt: NOW,
    complete: false,
  });
  await t.run(async (ctx) => {
    if (options.onOpenRouter) {
      await ctx.db.insert("modelRoleAssignments", {
        role: "analysis",
        modelId: "xiaomi/mimo-v2.6-pro",
        assignedAt: NOW,
        assignedBy: "system",
      });
    }
    const userId = await ctx.db.insert("users", { authId: "busy-writer", role: "writer" });
    await ctx.db.insert("writerProfiles", {
      userId,
      customInstructions: SAVED,
      enabled: true,
      updatedBy: userId,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return { t, writer: t.withIdentity({ subject: "busy-writer", tokenIdentifier: "sdk|busy-writer" }) };
}

const check = (writer: Awaited<ReturnType<typeof setup>>["writer"]) =>
  writer.action(api.ai.styleAnalysis.analyzeMyInstructions, { text: SAVED, persist: true });

describe("Check again when the AI provider answers 429 (2026-10-13)", () => {
  it("tells the writer in plain words when Anthropic still rate limits the check after its retries", async () => {
    answer = () => anthropic429();
    const { t, writer } = await setup();

    const error = await check(writer).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ data: { code: "PROVIDER_UNAVAILABLE", message: STYLE_CHECK_BUSY_MESSAGE } });
    expect(STYLE_CHECK_BUSY_MESSAGE).not.toMatch(/[\u2010-\u2015\u2212]/);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((request) => request.url === ANTHROPIC_URL)).toBe(true);
    expect((await writer.query(api.writerProfiles.getMyProfile, {}))?.coverage).toBeUndefined();
    // A rate limit says nothing about the model.
    expect(await t.run((ctx) => ctx.db.query("modelCallOutcomes").collect())).toEqual([]);
  });

  it("says the same when an OpenRouter model is still rate limited after its retry", async () => {
    answer = (url) => (url === OPENROUTER_URL ? openRouter429() : anthropicAnswer("claude-sonnet-5"));
    const { writer } = await setup({ onOpenRouter: true });

    await expect(check(writer)).rejects.toMatchObject({
      data: { code: "PROVIDER_UNAVAILABLE", message: STYLE_CHECK_BUSY_MESSAGE },
    });
    expect(seen.map((request) => request.url)).toEqual([OPENROUTER_URL, OPENROUTER_URL]);
  });

  it("stores the answer when the provider answers", async () => {
    answer = (url) => (url === ANTHROPIC_URL ? anthropicAnswer("claude-sonnet-5") : openRouter429());
    const { writer } = await setup();

    const result = await check(writer);

    expect(result.categories.sentenceConstruction).toEqual({ addressed: true, evidence: "Short sentences" });
  });

  it("throws any other failure as before", async () => {
    answer = (url) =>
      url === OPENROUTER_URL
        ? Response.json({ error: { code: 400, message: "Bad request" } }, { status: 400 })
        : anthropicAnswer("claude-sonnet-5");
    const { writer } = await setup({ onOpenRouter: true });

    const error = await check(writer).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty("data.code", "PROVIDER_UNAVAILABLE");
    expect(seen.map((request) => request.url)).toEqual([OPENROUTER_URL]);
  });
});
