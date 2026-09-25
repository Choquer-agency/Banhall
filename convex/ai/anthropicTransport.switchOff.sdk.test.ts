/// <reference types="vite/client" />

/**
 * With the Anthropic transport switch off (ANTHROPIC_TRANSPORT unset or
 * `direct`), failures classify and count exactly as they did on b8e97f0a,
 * before the switch existed (owner decision 30 review, 2026-09-25, item 3).
 * Only the `openrouter` transport may classify differently.
 *
 * This file uses only APIs that existed on b8e97f0a, so the same tests run
 * unchanged against that code: they passed there and must pass here.
 * Only `fetch` is stubbed.
 */
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { clientForModel, modelFaultCode, normalizeProviderError } from "./providers";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

beforeAll(async () => {
  await import("../modelCatalog");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-09-25T12:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-direct-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function settle<R>(promise: Promise<R>): Promise<{ ok: true; value: R } | { ok: false; error: unknown }> {
  return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

/** One production generation call for `model`, with outcome recording. */
async function call(t: TestConvex, model: string) {
  const result = settle(runAction(t, async (ctx) =>
    await clientForModel(ctx, model, { callSite: "switch-off-contract" }).messages.create({
      model,
      max_tokens: 256,
      system: "Judge the draft.",
      messages: [{ role: "user", content: "The seal failed at 4.2 bar." }],
    } as never)
  ));
  await vi.advanceTimersByTimeAsync(30_000);
  const outcome = await result;
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const outcomes = await t.run((ctx) => ctx.db.query("modelCallOutcomes").collect());
  return { outcome, outcomes };
}

test.each([
  ["unset", undefined],
  ["direct", "direct"],
])("switch %s: a missing ANTHROPIC_API_KEY fails before sending and counts toward rollback, as on b8e97f0a", async (_label, transport) => {
  if (transport !== undefined) vi.stubEnv("ANTHROPIC_TRANSPORT", transport);
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  const fetchSpy = vi.fn<typeof fetch>(() => { throw new Error("Unexpected HTTP transport"); });
  vi.stubGlobal("fetch", fetchSpy);
  const t = convexTest(schema, modules);
  const { outcome, outcomes } = await call(t, "claude-sonnet-5");
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toBeInstanceOf(ConvexError);
  expect((outcome.error as ConvexError<{ code: string }>).data.code).toBe("PROVIDER_NOT_CONFIGURED");
  expect(modelFaultCode(outcome.error)).toBe("unknown");
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(outcomes.map((row) => [row.model, row.outcome])).toEqual([["claude-sonnet-5", "failure"]]);
});

test.each([
  ["unset", "openai/gpt-5.6-sol", undefined],
  ["direct", "openai/gpt-5.6-sol", "direct"],
  ["unset", "google/gemini-3.5-flash", undefined],
])("switch %s: an OpenRouter 402 naming the in-flight budget for %s stays billing, as on b8e97f0a", async (_label, model, transport) => {
  if (transport !== undefined) vi.stubEnv("ANTHROPIC_TRANSPORT", transport);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({
    error: {
      code: 402,
      message: "This request would exceed your in-flight budget given your current in-flight requests.",
      metadata: { reason: "in_flight_budget_exhausted", limit_source: "openrouter_in_flight_budget" },
    },
  }, { status: 402, headers: { "retry-after": "2" } })));
  const t = convexTest(schema, modules);
  const { outcome, outcomes } = await call(t, model);
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(normalizeProviderError(outcome.error)).toEqual({
    code: "billing",
    message: "The AI provider account cannot accept this request because billing or credits need attention.",
  });
  expect(modelFaultCode(outcome.error)).toBeNull();
  expect(outcomes).toEqual([]);
});
