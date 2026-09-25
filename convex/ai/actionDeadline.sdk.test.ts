/// <reference types="vite/client" />

/**
 * The action deadline at the real transport boundary (2026-09-25, cutoff
 * review P2-2). Only `fetch` is stubbed (and, for OpenRouter, the timer
 * behind AbortSignal.timeout): the Anthropic SDK with its own timeout and
 * retry, the OpenRouter transport, outcome recording and the Convex
 * scheduler are the production ones.
 *
 * - Near the deadline a request is sent with its timeout cut to the time
 *   left and no transport retry; when that timer fires the call fails with
 *   the writer-facing ActionTimeBudgetError.
 * - Past the minimum useful time a request is never sent.
 * - A structured call's repair goes through the same bound.
 * - None of these count against the model; the bodies are unchanged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic } from "./instrument";
import { openRouterChatCompletion } from "./openrouter";
import type { GenerationClient } from "./openrouterCore";
import {
  ACTION_REQUEST_WINDOW_MS,
  ACTION_TIME_BUDGET_MESSAGE,
  ActionTimeBudgetError,
  startActionDeadline,
} from "./actionDeadline";
import { describeProviderFailure, withOutcomeRecording } from "./providers";
import { generateStructured } from "./structured";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

const START = Date.parse("2026-09-25T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-deadline-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-deadline-openrouter");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Start the action's deadline so that `leftMs` of request time is left. */
function withTimeLeft(ctx: ActionCtx, leftMs: number): void {
  startActionDeadline(ctx, Date.now() - (ACTION_REQUEST_WINDOW_MS - leftMs));
}

const params = {
  model: "claude-sonnet-5",
  max_tokens: 256,
  system: "Judge the draft.",
  messages: [{ role: "user" as const, content: "The seal failed at 4.2 bar." }],
};

const structured = {
  system: "Judge the draft.",
  user: "The seal failed at 4.2 bar.",
  toolName: "submit_judgement",
  description: "Return the judgement.",
  schema: { type: "object" as const, properties: { ok: { type: "boolean" } }, required: ["ok"] },
  maxTokens: 256,
  model: "claude-sonnet-5",
};

/** A fetch that never answers; it rejects when the SDK aborts the attempt. */
function hangingFetch() {
  return vi.fn<typeof fetch>((_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")));
    })
  );
}

function serverError() {
  return Response.json(
    { type: "error", error: { type: "api_error", message: "Synthetic overload" } },
    { status: 500, headers: { "retry-after-ms": "10" } }
  );
}

async function outcomeRows(t: TestConvex) {
  return await t.run((ctx) => ctx.db.query("modelCallOutcomes").collect());
}

async function settle<R>(promise: Promise<R>): Promise<{ ok: true; value: R } | { ok: false; error: unknown }> {
  return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

test("Anthropic, 100 s left: the SDK attempt times out at 100 s, not 240 s, is not retried, and fails with the writer-facing error", async () => {
  const t = convexTest(schema, modules);
  const transport = hangingFetch();
  vi.stubGlobal("fetch", transport);
  const result = settle(runAction(t, async (ctx) => {
    withTimeLeft(ctx, 100_000);
    const client = withOutcomeRecording(ctx, params.model, "deadline-contract",
      instrumentedAnthropic(ctx, { callSite: "deadline-contract" }) as unknown as GenerationClient);
    return await client.messages.create(params);
  }));
  let done = false;
  void result.then(() => { done = true; });

  await vi.advanceTimersByTimeAsync(99_000);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1_000);
  const outcome = await result;

  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toBeInstanceOf(ActionTimeBudgetError);
  expect(describeProviderFailure(outcome.error)).toBe(ACTION_TIME_BUDGET_MESSAGE);
  // Never retried, although the client allows one retry by default.
  await vi.advanceTimersByTimeAsync(600_000);
  expect(transport).toHaveBeenCalledTimes(1);
  // The body is exactly the request; only transport options changed.
  const body: unknown = await new Request(...(transport.mock.calls[0] as [RequestInfo, RequestInit])).json();
  expect(body).toEqual(params);
  // Our own time limit is not the model's fault.
  expect(await outcomeRows(t)).toEqual([]);
});

test("Anthropic: a retryable failure is retried with time to spare, and not when the retry cannot fit", async () => {
  const t = convexTest(schema, modules);
  const transport = vi.fn<typeof fetch>(async () => serverError());
  vi.stubGlobal("fetch", transport);
  const call = (leftMs: number) =>
    settle(runAction(t, async (ctx) => {
      withTimeLeft(ctx, leftMs);
      return await instrumentedAnthropic(ctx, { callSite: "deadline-contract" }).messages.create(params);
    }));

  const roomy = call(ACTION_REQUEST_WINDOW_MS);
  await vi.advanceTimersByTimeAsync(1_000);
  const roomyOutcome = await roomy;
  expect(transport).toHaveBeenCalledTimes(2);
  expect(roomyOutcome.ok).toBe(false);
  if (!roomyOutcome.ok) expect(roomyOutcome.error).toBeInstanceOf(Anthropic.InternalServerError);

  transport.mockClear();
  const tight = call(300_000);
  await vi.advanceTimersByTimeAsync(1_000);
  const tightOutcome = await tight;
  // 2 x 240 s + backoff does not fit 300 s: one attempt, the provider's error.
  expect(transport).toHaveBeenCalledTimes(1);
  expect(tightOutcome.ok).toBe(false);
  if (!tightOutcome.ok) expect(tightOutcome.error).toBeInstanceOf(Anthropic.InternalServerError);
});

