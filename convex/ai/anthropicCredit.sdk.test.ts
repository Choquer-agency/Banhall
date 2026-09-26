/// <reference types="vite/client" />

/**
 * The direct Anthropic credit fallback at the real request/response boundary
 * (owner decision 64, 2026-09-26). Only `fetch` is stubbed: the Anthropic
 * SDK, the AI SDK's Anthropic provider, the instrumented client, outcome
 * and usage recording, the latch mutations and the Convex scheduler are the
 * production ones.
 *
 * Direct stays the default. A direct answer that says the account is out of
 * credit (402 billing_error, or the older 400 "credit balance is too low")
 * is sent again through the Anthropic-pinned OpenRouter transport inside the
 * same call; the latch then sends later calls straight to OpenRouter until
 * one direct try after the cool-down works.
 */
import { convexTest } from "convex-test";
import { streamText } from "ai";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic } from "./instrument";
import type { GenerationClient } from "./openrouterCore";
import { modelFaultCode, normalizeProviderError, withOutcomeRecording } from "./providers";
import { chatTurnModel } from "./chatAgentV2";
import { anthropicToolSse, sseResponse } from "../anthropicSse.fixture";
import {
  ANTHROPIC_CREDIT_NOTICE,
  ANTHROPIC_CREDIT_NOTICE_SOURCE,
  CREDIT_LATCH_COOLDOWN_MS,
} from "../../shared/anthropicCreditFallback";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

const ANTHROPIC_KEY = "synthetic-direct-anthropic-key";
const OPENROUTER_KEY = "synthetic-openrouter-key";
const DIRECT_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/messages";

// Latch reads and outcome writes race the fake clock; load their modules
// first so a cold import cannot lose that race.
beforeAll(async () => {
  await import("../modelCatalog");
  await import("../providerCredit");
  await import("../aiUsage");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-09-26T12:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", ANTHROPIC_KEY);
  vi.stubEnv("OPENROUTER_API_KEY", OPENROUTER_KEY);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Answers ────────────────────────────────────────────────────────────────

const anthropicError = (status: number, type: string, message: string, extra: Record<string, unknown> = {}) =>
  () => Response.json({ type: "error", error: { type, message, ...extra }, request_id: "req_synthetic" }, { status });

/** https://platform.claude.com/docs/en/api/errors: 402 billing_error. */
const BILLING_402 = anthropicError(402, "billing_error", "There's an issue with your billing or payment information.");
/** The older empty-balance answer. */
const CREDIT_400 = anthropicError(
  400,
  "invalid_request_error",
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
);

function reply(text: string, extra: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return () =>
    Response.json({
      id: "msg_synthetic",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 40, output_tokens: 8, ...usage },
      ...extra,
    });
}
const DIRECT_OK = reply("Direct answer.");
const OPENROUTER_OK = reply("OpenRouter answer.", { provider: "Anthropic" }, { cost: 0.0042, is_byok: false });

const PARAMS = {
  model: "claude-sonnet-5",
  max_tokens: 1024,
  thinking: { type: "disabled" },
  system: "You draft Line 242.",
  messages: [{ role: "user", content: "Draft Line 242 now." }],
};

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/**
 * Stubs `fetch`: each request is answered by the next reply for its host
 * (direct or OpenRouter), the last one repeating.
 */
function stubHosts(direct: Array<() => Response>, openRouter: Array<() => Response>): Sent[] {
  const sent: Sent[] = [];
  const next = { direct: 0, openRouter: 0 };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => { headers[name] = value; });
    sent.push({ url: request.url, headers, body: JSON.parse(await request.text()) as Record<string, unknown> });
    if (request.url === DIRECT_URL) {
      const answer = direct[Math.min(next.direct, direct.length - 1)];
      next.direct += 1;
      return answer();
    }
    if (request.url === OPENROUTER_URL) {
      const answer = openRouter[Math.min(next.openRouter, openRouter.length - 1)];
      next.openRouter += 1;
      return answer();
    }
    throw new Error(`Unexpected URL ${request.url}`);
  }));
  return sent;
}

