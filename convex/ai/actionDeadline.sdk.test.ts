/// <reference types="vite/client" />

/**
 * The action deadline at the real transport boundary (2026-09-25, cutoff
 * review P2-2). Only `fetch` is stubbed (and, for OpenRouter, the timer
 * behind AbortSignal.timeout): the Anthropic SDK with its own timeout and
 * retry, the OpenRouter transport, outcome recording and the Convex
 * scheduler are the production ones.
 *
 * - Near the deadline a request is sent with its timeout cut to the time
 *   left; when that timer fires the call fails with the writer-facing
 *   ActionTimeBudgetError. A transport retry is decided when the failure
 *   happens, so a fast 500 or 529 late in an action is still retried.
 * - Past the minimum useful time a request is never sent.
 * - A structured call's repair goes through the same bound.
 * - None of these count against the model; the bodies are unchanged. A
 *   request that still fails after every retry it was allowed does count
 *   (decision 21, fix-g review P2-2).
 */
import Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic } from "./instrument";
import { instrumentedOpenRouter, openRouterChatCompletion } from "./openrouter";
import type { GenerationClient } from "./openrouterCore";
import {
  ACTION_REQUEST_WINDOW_MS,
  ACTION_TIME_BUDGET_MESSAGE,
  ActionTimeBudgetError,
  startActionDeadline,
} from "./actionDeadline";
import { describeProviderFailure, withOutcomeRecording } from "./providers";
import { generateStructured } from "./structured";
import { productionErrorVerdict } from "../../shared/modelCatalog";

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
  // Late in the action (300 s left, long past the first 52 s): a fast 500
  // is still retried, since a useful attempt fits after the 10 ms wait
  // (review 2026-09-25, P2-2). Each retry is decided when it happens.
  const late = call(300_000);
  await vi.advanceTimersByTimeAsync(1_000);
  const lateOutcome = await late;
  expect(transport).toHaveBeenCalledTimes(2);
  expect(lateOutcome.ok).toBe(false);
  if (!lateOutcome.ok) expect(lateOutcome.error).toBeInstanceOf(Anthropic.InternalServerError);

  transport.mockClear();
  // 25 s left and the provider asks for a 10 s wait: 15 s would be left,
  // under the useful minimum, so the provider's error is returned at once.
  transport.mockImplementation(async () =>
    Response.json(
      { type: "error", error: { type: "overloaded_error", message: "Synthetic overload" } },
      { status: 529, headers: { "retry-after": "10" } }
    ));
  const tight = call(25_000);
  await vi.advanceTimersByTimeAsync(1_000);
  const tightOutcome = await tight;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(tightOutcome.ok).toBe(false);
  if (!tightOutcome.ok) expect((tightOutcome.error as { status?: number }).status).toBe(529);
});

test("Anthropic, late in the action: a fast 529 is retried and the answer is used; a 529 that outlasts the retry counts", async () => {
  const t = convexTest(schema, modules);
  let calls = 0;
  const transport = vi.fn<typeof fetch>(async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json(
        { type: "error", error: { type: "overloaded_error", message: "Synthetic overload" } },
        { status: 529 }
      );
    }
    return Response.json({
      id: "msg_late",
      type: "message",
      role: "assistant",
      model: params.model,
      content: [{ type: "text", text: "Pass." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  });
  vi.stubGlobal("fetch", transport);
  const result = settle(runAction(t, async (ctx) => {
    withTimeLeft(ctx, 200_000);
    const client = withOutcomeRecording(ctx, params.model, "deadline-contract",
      instrumentedAnthropic(ctx, { callSite: "deadline-contract" }) as unknown as GenerationClient);
    return await client.messages.create(params);
  }));
  await vi.advanceTimersByTimeAsync(10_000);
  const outcome = await result;
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(outcome.ok).toBe(true);
  expect(transport).toHaveBeenCalledTimes(2);
  // The same body on both attempts.
  const bodies = await Promise.all(
    transport.mock.calls.map((call) => new Request(...(call as [RequestInfo, RequestInit])).json())
  );
  expect(bodies).toEqual([params, params]);
  expect((await outcomeRows(t)).map((row) => row.outcome)).toEqual(["success"]);

  // With no retry left, the overload fails the call and counts against the
  // model, as it did before this branch series (fix-g review P2-2).
  transport.mockClear();
  transport.mockImplementation(async () =>
    Response.json({ type: "error", error: { type: "overloaded_error", message: "Synthetic overload" } }, { status: 529 }));
  const failed = settle(runAction(t, async (ctx) => {
    withTimeLeft(ctx, 200_000);
    const client = withOutcomeRecording(ctx, params.model, "deadline-contract",
      instrumentedAnthropic(ctx, { callSite: "deadline-contract" }) as unknown as GenerationClient);
    return await client.messages.create(params);
  }));
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await failed).ok).toBe(false);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(transport).toHaveBeenCalledTimes(2);
  expect((await outcomeRows(t)).map((row) => row.outcome)).toEqual(["success", "failure"]);
});