test("Anthropic and OpenRouter, 10 s left: nothing is sent, the call fails with the writer-facing error and records no outcome", async () => {
  const t = convexTest(schema, modules);
  const transport = vi.fn<typeof fetch>(async () => { throw new Error("must not be sent"); });
  vi.stubGlobal("fetch", transport);
  const outcome = await runAction(t, async (ctx) => {
    withTimeLeft(ctx, 10_000);
    const anthropic = withOutcomeRecording(ctx, params.model, "deadline-contract",
      instrumentedAnthropic(ctx, { callSite: "deadline-contract" }) as unknown as GenerationClient);
    const errors: unknown[] = [];
    await anthropic.messages.create(params).catch((error: unknown) => errors.push(error));
    await openRouterChatCompletion(ctx, {
      body: { model: "openai/gpt-5.6-luna", messages: [] },
      model: "openai/gpt-5.6-luna",
      callSite: "deadline-contract",
    }).catch((error: unknown) => errors.push(error));
    return errors.map((error) => [
      error instanceof ActionTimeBudgetError,
      error instanceof Error ? error.message : String(error),
    ]);
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(outcome).toEqual([
    [true, ACTION_TIME_BUDGET_MESSAGE],
    [true, ACTION_TIME_BUDGET_MESSAGE],
  ]);
  expect(transport).not.toHaveBeenCalled();
  expect(await outcomeRows(t)).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("aiUsage").collect())).toEqual([]);
});

test("OpenRouter, 100 s left: the attempt timer is cut to 100 s, no retry follows, and its timeout fails with the writer-facing error", async () => {
  const t = convexTest(schema, modules);
  const timer = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timer.signal);
  const transport = vi.fn<typeof fetch>((_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation timed out.", "TimeoutError")));
    })
  );
  vi.stubGlobal("fetch", transport);
  const body = { model: "openai/gpt-5.6-luna", max_tokens: 16_384, messages: [{ role: "user", content: "Hi" }] };
  const result = settle(runAction(t, async (ctx) => {
    withTimeLeft(ctx, 100_000);
    return await openRouterChatCompletion(ctx, { body, model: "openai/gpt-5.6-luna", callSite: "deadline-contract" });
  }));
  await vi.advanceTimersByTimeAsync(0);
  expect(timeout).toHaveBeenCalledWith(100_000);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual(body);

  timer.abort(new DOMException("The operation timed out.", "TimeoutError"));
  const outcome = await result;
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.error).toBeInstanceOf(ActionTimeBudgetError);
  expect(transport).toHaveBeenCalledTimes(1);
});

test("OpenRouter: a 500 is retried only while a useful attempt still fits after its delay", async () => {
  const t = convexTest(schema, modules);
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({ error: { message: "busy" } }, { status: 500, headers: { "retry-after": "25" } }));
  vi.stubGlobal("fetch", transport);
  const call = (leftMs: number) =>
    settle(runAction(t, async (ctx) => {
      withTimeLeft(ctx, leftMs);
      return await openRouterChatCompletion(ctx, {
        body: { model: "openai/gpt-5.6-luna", messages: [] },
        model: "openai/gpt-5.6-luna",
        callSite: "deadline-contract",
      });
    }));

  const roomy = call(300_000);
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await roomy).ok).toBe(false);
  expect(transport).toHaveBeenCalledTimes(2);

  transport.mockClear();
  // 40 s left: a 25 s wait would leave 15 s, under the useful minimum.
  const tight = call(40_000);
  await vi.advanceTimersByTimeAsync(30_000);
  const outcome = await tight;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(String(outcome.error)).toMatch(/status 500/);
});

test("a cut-off answer near the deadline: the repair is not sent and the call fails fast, counting only the billed cut", async () => {
  const t = convexTest(schema, modules);
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    bodies.push(await new Request(input, init).json());
    // The first answer takes 90 s and is cut off at max_tokens.
    vi.setSystemTime(Date.now() + 90_000);
    return Response.json({
      id: "msg_cut",
      type: "message",
      role: "assistant",
      model: structured.model,
      content: [{ type: "tool_use", id: "tool_cut", name: structured.toolName, input: { ok: true } }],
      stop_reason: "max_tokens",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 256 },
    });
  }));
  const outcome = await runAction(t, async (ctx) => {
    withTimeLeft(ctx, 100_000);
    const client = withOutcomeRecording(ctx, structured.model, "deadline-contract",
      instrumentedAnthropic(ctx, { callSite: "deadline-contract" }) as unknown as GenerationClient);
    try {
      await generateStructured(client, structured);
      return "accepted";
    } catch (error) {
      return describeProviderFailure(error);
    }
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(outcome).toBe(ACTION_TIME_BUDGET_MESSAGE);
  expect(bodies).toHaveLength(1);
  // The cut answer was billed and is one failure of the model; the repair
  // that was never sent records nothing.
  const outcomes = await outcomeRows(t);
  expect(outcomes.map((row) => row.outcome)).toEqual(["failure"]);
  const buckets = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
  expect(buckets.map((row) => [row.failures, row.lastFailureCode])).toEqual([[1, "output_limit"]]);
});