async function settle<R>(promise: Promise<R>): Promise<{ ok: true; value: R } | { ok: false; error: unknown }> {
  return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

/** One section-draft call through the production outcome recording. */
async function call(t: TestConvex, options: { maxRetries?: number } = {}) {
  const result = settle(runAction(t, async (ctx) => {
    const client = withOutcomeRecording(ctx, "claude-sonnet-5", "credit-contract",
      instrumentedAnthropic(ctx, {
        callSite: "credit-contract",
        ...(options.maxRetries !== undefined ? { clientOptions: { maxRetries: options.maxRetries } } : {}),
      }) as unknown as GenerationClient);
    const response = await client.messages.create(PARAMS as never);
    return response.content.map((block) => ("text" in block ? block.text : "")).join("");
  }));
  await vi.advanceTimersByTimeAsync(30_000);
  const outcome = await result;
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return outcome;
}

const latch = (t: TestConvex) => t.run((ctx) => ctx.db.query("anthropicCreditLatch").collect());
const notices = (t: TestConvex) =>
  t.run(async (ctx) =>
    (await ctx.db.query("errorReports").collect()).filter((row) => row.source === ANTHROPIC_CREDIT_NOTICE_SOURCE)
  );
const outcomes = (t: TestConvex) => t.run((ctx) => ctx.db.query("modelCallOutcomes").collect());
const usageRows = (t: TestConvex) => t.run((ctx) => ctx.db.query("aiUsage").collect());
const urls = (sent: Sent[]) => sent.map((request) => request.url);

// ─── Fallback inside the same call ──────────────────────────────────────────

describe("a direct credit refusal falls back to OpenRouter in the same call", () => {
  test.each([
    ["402 billing_error", BILLING_402],
    ["400 credit balance is too low", CREDIT_400],
  ])("%s: the caller sees the OpenRouter answer, with no model failure and the real route on the usage row", async (_name, refusal) => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([refusal], [OPENROUTER_OK]);

    const outcome = await call(t);

    expect(outcome).toEqual({ ok: true, value: "OpenRouter answer." });
    expect(urls(sent)).toEqual([DIRECT_URL, OPENROUTER_URL]);
    // The same request, sent as the openrouter transport sends it.
    const [direct, routed] = sent;
    expect(direct.headers["x-api-key"]).toBe(ANTHROPIC_KEY);
    expect(routed.headers.authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(routed.headers["x-api-key"]).toBeUndefined();
    expect(JSON.stringify(routed)).not.toContain(ANTHROPIC_KEY);
    expect(routed.body.provider).toEqual({ only: ["anthropic"], allow_fallbacks: false });
    expect(routed.body.model).toBe("anthropic/claude-sonnet-5");
    expect({ ...routed.body, model: direct.body.model, provider: undefined }).toEqual({ ...direct.body, provider: undefined });

    // One success for the model; the refusal is not a failure.
    expect(await outcomes(t)).toMatchObject([{ model: "claude-sonnet-5", outcome: "success" }]);
    const rows = await usageRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      model: "claude-sonnet-5",
      transport: "openrouter",
      servedProvider: "Anthropic",
      costUsd: 0.0042,
      costSource: "native",
    });

    expect(await latch(t)).toMatchObject([{ key: "direct" }]);
    expect(await notices(t)).toMatchObject([
      { message: ANTHROPIC_CREDIT_NOTICE, status: "open", kind: "auto", url: "/alerts" },
    ]);
  });

  test("a failed fallback fails the call with OpenRouter's error, and the latch still stands", async () => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([BILLING_402], [anthropicError(402, "billing_error", "Insufficient credits")]);
    const outcome = await call(t);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(normalizeProviderError(outcome.error).code).toBe("billing");
      expect(modelFaultCode(outcome.error)).toBeNull();
    }
    expect(urls(sent)).toEqual([DIRECT_URL, OPENROUTER_URL]);
    expect(await outcomes(t)).toEqual([]);
    expect(await latch(t)).toHaveLength(1);
  });
});

// ─── The latch ──────────────────────────────────────────────────────────────

