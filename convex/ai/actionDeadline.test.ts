import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  ACTION_REQUEST_WINDOW_MS,
  ACTION_TIME_BUDGET_MESSAGE,
  ActionTimeBudgetError,
  CONVEX_ACTION_LIMIT_MS,
  MAX_SDK_RETRY_BACKOFF_MS,
  MIN_USEFUL_REQUEST_MS,
  RESERVED_NON_REQUEST_MS,
  actionDeadline,
  anthropicRetryDelayMs,
  markStoppedByDeadline,
  requestBudget,
  retryFitsDeadline,
  retryWaitFitsAnyAction,
  startActionDeadline,
  wasStoppedByDeadline,
} from "./actionDeadline";
import {
  ANTHROPIC_MAX_RETRIES,
  ANTHROPIC_TIMEOUT_MS,
  describeProviderFailure,
  modelFaultCode,
  normalizeProviderError,
} from "./providers";
import { draftingInputsFailureCode, draftingInputsNeedShorterAnalysis } from "./iterative";
import { OpenRouterError } from "./openrouter";
import { OutputLimitError } from "./openrouterCore";

describe("action deadline arithmetic (cutoff review P2-2)", () => {
  it("ends every request 60 s before the Convex action limit", () => {
    expect(CONVEX_ACTION_LIMIT_MS).toBe(600_000);
    expect(RESERVED_NON_REQUEST_MS).toBe(60_000);
    expect(ACTION_REQUEST_WINDOW_MS).toBe(540_000);
    const ctx = {};
    expect(actionDeadline(ctx)).toBeUndefined();
    expect(startActionDeadline(ctx, 1_000)).toBe(541_000);
    expect(actionDeadline(ctx)).toBe(541_000);
    // Each action context has its own deadline.
    expect(actionDeadline({})).toBeUndefined();
  });

  it("leaves a request untouched when its action set no deadline", () => {
    expect(requestBudget({ deadline: undefined, now: 9e12, timeoutMs: 240_000, maxRetries: 1 }))
      .toEqual({ timeoutMs: 240_000, maxRetries: 1, shortened: false });
  });

  it("keeps the defaults while every attempt and the backoff fit", () => {
    const deadline = startActionDeadline({}, 0);
    expect(requestBudget({ deadline, now: 0, timeoutMs: ANTHROPIC_TIMEOUT_MS, maxRetries: ANTHROPIC_MAX_RETRIES }))
      .toEqual({ timeoutMs: 240_000, maxRetries: 1, shortened: false });
    // 2 x 240 s + 8 s = 488 s: the retry still fits with 488 s left.
    const tight = 2 * ANTHROPIC_TIMEOUT_MS + MAX_SDK_RETRY_BACKOFF_MS;
    expect(requestBudget({ deadline, now: deadline - tight, timeoutMs: 240_000, maxRetries: 1 }).maxRetries).toBe(1);
  });

  it("drops the retry when a second attempt would not fit", () => {
    const deadline = 1_000_000;
    const now = deadline - (2 * 240_000 + MAX_SDK_RETRY_BACKOFF_MS - 1);
    expect(requestBudget({ deadline, now, timeoutMs: 240_000, maxRetries: 1 }))
      .toEqual({ timeoutMs: 240_000, maxRetries: 0, shortened: false });
  });

  it("cuts the timeout to the time left, with no retry", () => {
    const deadline = 1_000_000;
    expect(requestBudget({ deadline, now: deadline - 100_000, timeoutMs: 240_000, maxRetries: 1 }))
      .toEqual({ timeoutMs: 100_000, maxRetries: 0, shortened: true });
    // The seed policy: 90 s and no retry, cut only when less is left.
    expect(requestBudget({ deadline, now: deadline - 100_000, timeoutMs: 90_000, maxRetries: 0 }))
      .toEqual({ timeoutMs: 90_000, maxRetries: 0, shortened: false });
    expect(requestBudget({ deadline, now: deadline - 30_000, timeoutMs: 90_000, maxRetries: 0 }))
      .toEqual({ timeoutMs: 30_000, maxRetries: 0, shortened: true });
  });

  it("refuses to send with less than the minimum useful time left", () => {
    const deadline = 1_000_000;
    expect(requestBudget({ deadline, now: deadline - MIN_USEFUL_REQUEST_MS, timeoutMs: 240_000, maxRetries: 1 }))
      .toEqual({ timeoutMs: MIN_USEFUL_REQUEST_MS, maxRetries: 0, shortened: true });
    expect(() => requestBudget({ deadline, now: deadline - MIN_USEFUL_REQUEST_MS + 1, timeoutMs: 240_000, maxRetries: 1 }))
      .toThrow(ActionTimeBudgetError);
    expect(() => requestBudget({ deadline, now: deadline + 5_000, timeoutMs: 240_000, maxRetries: 1 }))
      .toThrow(ACTION_TIME_BUDGET_MESSAGE);
  });

  it("bounds a structured call with its repair: both requests end by the deadline", () => {
    // Worst case before the deadline: cut, repair, each timing out once and
    // retried. Simulate it against the budget.
    const deadline = startActionDeadline({}, 0);
    let now = 0;
    let requests = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let budget;
      try {
        budget = requestBudget({ deadline, now, timeoutMs: 240_000, maxRetries: 1 });
      } catch (error) {
        expect(error).toBeInstanceOf(ActionTimeBudgetError);
        break;
      }
      requests += 1;
      now += (budget.maxRetries + 1) * budget.timeoutMs + budget.maxRetries * MAX_SDK_RETRY_BACKOFF_MS;
      expect(now).toBeLessThanOrEqual(deadline);
    }
    // 488 s for the first request, then 52 s left: one 52 s repair, no retry.
    expect(requests).toBe(2);
    expect(now).toBe(deadline);
    expect(now + RESERVED_NON_REQUEST_MS).toBe(CONVEX_ACTION_LIMIT_MS);
  });

  it("is a writer-facing failure that never counts against the model", () => {
    const error = new ActionTimeBudgetError();
    expect(error.message).toBe(ACTION_TIME_BUDGET_MESSAGE);
    // No colon: the read side shows it as is (userSafeStoredError).
    expect(ACTION_TIME_BUDGET_MESSAGE).not.toContain(":");
    expect(ACTION_TIME_BUDGET_MESSAGE).not.toMatch(/[\u2013\u2014\u00b7]/);
    expect(modelFaultCode(error)).toBeNull();
    expect(normalizeProviderError(error)).toEqual({ code: "unknown", message: ACTION_TIME_BUDGET_MESSAGE });
    expect(describeProviderFailure(error)).toBe(ACTION_TIME_BUDGET_MESSAGE);
    // Every other failure keeps its stored "<code>: <message>" form.
    const other = Object.assign(new Error("slow down"), { status: 429 });
    expect(describeProviderFailure(other)).toBe(
      "rate_limited: The AI provider is rate-limiting requests. Try again after the limit resets."
    );
  });

  it("decides a retry against the time left after its wait (review 2026-09-25, P2-2)", () => {
    expect(retryFitsDeadline(undefined, 0, 1_000_000)).toBe(true);
    expect(retryFitsDeadline(100_000, 70_000, 10_000)).toBe(true);
    expect(retryFitsDeadline(100_000, 70_000, 10_001)).toBe(false);
    const headers = (values: Record<string, string>) => new Headers(values);
    expect(anthropicRetryDelayMs(headers({ "retry-after-ms": "10" }), 0, 0, () => 0)).toBe(10);
    expect(anthropicRetryDelayMs(headers({ "retry-after": "25" }), 0, 0, () => 0)).toBe(25_000);
    expect(anthropicRetryDelayMs(headers({ "retry-after": "Thu, 01 Jan 1970 00:00:30 GMT" }), 0, 10_000, () => 0)).toBe(20_000);
    // The SDK's backoff: 0.5 s doubling to 8 s, up to 25 percent less.
    expect(anthropicRetryDelayMs(undefined, 0, 0, () => 0)).toBe(500);
    expect(anthropicRetryDelayMs(undefined, 1, 0, () => 1)).toBe(750);
    expect(anthropicRetryDelayMs(undefined, 10, 0, () => 0)).toBe(MAX_SDK_RETRY_BACKOFF_MS);
  });

  it("tells a wait some action could fit from one none could (fix-g review P3-1)", () => {
    const longest = ACTION_REQUEST_WINDOW_MS - MIN_USEFUL_REQUEST_MS;
    expect(longest).toBe(520_000);
    expect(retryWaitFitsAnyAction(0)).toBe(true);
    expect(retryWaitFitsAnyAction(longest)).toBe(true);
    expect(retryWaitFitsAnyAction(longest + 1)).toBe(false);
  });

  it("counts a provider failure that outlasts its retries, and never one the deadline stopped (fix-g review P2-2)", () => {
    const headers = new Headers();
    const failures = () => [
      new Anthropic.InternalServerError(500, undefined, "boom", headers),
      Anthropic.APIError.generate(529, undefined, "overloaded", headers),
      Anthropic.APIError.generate(408, undefined, "timeout", headers),
      Anthropic.APIError.generate(409, undefined, "conflict", headers),
      new Anthropic.APIConnectionError({ message: "Connection error." }),
      new Anthropic.APIConnectionTimeoutError(),
      new OpenRouterError("OpenRouter request failed with status 502: down", 502),
      new OpenRouterError("OpenRouter request failed with status 500", 500),
    ];
    // After every retry it was allowed, each one is a model fault, as
    // before this branch series (decision 21).
    expect(failures().map(modelFaultCode)).toEqual(Array(8).fill("unknown"));
    // The same failure whose retry the action's deadline refused is not.
    expect(failures().map((error) => modelFaultCode(markStoppedByDeadline(error)))).toEqual(Array(8).fill(null));
    expect(wasStoppedByDeadline(markStoppedByDeadline(new Error("x")))).toBe(true);
    expect(wasStoppedByDeadline(new Error("x"))).toBe(false);
    expect(wasStoppedByDeadline(undefined)).toBe(false);
    // A client error still counts; rate limits and billing still never do.
    expect(modelFaultCode(Anthropic.APIError.generate(400, undefined, "bad request", headers))).toBe("unknown");
    expect(modelFaultCode(Anthropic.APIError.generate(429, undefined, "slow down", headers))).toBeNull();
    expect(modelFaultCode(new OpenRouterError("OpenRouter request failed with status 402", 402))).toBeNull();
  });

  it("stores a background step that ran out of time as timed_out, and asks for a shorter analysis when it was too long", () => {
    expect(draftingInputsFailureCode(new ActionTimeBudgetError())).toBe("timed_out");
    expect(draftingInputsFailureCode(new Anthropic.APIConnectionTimeoutError())).toBe("timed_out");
    expect(draftingInputsFailureCode(new OpenRouterError("OpenRouter request timed out after 240000ms"))).toBe("timed_out");
    expect(draftingInputsFailureCode(new OutputLimitError("cut"))).toBe("output_limit");
    expect(draftingInputsFailureCode(Object.assign(new Error("slow down"), { status: 429 }))).toBe("rate_limited");

    const shorter = (code: Parameters<typeof draftingInputsNeedShorterAnalysis>[0]["code"], sawCutOff: boolean, analyzerModel?: string) =>
      draftingInputsNeedShorterAnalysis({ code, sawCutOff, analyzerModel });
    expect(shorter("output_limit", false)).toBe(true);
    expect(shorter("rate_limited", true, "claude-sonnet-5")).toBe(true);
    expect(shorter("timed_out", false, "claude-opus-5-5")).toBe(true);
    expect(shorter("timed_out", false, "claude-sonnet-5")).toBe(false);
    // A timeout before the analyzer ran (retrieval) says nothing about its length.
    expect(shorter("timed_out", false, undefined)).toBe(false);
    expect(shorter("unknown", false, "claude-opus-5-5")).toBe(false);
  });
});
