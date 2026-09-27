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
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { APICallError, streamText } from "ai";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic } from "./instrument";
import type { GenerationClient } from "./openrouterCore";
import { modelFaultCode, normalizeProviderError, withOutcomeRecording } from "./providers";
import {
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_PROVIDER_OPTIONS,
  buildChatTools,
  chatTurnModel,
  reportChatAgent,
} from "./chatAgentV2";
import { resetStaleLatchCheck } from "./anthropicCredit";
import { anthropicToolSse, sseResponse } from "../anthropicSse.fixture";
import {
  ANTHROPIC_CREDIT_NOTICE,
  ANTHROPIC_CREDIT_NOTICE_SOURCE,
  CREDIT_LATCH_COOLDOWN_MS,
  CREDIT_PROBE_CLAIM_MS,
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
  resetStaleLatchCheck();
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
function stubHosts(
  direct: Array<() => Response>,
  openRouter: Array<() => Response>,
  answered: Response[] = []
): Sent[] {
  const sent: Sent[] = [];
  const next = { direct: 0, openRouter: 0 };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => { headers[name] = value; });
    sent.push({ url: request.url, headers, body: JSON.parse(await request.text()) as Record<string, unknown> });
    if (request.url === DIRECT_URL) {
      const answer = direct[Math.min(next.direct, direct.length - 1)]();
      next.direct += 1;
      answered.push(answer);
      return answer;
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
async function call(
  t: TestConvex,
  options: { maxRetries?: number; model?: string; wrapCtx?: (ctx: ActionCtx) => ActionCtx } = {}
) {
  const model = options.model ?? PARAMS.model;
  const result = settle(runAction(t, async (actionCtx) => {
    const ctx = options.wrapCtx ? options.wrapCtx(actionCtx) : actionCtx;
    const client = withOutcomeRecording(ctx, model, "credit-contract",
      instrumentedAnthropic(ctx, {
        callSite: "credit-contract",
        ...(options.maxRetries !== undefined ? { clientOptions: { maxRetries: options.maxRetries } } : {}),
      }) as unknown as GenerationClient);
    const response = await client.messages.create({ ...PARAMS, model } as never);
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

/** A latch as another action left it, with its open notice. */
async function seedLatch(t: TestConvex, latch: { latchedAt: number; probeStartedAt?: number }) {
  await t.run(async (ctx) => {
    const noticeId = await ctx.db.insert("errorReports", {
      kind: "auto",
      reportType: "bug",
      message: ANTHROPIC_CREDIT_NOTICE,
      source: ANTHROPIC_CREDIT_NOTICE_SOURCE,
      url: "/alerts",
      breadcrumbs: [],
      status: "open",
      createdAt: latch.latchedAt,
    });
    await ctx.db.insert("anthropicCreditLatch", { key: "direct", ...latch, noticeId });
  });
}

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

  test("a probe that fails for another reason goes through OpenRouter and restarts the cool-down (lead decision)", async () => {
    const t = convexTest(schema, modules);
    stubHosts([BILLING_402], [OPENROUTER_OK]);
    await call(t);
    const { latchedAt } = (await latch(t))[0];
    const probedAt = latchedAt + CREDIT_LATCH_COOLDOWN_MS;
    vi.setSystemTime(probedAt);
    const sent = stubHosts([anthropicError(429, "rate_limit_error", "Rate limited")], [OPENROUTER_OK]);
    expect(await call(t, { maxRetries: 0 })).toEqual({ ok: true, value: "OpenRouter answer." });
    expect(urls(sent)).toEqual([DIRECT_URL, OPENROUTER_URL]);
    // The failed probe is no model failure; only the answer counts.
    expect((await outcomes(t)).map((row) => row.outcome)).toEqual(["success", "success"]);
    const [row] = await latch(t);
    expect(row.probeStartedAt).toBeUndefined();
    expect(row.latchedAt).toBeGreaterThanOrEqual(probedAt);
    // The next try waits a full cool-down again.
    vi.setSystemTime(probedAt + CREDIT_LATCH_COOLDOWN_MS - 60_000);
    const cooling = stubHosts([DIRECT_OK], [OPENROUTER_OK]);
    await call(t);
    expect(urls(cooling)).toEqual([OPENROUTER_URL]);
    expect(await notices(t)).toHaveLength(1);
  });

  test("a probe whose direct stream breaks goes through OpenRouter as well", async () => {
    const t = convexTest(schema, modules);
    await seedLatch(t, { latchedAt: Date.now() - CREDIT_LATCH_COOLDOWN_MS });
    const sent = stubHosts([() => { throw new TypeError("fetch failed"); }], [OPENROUTER_OK]);
    expect(await call(t, { maxRetries: 0 })).toEqual({ ok: true, value: "OpenRouter answer." });
    expect(urls(sent)).toEqual([DIRECT_URL, OPENROUTER_URL]);
    expect(await latch(t)).toHaveLength(1);
  });

  test("a stale probe claim (its action died) lets the next call probe, and a direct success clears the latch", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedLatch(t, { latchedAt: now - 2 * CREDIT_LATCH_COOLDOWN_MS, probeStartedAt: now - CREDIT_PROBE_CLAIM_MS });
    const sent = stubHosts([DIRECT_OK], [OPENROUTER_OK]);
    expect(await call(t)).toEqual({ ok: true, value: "Direct answer." });
    expect(urls(sent)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
    expect(await notices(t)).toMatchObject([{ status: "resolved" }]);
  });

  test("racing probe claims: exactly one wins", async () => {
    const t = convexTest(schema, modules);
    await seedLatch(t, { latchedAt: Date.now() - CREDIT_LATCH_COOLDOWN_MS });
    const claimProbe = makeFunctionReference<"mutation", Record<string, never>, "direct" | "openrouter" | "probe">(
      "providerCredit:claimProbe"
    );
    const claims = await Promise.all([t.mutation(claimProbe, {}), t.mutation(claimProbe, {}), t.mutation(claimProbe, {})]);
    expect([...claims].sort()).toEqual(["openrouter", "openrouter", "probe"]);
  });

  test("a latch that cannot be read sends the call direct", async () => {
    const t = convexTest(schema, modules);
    await seedLatch(t, { latchedAt: Date.now() });
    const sent = stubHosts([DIRECT_OK], [OPENROUTER_OK]);
    const failingReads = (ctx: ActionCtx): ActionCtx => ({
      ...ctx,
      runQuery: async () => {
        throw new Error("synthetic read failure");
      },
    }) as ActionCtx;
    expect(await call(t, { wrapCtx: failingReads })).toEqual({ ok: true, value: "Direct answer." });
    expect(urls(sent)).toEqual([DIRECT_URL]);
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

  test("an error inside a direct stream that already started does not fall back", async () => {
    const t = convexTest(schema, modules);
    const sse =
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { id: "msg_s", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } },
      })}\n\n` +
      `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "billing_error", message: "There's an issue with your billing or payment information." } })}\n\n`;
    const sent = stubHosts([() => sseResponse(sse)], [OPENROUTER_OK]);
    const result = settle(runAction(t, async (ctx) => {
      const client = instrumentedAnthropic(ctx, { callSite: "credit-contract", clientOptions: { maxRetries: 0 } }) as unknown as GenerationClient;
      const stream = client.messages.createStreaming;
      if (!stream) throw new Error("the instrumented client cannot stream");
      return await stream(PARAMS as never, {});
    }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await result).ok).toBe(false);
    expect(urls(sent)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
  });

  test("a model with no OpenRouter id fails as before and ignores the latch", async () => {
    const t = convexTest(schema, modules);
    const sent = stubHosts([BILLING_402], [OPENROUTER_OK]);
    const outcome = await call(t, { model: "claude-mythos-5-1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(normalizeProviderError(outcome.error).code).toBe("billing");
    expect(urls(sent)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);

    await seedLatch(t, { latchedAt: Date.now() });
    const latched = stubHosts([DIRECT_OK], [OPENROUTER_OK]);
    expect(await call(t, { model: "claude-mythos-5-1" })).toEqual({ ok: true, value: "Direct answer." });
    expect(urls(latched)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toHaveLength(1);
  });

  test("with the OpenRouter key removed while latched, a direct success clears the latch and resolves its notice, looking once per cool-down", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const t = convexTest(schema, modules);
    await seedLatch(t, { latchedAt: Date.now() - 60_000 });
    const sent = stubHosts([DIRECT_OK], [OPENROUTER_OK]);
    expect(await call(t)).toEqual({ ok: true, value: "Direct answer." });
    expect(urls(sent)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
    expect(await notices(t)).toMatchObject([{ status: "resolved" }]);

    // Within the cool-down this isolate does not look again.
    await seedLatch(t, { latchedAt: Date.now() });
    await call(t);
    expect(await latch(t)).toHaveLength(1);
    vi.setSystemTime(Date.now() + CREDIT_LATCH_COOLDOWN_MS);
    await call(t);
    expect(await latch(t)).toEqual([]);
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

function chatSse(text: string, options: { usage?: Record<string, unknown>; provider?: string } = {}): string {
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
        ...(options.provider ? { provider: options.provider } : {}),
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 5, ...options.usage },
    },
    { type: "message_stop" },
  ];
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function chatConvex(): TestConvex {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  return t;
}

/**
 * One chat turn exactly as streamChatReply sends it: the production agent,
 * tools, provider options and output ceiling, the turn's model and usage
 * handler (chatTurnModel). Returns the reply, or the stream's error.
 */
async function chatTurn(t: TestConvex): Promise<{ text: string; errors: unknown[] }> {
  const errors: unknown[] = [];
  const text = await runAction(t, async (ctx) => {
    const { threadId } = await reportChatAgent.createThread(ctx, {});
    const turn = chatTurnModel(ctx, "claude-sonnet-5");
    const result = await reportChatAgent.streamText(
      ctx,
      { threadId },
      {
        model: turn.model,
        system: "You edit SR&ED reports.",
        prompt: "Tighten paragraph 3.",
        tools: buildChatTools(false),
        providerOptions: CHAT_PROVIDER_OPTIONS,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        onError: ({ error }) => {
          errors.push(error);
        },
      },
      { saveStreamDeltas: false, usageHandler: turn.usageHandler }
    );
    await result.consumeStream();
    return errors.length ? "" : await result.text;
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { text, errors };
}

/** A body without the tools' eager_input_streaming, which only direct gets. */
function withoutEagerStreaming(body: Record<string, unknown>): Record<string, unknown> {
  const tools = (body.tools as Array<Record<string, unknown>>).map(({ eager_input_streaming: _eager, ...tool }) => tool);
  return { ...body, tools };
}

describe("the report chat assistant", () => {
  test.each([
    ["402 billing_error", BILLING_402],
    ["400 credit balance is too low", CREDIT_400],
  ])("%s: the turn streams from OpenRouter with the same body minus eager tool streaming", async (_name, refusal) => {
    const t = chatConvex();
    const sent = stubHosts([refusal], [
      () => sseResponse(chatSse("Tightened.", { usage: { cost: 0.0031 }, provider: "Anthropic" })),
    ]);
    expect(await chatTurn(t)).toEqual({ text: "Tightened.", errors: [] });
    expect(urls(sent)).toEqual([DIRECT_URL, OPENROUTER_URL]);
    const [direct, routed] = sent;
    expect(direct.headers["x-api-key"]).toBe(ANTHROPIC_KEY);
    expect(routed.headers["x-api-key"]).toBeUndefined();
    expect(routed.headers.authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(routed.headers["http-referer"]).toBe("https://banhall.app");
    expect(JSON.stringify(routed)).not.toContain(ANTHROPIC_KEY);

    // The AI SDK asks direct for eager tool-input streaming on every tool;
    // the fallback drops it, as the OpenRouter transport never sends it.
    const directTools = direct.body.tools as Array<Record<string, unknown>>;
    expect(directTools.length).toBeGreaterThan(0);
    expect(directTools.every((tool) => tool.eager_input_streaming === true)).toBe(true);
    expect(JSON.stringify(routed.body)).not.toContain("eager_input_streaming");
    // Thinking (display omitted) and the top-level cache_control pass
    // through unchanged, as on the OpenRouter transport.
    expect(direct.body.thinking).toEqual({ type: "adaptive", display: "omitted" });
    expect(direct.body.cache_control).toEqual({ type: "ephemeral" });
    expect(routed.body).toEqual({
      ...withoutEagerStreaming(direct.body),
      model: "anthropic/claude-sonnet-5",
      provider: { only: ["anthropic"], allow_fallbacks: false },
    });

    expect(await usageRows(t)).toMatchObject([
      {
        callSite: "chat_v2",
        model: "claude-sonnet-5",
        transport: "openrouter",
        servedProvider: "Anthropic",
        costUsd: 0.0031,
        costSource: "native",
      },
    ]);
    expect(await notices(t)).toHaveLength(1);

    // The next turn skips direct.
    const next = stubHosts([() => sseResponse(chatSse("Wrong."))], [() => sseResponse(chatSse("Again."))]);
    expect((await chatTurn(t)).text).toBe("Again.");
    expect(urls(next)).toEqual([OPENROUTER_URL]);
  });

  test("the refused direct answer's body is released before the fallback", async () => {
    const t = chatConvex();
    const answered: Response[] = [];
    stubHosts([BILLING_402], [() => sseResponse(chatSse("Tightened."))], answered);
    expect((await chatTurn(t)).text).toBe("Tightened.");
    expect(answered).toHaveLength(1);
    expect(answered[0].bodyUsed).toBe(true);
  });

  test("an OpenRouter failure names OpenRouter, not api.anthropic.com", async () => {
    const t = chatConvex();
    stubHosts([BILLING_402], [anthropicError(402, "billing_error", "Insufficient credits")]);
    const { errors } = await chatTurn(t);
    expect(errors).toHaveLength(1);
    const error = errors[0];
    expect(APICallError.isInstance(error)).toBe(true);
    if (APICallError.isInstance(error)) {
      expect(error.url).toBe(OPENROUTER_URL);
      expect(error.statusCode).toBe(402);
      expect(error.message).toContain("OpenRouter");
      expect(error.requestBodyValues).toEqual({});
    }
  });

  test("a probe turn goes direct and clears the latch; a failed probe turn goes through OpenRouter", async () => {
    const t = chatConvex();
    await seedLatch(t, { latchedAt: Date.now() - CREDIT_LATCH_COOLDOWN_MS });
    const probe = stubHosts([() => sseResponse(chatSse("Direct."))], [() => sseResponse(chatSse("Wrong."))]);
    expect((await chatTurn(t)).text).toBe("Direct.");
    expect(urls(probe)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
    expect((await usageRows(t))[0].transport).toBeUndefined();

    await seedLatch(t, { latchedAt: Date.now() - CREDIT_LATCH_COOLDOWN_MS });
    const failed = stubHosts(
      [anthropicError(529, "overloaded_error", "Overloaded")],
      [() => sseResponse(chatSse("Rerouted."))]
    );
    expect((await chatTurn(t)).text).toBe("Rerouted.");
    expect(urls(failed)).toEqual([DIRECT_URL, OPENROUTER_URL]);
    const [row] = await latch(t);
    expect(row.latchedAt).toBe(Date.now());
    expect(row.probeStartedAt).toBeUndefined();
  });

  test("a direct turn records no transport; a rate limit does not fall back", async () => {
    const t = chatConvex();
    const sent = stubHosts([() => sseResponse(chatSse("Direct."))], [() => sseResponse(chatSse("Wrong."))]);
    expect((await chatTurn(t)).text).toBe("Direct.");
    expect(urls(sent)).toEqual([DIRECT_URL]);
    const [row] = await usageRows(t);
    expect(row.transport).toBeUndefined();
    expect(row.servedProvider).toBeUndefined();
    expect(row.costSource).toBe("estimated");

    const limited = stubHosts([anthropicError(429, "rate_limit_error", "Rate limited")], [() => sseResponse(chatSse("Wrong."))]);
    const { errors } = await chatTurn(t);
    expect(errors).toHaveLength(1);
    expect(urls(limited)).toEqual([DIRECT_URL]);
    expect(await latch(t)).toEqual([]);
  });

  test("a chat model with no OpenRouter id keeps the plain provider", async () => {
    const t = chatConvex();
    await runAction(t, async (ctx) => {
      const turn = chatTurnModel(ctx, "claude-mythos-5-1");
      const sent = stubHosts([BILLING_402], [() => sseResponse(chatSse("Wrong."))]);
      const result = streamText({ model: turn.model, maxRetries: 0, prompt: "Hi.", onError: () => {} });
      await result.consumeStream();
      expect(urls(sent)).toEqual([DIRECT_URL]);
    });
    expect(await latch(t)).toEqual([]);
  });
});