/** One request through outcome recording on either gateway, with `leftMs` of request time or no deadline. */
function recordedCall(t: TestConvex, gateway: "anthropic" | "openrouter", leftMs: number | undefined) {
  return settle(runAction(t, async (ctx) => {
    if (leftMs !== undefined) withTimeLeft(ctx, leftMs);
    if (gateway === "anthropic") {
      const client = withOutcomeRecording(ctx, params.model, "deadline-contract",
        instrumentedAnthropic(ctx, { callSite: "deadline-contract" }) as unknown as GenerationClient);
      return await client.messages.create(params);
    }
    const client = withOutcomeRecording(ctx, "openai/gpt-6-sol", "deadline-contract",
      instrumentedOpenRouter(ctx, { callSite: "deadline-contract" }));
    return await client.messages.create({ ...params, model: "openai/gpt-6-sol" });
  }));
}

test.each(["anthropic", "openrouter"] as const)(
  "%s: a model that always answers 500 counts on every request after its retries, and would be rolled back (fix-g review P2-2)",
  async (gateway) => {
    const t = convexTest(schema, modules);
    const transport = vi.fn<typeof fetch>(async () =>
      gateway === "anthropic"
        ? serverError()
        : Response.json({ error: { message: "Synthetic outage" } }, { status: 500, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", transport);
    // 20 requests: the daily minimum for a rollback. Half under an action
    // deadline with time to spare, half from an action without one.
    for (let index = 0; index < 20; index += 1) {
      const result = recordedCall(t, gateway, index % 2 === 0 ? ACTION_REQUEST_WINDOW_MS : undefined);
      await vi.advanceTimersByTimeAsync(30_000);
      const outcome = await result;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect((outcome.error as { status?: number }).status).toBe(500);
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // Every request was retried once, then failed.
    expect(transport).toHaveBeenCalledTimes(40);
    const rows = await outcomeRows(t);
    expect(rows.map((row) => row.outcome)).toEqual(Array(20).fill("failure"));
    expect(productionErrorVerdict({ successes: 0, failures: rows.length }).rollback).toBe(true);
  }
);

test("Anthropic and OpenRouter: a failure whose retry the deadline refused counts against no model (fix-g review P2-2)", async () => {
  const t = convexTest(schema, modules);
  // Anthropic, 25 s left and a 529 asking for a 10 s wait: the retry would
  // leave 15 s, so the 529 is returned at once.
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json(
      { type: "error", error: { type: "overloaded_error", message: "Synthetic overload" } },
      { status: 529, headers: { "retry-after": "10" } }
    ));
  vi.stubGlobal("fetch", transport);
  const overloaded = recordedCall(t, "anthropic", 25_000);
  await vi.advanceTimersByTimeAsync(1_000);
  const overloadedOutcome = await overloaded;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(overloadedOutcome.ok).toBe(false);
  if (!overloadedOutcome.ok) expect((overloadedOutcome.error as { status?: number }).status).toBe(529);

  // Anthropic, a dropped connection with 20.2 s left: the retry's backoff
  // would leave less than a useful attempt.
  transport.mockReset();
  transport.mockImplementation(async () => { throw new TypeError("fetch failed"); });
  const dropped = recordedCall(t, "anthropic", 20_200);
  await vi.advanceTimersByTimeAsync(1_000);
  const droppedOutcome = await dropped;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(droppedOutcome.ok).toBe(false);
  if (!droppedOutcome.ok) expect(droppedOutcome.error).toBeInstanceOf(Anthropic.APIConnectionError);

  // OpenRouter, 40 s left and a 500 asking for a 25 s wait.
  transport.mockReset();
  transport.mockImplementation(async () =>
    Response.json({ error: { message: "busy" } }, { status: 500, headers: { "retry-after": "25" } }));
  const busy = recordedCall(t, "openrouter", 40_000);
  await vi.advanceTimersByTimeAsync(30_000);
  const busyOutcome = await busy;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(busyOutcome.ok).toBe(false);
  if (!busyOutcome.ok) expect(String(busyOutcome.error)).toMatch(/status 500/);

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await outcomeRows(t)).toEqual([]);

  // The same failures with time for the retry, which fails too, do count.
  transport.mockClear();
  const roomy = recordedCall(t, "openrouter", 300_000);
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await roomy).ok).toBe(false);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(transport).toHaveBeenCalledTimes(2);
  expect((await outcomeRows(t)).map((row) => row.outcome)).toEqual(["failure"]);
});

test("Anthropic, 300 s left: a full 240 s timeout is retried with the retry's timeout cut to the time left, which then fails as out of time", async () => {
  const t = convexTest(schema, modules);
  const transport = hangingFetch();
  vi.stubGlobal("fetch", transport);
  const result = settle(runAction(t, async (ctx) => {
    withTimeLeft(ctx, 300_000);
    const client = withOutcomeRecording(ctx, params.model, "deadline-contract",
      instrumentedAnthropic(ctx, { callSite: "deadline-contract" }) as unknown as GenerationClient);
    return await client.messages.create(params);
  }));
  await vi.advanceTimersByTimeAsync(240_000);
  expect(transport).toHaveBeenCalledTimes(1);
  // The backoff (at most 0.5 s on the first retry), then the retry.
  await vi.advanceTimersByTimeAsync(1_000);
  expect(transport).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  const outcome = await result;
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.error).toBeInstanceOf(ActionTimeBudgetError);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(await outcomeRows(t)).toEqual([]);
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