describe("the latch", () => {
  test("later calls skip direct, and the notice is raised once", async () => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([BILLING_402], [OPENROUTER_OK]);
    await call(t);
    await call(t);
    await call(t);
    expect(urls(sent)).toEqual([DIRECT_URL, OPENROUTER_URL, OPENROUTER_URL, OPENROUTER_URL]);
    expect(await notices(t)).toHaveLength(1);
    expect((await usageRows(t)).map((row) => row.transport)).toEqual(["openrouter", "openrouter", "openrouter"]);
  });

  test("after the cool-down one call tries direct; a direct success clears the latch and resolves the notice", async () => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([BILLING_402, DIRECT_OK], [OPENROUTER_OK]);
    await call(t);
    const { latchedAt } = (await latch(t))[0];
    vi.setSystemTime(latchedAt + CREDIT_LATCH_COOLDOWN_MS - 60_000);
    await call(t);
    expect(urls(sent).slice(2)).toEqual([OPENROUTER_URL]);

    vi.setSystemTime(latchedAt + CREDIT_LATCH_COOLDOWN_MS);
    expect(await call(t)).toEqual({ ok: true, value: "Direct answer." });
    expect(urls(sent).slice(3)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
    expect(await notices(t)).toMatchObject([{ status: "resolved" }]);

    // Direct again from now on.
    await call(t);
    expect(urls(sent).slice(4)).toEqual([DIRECT_URL]);
    const rows = await usageRows(t);
    expect(rows.map((row) => row.transport)).toEqual(["openrouter", "openrouter", undefined, undefined]);
  });

  test("a probe still refused for credit falls back, restarts the cool-down and raises no second notice", async () => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([BILLING_402], [OPENROUTER_OK]);
    await call(t);
    const { latchedAt } = (await latch(t))[0];
    vi.setSystemTime(latchedAt + CREDIT_LATCH_COOLDOWN_MS);
    expect(await call(t)).toEqual({ ok: true, value: "OpenRouter answer." });
    expect(urls(sent).slice(2)).toEqual([DIRECT_URL, OPENROUTER_URL]);
    const [relatched] = await latch(t);
    expect(relatched.latchedAt).toBeGreaterThanOrEqual(latchedAt + CREDIT_LATCH_COOLDOWN_MS);
    expect(relatched.probeStartedAt).toBeUndefined();
    // Cooling down again: straight to OpenRouter.
    await call(t);
    expect(urls(sent).slice(4)).toEqual([OPENROUTER_URL]);
    expect(await notices(t)).toHaveLength(1);
  });

  test("only one call probes: while a probe is claimed, others go to OpenRouter", async () => {
    const t = convexTest(schema, modules);
    stubHosts([BILLING_402], [OPENROUTER_OK]);
    await call(t);
    const { latchedAt } = (await latch(t))[0];
    vi.setSystemTime(latchedAt + CREDIT_LATCH_COOLDOWN_MS);
    // Another action holds the probe.
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("anthropicCreditLatch").collect();
      await ctx.db.patch("anthropicCreditLatch", row._id, { probeStartedAt: Date.now() });
    });
    const sent = stubHosts([DIRECT_OK], [OPENROUTER_OK]);
    await call(t);
    expect(urls(sent)).toEqual([OPENROUTER_URL]);
  });

  test("a probe that fails for another reason does not fall back and frees the probe; the latch stays", async () => {
    const t = convexTest(schema, modules);
    stubHosts([BILLING_402], [OPENROUTER_OK]);
    await call(t);
    const { latchedAt } = (await latch(t))[0];
    vi.setSystemTime(latchedAt + CREDIT_LATCH_COOLDOWN_MS);
    const sent = stubHosts([anthropicError(429, "rate_limit_error", "Rate limited")], [OPENROUTER_OK]);
    const outcome = await call(t, { maxRetries: 0 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(normalizeProviderError(outcome.error).code).toBe("rate_limited");
    expect(urls(sent)).toEqual([DIRECT_URL]);
    const [row] = await latch(t);
    expect(row.probeStartedAt).toBeUndefined();
    // The next call probes again.
    const next = stubHosts([DIRECT_OK], [OPENROUTER_OK]);
    await call(t);
    expect(urls(next)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
  });
});

// ─── What never falls back ─────────────────────────────────────────────────

describe("other refusals never fall back", () => {
  test.each([
    ["429 rate limit", anthropicError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit")],
    [
      "429 tier spend cap",
      anthropicError(429, "rate_limit_error", "You have reached your API usage limits: your organization has crossed its monthly API usage threshold.", {
        details: { error_code: "enforced_spend_limit_reached" },
      }),
    ],
    ["529 overloaded", anthropicError(529, "overloaded_error", "Overloaded")],
    ["401 authentication", anthropicError(401, "authentication_error", "invalid x-api-key")],
    ["403 permission", anthropicError(403, "permission_error", "Your API key does not have permission to use the specified resource.")],
    ["400 ordinary", anthropicError(400, "invalid_request_error", "messages: field required")],
    [
      "400 own spend limit",
      anthropicError(400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC."),
    ],
  ])("%s: fails as before, direct only, no latch and no notice", async (_name, refusal) => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([refusal], [OPENROUTER_OK]);
    const outcome = await call(t, { maxRetries: 0 });
    expect(outcome.ok).toBe(false);
    expect(urls(sent)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
    expect(await notices(t)).toEqual([]);
  });

  test("without an OpenRouter key a credit refusal fails as it always did", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const t = convexTest(schema, modules);
    const sent = stubHosts([BILLING_402], [OPENROUTER_OK]);
    const outcome = await call(t);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(normalizeProviderError(outcome.error).code).toBe("billing");
      expect(modelFaultCode(outcome.error)).toBeNull();
    }
    expect(urls(sent)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
    expect(await notices(t)).toEqual([]);
  });

  test("ANTHROPIC_TRANSPORT=openrouter still sends everything to OpenRouter, never direct", async () => {
    vi.stubEnv("ANTHROPIC_TRANSPORT", "openrouter");
    const t = convexTest(schema, modules);
    const sent = stubHosts([DIRECT_OK], [anthropicError(402, "billing_error", "Insufficient credits")]);
    const outcome = await call(t);
    expect(outcome.ok).toBe(false);
    expect(urls(sent)).toEqual([OPENROUTER_URL]);
    expect(await latch(t)).toEqual([]);
  });
});

// ─── Streaming (the Brief) ──────────────────────────────────────────────────

test("a streamed call (the Brief) falls back to an OpenRouter stream and still reports tool input as it arrives", async () => {
  const t = convexTest(schema, modules);
  const input = { facts: ["The seal failed at 4.2 bar.", "Run TR-17 settled in 120 ms."] };
  const sse = anthropicToolSse({ model: "claude-sonnet-5", tool: "submit_brief", input, chunk: 12 });
  const sent = stubHosts([BILLING_402], [() => sseResponse(sse)]);
  const snapshots: string[] = [];
  const params = {
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: "Read the interview.",
    tools: [{ name: "submit_brief", description: "Return the brief.", input_schema: { type: "object" } }],
    tool_choice: { type: "tool", name: "submit_brief" },
    messages: [{ role: "user", content: "Sources." }],
  };
  const result = settle(runAction(t, async (ctx) => {
    const client = instrumentedAnthropic(ctx, { callSite: "credit-contract" }) as unknown as GenerationClient;
    const stream = client.messages.createStreaming;
    if (!stream) throw new Error("the instrumented client cannot stream");
    return await stream(params as never, { onToolInput: (snapshot) => snapshots.push(snapshot) });
  }));
  await vi.advanceTimersByTimeAsync(30_000);
  const outcome = await result;
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(outcome.ok).toBe(true);
  if (outcome.ok) expect(outcome.value.content).toMatchObject([{ type: "tool_use", name: "submit_brief", input }]);
  expect(urls(sent)).toEqual([DIRECT_URL, OPENROUTER_URL]);
  // Direct asks for eager tool-input streaming; the OpenRouter stream does
  // not (instrument.ts streamedBody), so facts may arrive in larger pieces.
  expect(sent[0].body.stream).toBe(true);
  expect((sent[0].body.tools as Array<Record<string, unknown>>)[0].eager_input_streaming).toBe(true);
  expect(sent[1].body.stream).toBe(true);
  expect((sent[1].body.tools as Array<Record<string, unknown>>)[0]).not.toHaveProperty("eager_input_streaming");
  expect(snapshots.length).toBeGreaterThan(1);
  expect(JSON.parse(snapshots[snapshots.length - 1])).toEqual(input);
  expect(await usageRows(t)).toMatchObject([{ transport: "openrouter", callSite: "credit-contract" }]);
});

// ─── Chat (AI SDK) ──────────────────────────────────────────────────────────

function chatSse(text: string, usage: Record<string, unknown> = {}): string {
  const events: Array<{ type: string } & Record<string, unknown>> = [
    {
      type: "message_start",
      message: {
        id: "msg_chat",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 30, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5, ...usage } },
    { type: "message_stop" },
  ];
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

async function chatTurn(t: TestConvex): Promise<string> {
  const text = await runAction(t, async (ctx) => {
    const { model, usageHandler } = chatTurnModel(ctx, "claude-sonnet-5");
    const result = streamText({ model, messages: [{ role: "user", content: "Tighten paragraph 3." }] });
    const answer = await result.text;
    await usageHandler(ctx, {
      threadId: "thread-credit",
      userId: undefined,
      agentName: "report-editor",
      model: "claude-sonnet-5",
      provider: "anthropic.messages",
      usage: await result.usage,
      providerMetadata: await result.providerMetadata,
    });
    return answer;
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return text;
}

describe("the report chat assistant", () => {
  test("a direct credit refusal streams the turn from OpenRouter and records its transport and charge", async () => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([BILLING_402], [() => sseResponse(chatSse("Tightened.", { cost: 0.0031 }))]);
    expect(await chatTurn(t)).toBe("Tightened.");
    expect(urls(sent)).toEqual([DIRECT_URL, OPENROUTER_URL]);
    const [direct, routed] = sent;
    expect(direct.headers["x-api-key"]).toBe(ANTHROPIC_KEY);
    expect(routed.headers["x-api-key"]).toBeUndefined();
    expect(routed.headers.authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(routed.headers["http-referer"]).toBe("https://banhall.app");
    expect(JSON.stringify(routed)).not.toContain(ANTHROPIC_KEY);
    expect(routed.body.model).toBe("anthropic/claude-sonnet-5");
    expect(routed.body.provider).toEqual({ only: ["anthropic"], allow_fallbacks: false });
    expect({ ...routed.body, model: direct.body.model, provider: undefined }).toEqual({ ...direct.body, provider: undefined });
    expect(await usageRows(t)).toMatchObject([
      { callSite: "chat_v2", model: "claude-sonnet-5", transport: "openrouter", costUsd: 0.0031, costSource: "native" },
    ]);
    expect(await notices(t)).toHaveLength(1);

    // The next turn skips direct.
    const next = stubHosts([DIRECT_OK], [() => sseResponse(chatSse("Again."))]);
    expect(await chatTurn(t)).toBe("Again.");
    expect(urls(next)).toEqual([OPENROUTER_URL]);
  });

  test("a direct turn records no transport; a rate limit does not fall back", async () => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([() => sseResponse(chatSse("Direct."))], [() => sseResponse(chatSse("Wrong."))]);
    expect(await chatTurn(t)).toBe("Direct.");
    expect(urls(sent)).toEqual([DIRECT_URL]);
    const [row] = await usageRows(t);
    expect(row.transport).toBeUndefined();
    expect(row.costSource).toBe("estimated");

    const limited = stubHosts([anthropicError(429, "rate_limit_error", "Rate limited")], [() => sseResponse(chatSse("Wrong."))]);
    const errors: unknown[] = [];
    await runAction(t, async (ctx) => {
      const { model } = chatTurnModel(ctx, "claude-sonnet-5");
      const result = streamText({
        model,
        maxRetries: 0,
        messages: [{ role: "user", content: "Hi." }],
        onError: ({ error }) => { errors.push(error); },
      });
      await result.consumeStream();
    });
    expect(errors).toHaveLength(1);
    expect(urls(limited)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
  });
});
