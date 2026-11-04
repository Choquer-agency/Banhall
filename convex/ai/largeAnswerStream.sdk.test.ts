/// <reference types="vite/client" />

/**
 * A request for a large answer streams (2026-10-26, context pipeline plan
 * P0 item 4 and failure 7). Only `fetch` is stubbed: the Anthropic SDK, its
 * server-sent event parser, instrumentedAnthropic and the usage writes are
 * the production ones.
 *
 * - A request whose max_tokens as sent is above 16,384 is sent with
 *   `stream: true` and read to its end; its caller gets the message `create`
 *   would have returned, citations, thinking and signatures included.
 * - A stream that ends without a stop reason is never an answer. Closed part
 *   way, or broken by an overloaded or api error event, it is retried like a
 *   dropped request; any other error event is not.
 * - The whole stream is bounded: by its client's own timeout, else by the
 *   action's deadline. The usage a stopped stream reported is logged.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic, STREAM_IDLE_LIMIT_MS, StreamInterruptedError, StreamTimeLimitError } from "./instrument";
import { ANTHROPIC_TIMEOUT_MS } from "./providers";
import { RequestAbortedError } from "./openrouterCore";
import { ACTION_REQUEST_WINDOW_MS, ActionTimeBudgetError, startActionDeadline } from "./actionDeadline";
import { LARGE_ANSWER_STREAM_THRESHOLD } from "../../shared/generationModels";
import { anthropicMessageSse, sseResponse } from "../anthropicSse.fixture";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

// The credit latch read (decision 64) runs before each Anthropic request;
// load its module first so a cold import cannot race the fake clock.
beforeAll(async () => {
  await import("../providerCredit");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-stream-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const MODEL = "claude-sonnet-5";

const params = (maxTokens: number) => ({
  model: MODEL,
  max_tokens: maxTokens,
  system: "Summarize the evidence.",
  messages: [{ role: "user" as const, content: "The seal failed at 4.2 bar." }],
});

const ANSWER = {
  type: "message",
  role: "assistant",
  model: MODEL,
  content: [{ type: "text", text: "The seal failed at 4.2 bar in the third trial." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 40, output_tokens: 12 },
};

type Body = { max_tokens: number; stream?: boolean };

/** Starts the action's deadline so that `leftMs` of request time is left. */
function withTimeLeft(ctx: ActionCtx, leftMs: number): void {
  startActionDeadline(ctx, Date.now() - (ACTION_REQUEST_WINDOW_MS - leftMs));
}

/**
 * A server-sent event body that sends `text`, then either closes or stays
 * open until the request's signal aborts (as a real connection does).
 */
function sseBody(
  text: string,
  init: RequestInit | undefined,
  options: { hang?: boolean; dripEveryMs?: number } = {}
): Response {
  let drip: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      if (!options.hang) {
        controller.close();
        return;
      }
      // A stream that keeps writing: one more piece of text now and then.
      if (options.dripEveryMs) {
        drip = setInterval(() => {
          const delta = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " more" } };
          controller.enqueue(new TextEncoder().encode(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`));
        }, options.dripEveryMs);
      }
      init?.signal?.addEventListener("abort", () => {
        clearInterval(drip);
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
      });
    },
    cancel() {
      clearInterval(drip);
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** The events of ANSWER up to its last content delta: no stop reason. */
function cutStream(): string {
  const whole = anthropicMessageSse(ANSWER);
  return whole.slice(0, whole.indexOf("event: content_block_stop"));
}

/** With real timers: lets the usage writes scheduled at 0 ms run. */
async function flushRealTime(t: TestConvex): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await t.finishAllScheduledFunctions(() => undefined);
}

async function usageRows(t: TestConvex) {
  return (await t.run((ctx) => ctx.db.query("aiUsage").collect())).map((row) => ({
    stopReason: row.stopReason,
    partial: row.partial,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  }));
}

test("above 16,384 tokens as sent a request streams, at 16,384 it does not, and both return the same message and usage", async () => {
  const t = convexTest(schema, modules);
  const bodies: Body[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const body = await new Request(input, init).json() as Body;
    bodies.push(body);
    return body.stream ? sseResponse(anthropicMessageSse(ANSWER)) : Response.json(ANSWER);
  }));
  const answers = await t.action(async (ctx) => {
    const client = instrumentedAnthropic(ctx, { callSite: "stream-contract" });
    return [
      await client.messages.create(params(LARGE_ANSWER_STREAM_THRESHOLD)),
      await client.messages.create(params(LARGE_ANSWER_STREAM_THRESHOLD + 1)),
    ];
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(bodies.map((body) => [body.max_tokens, body.stream === true])).toEqual([
    [16_384, false],
    [16_385, true],
  ]);
  const [plain, streamed] = answers as unknown as Array<Record<string, unknown>>;
  expect(streamed.content).toEqual(plain.content);
  expect(streamed.stop_reason).toBe("end_turn");
  expect(await usageRows(t)).toEqual([
    { stopReason: "end_turn", partial: undefined, inputTokens: 40, outputTokens: 12 },
    { stopReason: "end_turn", partial: undefined, inputTokens: 40, outputTokens: 12 },
  ]);
});

test("a streamed answer keeps its citations, its thinking text and its signature", async () => {
  const t = convexTest(schema, modules);
  const citation = {
    type: "content_block_location",
    cited_text: "The seal failed at 4.2 bar.",
    document_index: 0,
    document_title: "Interview",
    start_block_index: 0,
    end_block_index: 1,
  };
  const content = [
    { type: "thinking", thinking: "The quote names the pressure.", signature: "sig-synthetic" },
    { type: "text", text: "The seal failed at 4.2 bar.", citations: [citation] },
  ];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => sseResponse(anthropicMessageSse({ ...ANSWER, content }))));
  const answer = await t.action(async (ctx) =>
    instrumentedAnthropic(ctx, { callSite: "stream-contract" }).messages.create(params(32_000))
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect((answer as { content: unknown }).content).toEqual(content);
});

test("a stream that closes before its stop reason is retried, and the usage it reported is logged as interrupted", async () => {
  vi.useRealTimers();
  const t = convexTest(schema, modules);
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
    calls += 1;
    return calls === 1 ? sseBody(cutStream(), init) : sseResponse(anthropicMessageSse(ANSWER));
  }));
  const answer = await t.action(async (ctx) => {
    withTimeLeft(ctx, 300_000);
    return await instrumentedAnthropic(ctx, { callSite: "stream-contract" }).messages.create(params(32_000));
  });
  await flushRealTime(t);

  expect(calls).toBe(2);
  expect((answer as { stop_reason: string }).stop_reason).toBe("end_turn");
  const rows = await usageRows(t);
  expect(rows.map((row) => [row.stopReason, row.partial])).toEqual([
    ["interrupted", true],
    ["end_turn", undefined],
  ]);
});

test("an overloaded error mid-stream is retried; an invalid request error mid-stream is not", async () => {
  vi.useRealTimers();
  const t = convexTest(schema, modules);
  const errorEvent = (type: string) =>
    `${cutStream()}event: error\ndata: ${JSON.stringify({ type: "error", error: { type, message: "Synthetic" } })}\n\n`;
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
    calls += 1;
    return calls === 1 ? sseBody(errorEvent("overloaded_error"), init) : sseResponse(anthropicMessageSse(ANSWER));
  }));
  const recovered = await t.action(async (ctx) => {
    withTimeLeft(ctx, 300_000);
    return await instrumentedAnthropic(ctx, { callSite: "stream-contract" }).messages.create(params(32_000));
  });
  expect(calls).toBe(2);
  expect((recovered as { stop_reason: string }).stop_reason).toBe("end_turn");

  calls = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
    calls += 1;
    return sseBody(errorEvent("invalid_request_error"), init);
  }));
  const refused = await t.action(async (ctx) => {
    withTimeLeft(ctx, 300_000);
    try {
      await instrumentedAnthropic(ctx, { callSite: "stream-contract" }).messages.create(params(32_000));
      return "answered";
    } catch (error) {
      return error instanceof StreamInterruptedError ? "interrupted" : (error as Error).name;
    }
  });
  await t.finishAllScheduledFunctions(() => undefined);
  expect(calls).toBe(1);
  expect(refused).not.toBe("interrupted");
  expect(refused).not.toBe("answered");
});

test("a client's own timeout bounds the whole stream, which fails as a timeout and logs its usage", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => sseBody(cutStream(), init, { hang: true })));
  const result = t.action(async (ctx) => {
    try {
      await instrumentedAnthropic(ctx, {
        callSite: "stream-contract",
        clientOptions: { timeout: 30_000, maxRetries: 0 },
      }).messages.create(params(32_000));
      return "answered";
    } catch (error) {
      return error instanceof StreamTimeLimitError ? "timeout" : String(error);
    }
  });
  await vi.advanceTimersByTimeAsync(29_000);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await result).toBe("timeout");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await usageRows(t)).map((row) => [row.stopReason, row.partial])).toEqual([["timeout", true]]);
});

test("without a timeout of its own, a stream that keeps writing runs to the action's deadline and then fails with ActionTimeBudgetError", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) =>
    sseBody(cutStream(), init, { hang: true, dripEveryMs: 60_000 })));
  const result = t.action(async (ctx) => {
    // More than the 240 s request timeout, which no longer stops a stream.
    withTimeLeft(ctx, 400_000);
    try {
      await instrumentedAnthropic(ctx, { callSite: "stream-contract" }).messages.create(params(32_000));
      return "answered";
    } catch (error) {
      return error instanceof ActionTimeBudgetError ? "out of time" : String(error);
    }
  });
  let done = false;
  void result.then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(101_000);
  expect(await result).toBe("out of time");
});

// Round 2 review (gpt-6-astra, finding 3): citations-mode fact extraction
// passes a signal per request, not per client.
test("a request's own signal stops its stream as its caller's abort, never retried or logged as an interruption", async () => {
  const t = convexTest(schema, modules);
  const fetchMock = vi.fn<typeof fetch>(async (_input, init) => sseBody(cutStream(), init, { hang: true }));
  vi.stubGlobal("fetch", fetchMock);
  const result = t.action(async (ctx) => {
    withTimeLeft(ctx, 300_000);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 5_000);
    try {
      await instrumentedAnthropic(ctx, { callSite: "stream-contract" }).messages.create(params(32_000), {
        signal: stop.signal,
      } as never);
      return "answered";
    } catch (error) {
      return error instanceof RequestAbortedError ? "aborted" : String(error);
    }
  });
  await vi.advanceTimersByTimeAsync(6_000);
  expect(await result).toBe("aborted");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await usageRows(t)).map((row) => [row.stopReason, row.partial])).toEqual([["aborted", true]]);
});

// Round 2 review (gpt-6-astra 4, Claude Opus 5.5 L3): a client's own
// timeout bounds the whole attempt, slow headers included.
test("a client's own timeout counts from when the request was sent, so slow headers leave the stream less time", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    return sseBody(cutStream(), init, { hang: true });
  }));
  const result = t.action(async (ctx) => {
    try {
      await instrumentedAnthropic(ctx, {
        callSite: "stream-contract",
        clientOptions: { timeout: 30_000, maxRetries: 0 },
      }).messages.create(params(32_000));
      return "answered";
    } catch (error) {
      return error instanceof StreamTimeLimitError ? "timeout" : String(error);
    }
  });
  let done = false;
  void result.then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(29_000);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await result).toBe("timeout");
});

// Code review (Claude Opus 5.5, 2026-10-26): a stream that stalls is stopped
// after STREAM_IDLE_LIMIT_MS of silence and retried, as a request that was
// not streamed was after its 240 seconds.
test("a stream that sends nothing for 240 seconds is stopped, logged as stalled, and retried", async () => {
  const t = convexTest(schema, modules);
  expect(STREAM_IDLE_LIMIT_MS).toBe(ANTHROPIC_TIMEOUT_MS);
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
    calls += 1;
    return calls === 1 ? sseBody(cutStream(), init, { hang: true }) : sseResponse(anthropicMessageSse(ANSWER));
  }));
  const result = t.action(async (ctx) => {
    withTimeLeft(ctx, 500_000);
    return await instrumentedAnthropic(ctx, { callSite: "stream-contract" }).messages.create(params(32_000));
  });
  await vi.advanceTimersByTimeAsync(239_000);
  expect(calls).toBe(1);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(((await result) as { stop_reason: string }).stop_reason).toBe("end_turn");
  expect(calls).toBe(2);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await usageRows(t)).map((row) => [row.stopReason, row.partial])).toEqual([
    ["stalled", true],
    ["end_turn", undefined],
  ]);
});
