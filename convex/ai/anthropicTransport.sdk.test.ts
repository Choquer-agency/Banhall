/// <reference types="vite/client" />

/**
 * The Anthropic transport at the real SDK boundary (owner decision 30,
 * 2026-09-25). Only `fetch` is stubbed: the Anthropic SDK, the
 * instrumented client, usage and outcome recording and the Convex
 * scheduler are the production ones.
 *
 * Direct (the default): every request's URL, headers and body bytes are
 * pinned by hash. The hashes were captured on the code before the
 * transport switch existed, so an unchanged hash proves the direct path
 * sends exactly what it sent before.
 *
 * OpenRouter (ANTHROPIC_TRANSPORT=openrouter): the same request goes to
 * https://openrouter.ai/api/v1/messages with the OpenRouter key as a bearer
 * token, and the body differs from the direct body only in the model id
 * and the Anthropic-only provider pin. Usage rows record OpenRouter's exact
 * charge, the transport and the provider that served the call. Retries, the
 * action deadline and outcome recording behave as on direct, and
 * OpenRouter's routing answers are not counted against the model.
 */
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic, type UsageTap } from "./instrument";
import {
  ACTION_REQUEST_WINDOW_MS,
  ActionTimeBudgetError,
  startActionDeadline,
} from "./actionDeadline";
import type { GenerationClient } from "./openrouterCore";
import { clientForModel, modelFaultCode, normalizeProviderError, withOutcomeRecording } from "./providers";
import { OPENROUTER_ANTHROPIC_REQUEST_IDS } from "../../shared/anthropicTransport";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

const ANTHROPIC_KEY = "synthetic-direct-anthropic-key";
const OPENROUTER_KEY = "synthetic-openrouter-key";
const OPENROUTER_MESSAGES_URL = "https://openrouter.ai/api/v1/messages";

// Outcome writes race a 2 s timer on the fake clock; load their module
// first so a cold import cannot lose that race.
beforeAll(async () => {
  await import("../modelCatalog");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-09-25T12:00:00Z"));
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

// ─── The requests every transport test sends ────────────────────────────────

/** A section draft: Sonnet 5, thinking off, the instrument's 5m prefix. */
const SECTION_DRAFT = {
  callSite: "generation:section:242",
  attributed: true,
  params: {
    model: "claude-sonnet-5",
    max_tokens: 8192,
    thinking: { type: "disabled" },
    system: "You draft Line 242 of a CRA T661 project description.",
    messages: [
      { role: "user", content: "Analysis: the seal failed at 4.2 bar in the third trial." },
      { role: "assistant", content: "Understood." },
      { role: "user", content: "Draft Line 242 now." },
    ],
  },
} as const;

/** A seed batch: an explicit 1-hour breakpoint on the shared source block. */
const SEED_BATCH = {
  callSite: "generation:seeds:technological_objective",
  attributed: true,
  params: {
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: "You propose seeds for one role.",
    tools: [{
      name: "submit_seeds",
      description: "Return the seeds.",
      input_schema: { type: "object", properties: { seeds: { type: "array", items: { type: "string" } } }, required: ["seeds"] },
    }],
    tool_choice: { type: "tool", name: "submit_seeds" },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Sources: the team measured seal fatigue at 400 kPa.", cache_control: { type: "ephemeral", ttl: "1h" } },
        { type: "text", text: "Propose the seeds for this role." },
      ],
    }],
  },
} as const;

/** Opus 5.5 structured: forced tool and thinking off become the unforced path. */
const OPUS_STRUCTURED = {
  callSite: "generation:qa",
  attributed: false,
  params: {
    model: "claude-opus-5-5",
    max_tokens: 4096,
    thinking: { type: "disabled" },
    system: "Judge the draft.",
    tools: [{
      name: "submit_judgement",
      description: "Return the judgement.",
      input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    }],
    tool_choice: { type: "tool", name: "submit_judgement" },
    messages: [{ role: "user", content: "The seal failed at 4.2 bar." }],
  },
} as const;

/** A citations-mode fact window: a `document` block with content source. */
const CITATIONS_WINDOW = {
  callSite: "facts",
  attributed: false,
  params: {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: "List the facts the transcript states.",
    messages: [{
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "content", content: [{ type: "text", text: "Speaker 1: The seal failed at 4.2 bar." }] },
          title: "Interview",
          citations: { enabled: true },
        },
        { type: "text", text: "List the facts." },
      ],
    }],
  },
} as const;

/**
 * The same QA request inside an action under its deadline, late enough
 * (100 s left) that the attempt's timeout is cut below the 240 s default,
 * so the pinned bytes show the deadline path ran (`x-stainless-timeout`).
 */
const QA_UNDER_DEADLINE = { ...OPUS_STRUCTURED, deadline: true } as const;
const DEADLINE_LEFT_MS = 100_000;

const REQUESTS = { SECTION_DRAFT, SEED_BATCH, OPUS_STRUCTURED, CITATIONS_WINDOW, QA_UNDER_DEADLINE } as const;
type RequestName = keyof typeof REQUESTS;

// ─── Wire capture ───────────────────────────────────────────────────────────

/** Headers that depend on the machine running the test, not on our code. */
const PLATFORM_HEADERS = new Set([
  "x-stainless-arch",
  "x-stainless-os",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "user-agent",
]);

type Wire = { url: string; method: string; headers: Record<string, string>; body: string };

async function wireOf(input: RequestInfo | URL, init: RequestInit | undefined): Promise<Wire> {
  const request = new Request(input, init);
  const pairs: Array<[string, string]> = [];
  request.headers.forEach((value, name) => {
    if (!PLATFORM_HEADERS.has(name)) pairs.push([name, value]);
  });
  const headers = Object.fromEntries(pairs.sort(([a], [b]) => a.localeCompare(b)));
  return { url: request.url, method: request.method, headers, body: await request.text() };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function anthropicReply(extra: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return Response.json({
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: "Done." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 40, output_tokens: 8, ...usage },
    ...extra,
  });
}

/** Sends one named request through the production instrumented client. */
async function send(t: TestConvex, name: RequestName): Promise<Wire> {
  const wires: Wire[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    wires.push(await wireOf(input, init));
    return anthropicReply();
  }));
  const request: { callSite: string; attributed: boolean; params: unknown; deadline?: boolean } = REQUESTS[name];
  await runAction(t, async (ctx) => {
    if (request.deadline) startActionDeadline(ctx, Date.now() - (ACTION_REQUEST_WINDOW_MS - DEADLINE_LEFT_MS));
    const client = instrumentedAnthropic(ctx, {
      callSite: request.callSite,
      ...(request.attributed ? { attribution: { generationId: "generation-wire" as never } } : {}),
    });
    await client.messages.create(request.params as never);
  });
  expect(wires).toHaveLength(1);
  return wires[0];
}

/**
 * sha256 of `JSON.stringify(wire)` for each request on the direct path,
 * captured at b8e97f0a, before the transport switch existed. The hash
 * covers every header but the platform ones, including
 * `x-stainless-package-version`, so an @anthropic-ai/sdk upgrade changes
 * every hash: recapture them all on the commit before the upgrade (with
 * the upgraded SDK) and check that nothing but that header moved.
 */
const DIRECT_WIRE_HASHES: Record<RequestName, string> = {
  SECTION_DRAFT: "d29f8da09347b348bc2b4e8fbc21860890aae8312e3ff46ee3a1fcb256cac77b",
  SEED_BATCH: "b9b8701e6576a5a90dcaea83abad2f5a7175864c287ad62c59ef7536a0064a9c",
  OPUS_STRUCTURED: "5589bb048cf2343f1f80c515a3b45fde7b63bc836a8f10994f732b0c89d3bdb3",
  CITATIONS_WINDOW: "d3199ca251ac3802d2b97e53007f879243e82a36a8159ae77df534b112746e15",
  QA_UNDER_DEADLINE: "b3f8e2c05f9a7b890d68be27d02ee70e7c2ec845bfcab5d08bc3a066e571ec1b",
};

test.each(Object.keys(REQUESTS) as RequestName[])(
  "direct by default: %s is byte-identical to the request before the transport switch",
  async (name) => {
    const t = convexTest(schema, modules);
    const wire = await send(t, name);
    expect(wire.url).toBe("https://api.anthropic.com/v1/messages");
    expect(wire.headers["x-api-key"]).toBe(ANTHROPIC_KEY);
    expect(wire.headers.authorization).toBeUndefined();
    expect(JSON.parse(wire.body)).not.toHaveProperty("provider");
    // The deadline case's attempt timeout was cut to the time left.
    expect(wire.headers["x-stainless-timeout"]).toBe(name === "QA_UNDER_DEADLINE" ? String(DEADLINE_LEFT_MS / 1000) : "240");
    expect({ name, hash: await sha256(JSON.stringify(wire)) }).toEqual({ name, hash: DIRECT_WIRE_HASHES[name] });
  }
);

test("the deadline case's pinned bytes differ from the same request without a deadline", () => {
  expect(DIRECT_WIRE_HASHES.QA_UNDER_DEADLINE).not.toBe(DIRECT_WIRE_HASHES.OPUS_STRUCTURED);
});

test("direct when set explicitly: every request keeps its pinned bytes", async () => {
  vi.stubEnv("ANTHROPIC_TRANSPORT", "direct");
  const t = convexTest(schema, modules);
  for (const name of Object.keys(REQUESTS) as RequestName[]) {
    const wire = await send(t, name);
    expect({ name, hash: await sha256(JSON.stringify(wire)) }).toEqual({ name, hash: DIRECT_WIRE_HASHES[name] });
  }
});

// ─── OpenRouter transport ───────────────────────────────────────────────────

function useOpenRouter(): void {
  vi.stubEnv("ANTHROPIC_TRANSPORT", "openrouter");
}

/** Headers that differ by transport on purpose: the credential and app attribution. */
const AUTH_HEADERS = new Set(["authorization", "x-api-key", "http-referer", "x-title", "content-length"]);
function withoutAuth(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !AUTH_HEADERS.has(name)));
}

test.each(Object.keys(REQUESTS) as RequestName[])(
  "openrouter: %s is the direct request with only the model id and the provider pin changed",
  async (name) => {
    const t = convexTest(schema, modules);
    const direct = await send(t, name);
    useOpenRouter();
    const routed = await send(t, name);

    expect(routed.url).toBe(OPENROUTER_MESSAGES_URL);
    expect(routed.method).toBe("POST");
    expect(routed.headers.authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    // The SDK would otherwise read ANTHROPIC_API_KEY from the environment.
    expect(routed.headers["x-api-key"]).toBeUndefined();
    expect(JSON.stringify(routed)).not.toContain(ANTHROPIC_KEY);
    expect(routed.headers["http-referer"]).toBe("https://banhall.app");
    expect(routed.headers["x-title"]).toBe("Banhall");
    expect(withoutAuth(routed.headers)).toEqual(withoutAuth(direct.headers));

    const body = JSON.parse(routed.body) as Record<string, unknown>;
    const directBody = JSON.parse(direct.body) as Record<string, unknown>;
    expect(body.model).toBe(OPENROUTER_ANTHROPIC_REQUEST_IDS[directBody.model as string]);
    expect(body.provider).toEqual({ only: ["anthropic"], allow_fallbacks: false });
    expect(Object.keys(body).at(-1)).toBe("provider");
    delete body.provider;
    body.model = directBody.model;
    // Byte for byte, the rest is the direct body.
    expect(JSON.stringify(body)).toBe(direct.body);
  }
);

test("openrouter keeps every Phase 1 cost feature in the body", async () => {
  useOpenRouter();
  const t = convexTest(schema, modules);
  const section = JSON.parse((await send(t, "SECTION_DRAFT")).body);
  expect(section.model).toBe("anthropic/claude-sonnet-5");
  expect(section.thinking).toEqual({ type: "disabled" });
  expect(section.system[0].cache_control).toEqual({ type: "ephemeral" });
  expect(section.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });

  const seed = JSON.parse((await send(t, "SEED_BATCH")).body);
  expect(seed.messages[0].content[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  expect(seed.tool_choice).toEqual({ type: "tool", name: "submit_seeds" });

  // Opus 5.5 takes the unforced path: no thinking field, effort low, auto
  // tool choice without parallel calls, and the one system line.
  const opus = JSON.parse((await send(t, "OPUS_STRUCTURED")).body);
  expect(opus.model).toBe("anthropic/claude-opus-5.5");
  expect(opus).not.toHaveProperty("thinking");
  expect(opus.output_config).toEqual({ effort: "low" });
  expect(opus.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
  expect(opus.system).toContain("Reply only by calling the submit_judgement tool, exactly once.");
  expect(opus.max_tokens).toBe(16384);

  const citations = JSON.parse((await send(t, "CITATIONS_WINDOW")).body);
  expect(citations.model).toBe("anthropic/claude-haiku-4.5");
  expect(citations.messages[0].content[0]).toMatchObject({
    type: "document",
    source: { type: "content" },
    citations: { enabled: true },
  });
});

test("openrouter prefers the dedicated Anthropic key when one is set", async () => {
  useOpenRouter();
  vi.stubEnv("OPENROUTER_ANTHROPIC_API_KEY", "synthetic-dedicated-key");
  const t = convexTest(schema, modules);
  const routed = await send(t, "SECTION_DRAFT");
  expect(routed.headers.authorization).toBe("Bearer synthetic-dedicated-key");
  expect(JSON.stringify(routed)).not.toContain(OPENROUTER_KEY);
});

// ─── Usage and cost ─────────────────────────────────────────────────────────

const OPENROUTER_USAGE = {
  input_tokens: 120,
  output_tokens: 30,
  cache_creation_input_tokens: 300,
  cache_read_input_tokens: 1000,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 300 },
  cost: 0.0123,
  is_byok: false,
  cost_details: { upstream_inference_cost: null },
};

async function usageOf(
  t: TestConvex,
  reply: () => Response,
  params: unknown = SEED_BATCH.params
): Promise<{ rows: Array<Record<string, unknown>>; taps: Parameters<UsageTap>[0][] }> {
  const taps: Parameters<UsageTap>[0][] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => reply()));
  await runAction(t, async (ctx) => {
    const client = instrumentedAnthropic(ctx, { callSite: "transport-contract", onUsage: (tap) => taps.push(tap) });
    await client.messages.create(params as never);
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const rows = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  return { rows: rows as unknown as Array<Record<string, unknown>>, taps };
}

test("openrouter records the exact credit charge, the 1-hour cache split, the stop reason, the transport and the serving provider", async () => {
  useOpenRouter();
  const t = convexTest(schema, modules);
  const { rows, taps } = await usageOf(t, () =>
    anthropicReply({ provider: "Anthropic", model: "anthropic/claude-sonnet-5-20260630", stop_reason: "tool_use" }, OPENROUTER_USAGE)
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    callSite: "transport-contract",
    // The app id, never the id sent on the wire.
    model: "claude-sonnet-5",
    inputTokens: 120,
    outputTokens: 30,
    cacheCreationInputTokens: 300,
    cacheCreation1hInputTokens: 300,
    cacheReadInputTokens: 1000,
    costUsd: 0.0123,
    costSource: "native",
    stopReason: "tool_use",
    transport: "openrouter",
    servedProvider: "Anthropic",
  });
  expect(taps).toEqual([{
    model: "claude-sonnet-5",
    costUsd: 0.0123,
    nativeCostUsd: 0.0123,
    tokens: {
      inputTokens: 120,
      outputTokens: 30,
      cacheCreationInputTokens: 300,
      cacheCreation1hInputTokens: 300,
      cacheReadInputTokens: 1000,
    },
  }]);
});

test("openrouter adds the upstream charge for a BYOK answer", async () => {
  useOpenRouter();
  const t = convexTest(schema, modules);
  const { rows } = await usageOf(t, () =>
    anthropicReply({ provider: "Anthropic" }, { cost: 0.001, is_byok: true, cost_details: { upstream_inference_cost: 0.02 } })
  );
  expect(rows[0]).toMatchObject({ costUsd: 0.021, costSource: "native", transport: "openrouter" });
});

test("openrouter without a reported charge falls back to the price-table estimate and still records the transport", async () => {
  useOpenRouter();
  const t = convexTest(schema, modules);
  const { rows, taps } = await usageOf(t, () => anthropicReply());
  expect(rows[0]).toMatchObject({ model: "claude-sonnet-5", costSource: "estimated", transport: "openrouter" });
  expect(rows[0]).not.toHaveProperty("servedProvider");
  expect(taps[0]).not.toHaveProperty("nativeCostUsd");
});

test("direct usage rows are unchanged: no transport, no provider, and any cost field is ignored", async () => {
  const t = convexTest(schema, modules);
  const { rows, taps } = await usageOf(t, () => anthropicReply({ provider: "Anthropic" }, OPENROUTER_USAGE));
  expect(rows[0]).toMatchObject({ model: "claude-sonnet-5", costSource: "estimated", cacheCreation1hInputTokens: 300 });
  expect(rows[0]).not.toHaveProperty("transport");
  expect(rows[0]).not.toHaveProperty("servedProvider");
  expect(rows[0].costUsd).not.toBe(0.0123);
  expect(Object.keys(taps[0])).toEqual(["model", "costUsd", "tokens"]);
});

// ─── Errors, retries, outcome counting and the deadline ─────────────────────

async function outcomeRows(t: TestConvex) {
  return await t.run((ctx) => ctx.db.query("modelCallOutcomes").collect());
}

async function settle<R>(promise: Promise<R>): Promise<{ ok: true; value: R } | { ok: false; error: unknown }> {
  return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

function errorReply(status: number, body: unknown, headers: Record<string, string> = { "retry-after-ms": "10" }) {
  return Response.json(body, { status, headers });
}

const anthropicError = (type: string, message: string) => ({ type: "error", error: { type, message } });

/**
 * One section-draft request through the production outcome recording, with
 * the timers advanced so the SDK's own retry sleeps run. Returns the
 * outcome, the URLs fetched and the outcome rows.
 */
async function recordedCall(
  t: TestConvex,
  replies: Array<() => Response | Promise<Response>>,
  setup?: (ctx: ActionCtx) => void
) {
  const urls: string[] = [];
  let call = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    urls.push(new Request(input, init).url);
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;
    return await reply();
  }));
  const result = settle(runAction(t, async (ctx) => {
    setup?.(ctx);
    const client = withOutcomeRecording(ctx, "claude-sonnet-5", "transport-contract",
      instrumentedAnthropic(ctx, { callSite: "transport-contract" }) as unknown as GenerationClient);
    return await client.messages.create(SECTION_DRAFT.params as never);
  }));
  await vi.advanceTimersByTimeAsync(30_000);
  const outcome = await result;
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { outcome, urls, outcomes: await outcomeRows(t) };
}

describe("openrouter retries what the SDK retries on direct", () => {
  test.each([408, 409, 429, 500, 502, 503, 504, 529])("a %i answer is retried once and the retry succeeds", async (status) => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls, outcomes } = await recordedCall(t, [
      () => errorReply(status, anthropicError("overloaded_error", "Synthetic upstream error")),
      () => anthropicReply({ provider: "Anthropic" }),
    ]);
    expect(outcome.ok).toBe(true);
    expect(urls).toEqual([OPENROUTER_MESSAGES_URL, OPENROUTER_MESSAGES_URL]);
    expect(outcomes).toMatchObject([{ model: "claude-sonnet-5", outcome: "success" }]);
  });

  test("a dropped connection is retried once", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls } = await recordedCall(t, [
      () => { throw new TypeError("fetch failed"); },
      () => anthropicReply({ provider: "Anthropic" }),
    ]);
    expect(outcome.ok).toBe(true);
    expect(urls).toHaveLength(2);
  });

  test("a 529 that outlasts its retry counts against the model, as on direct (decision 21)", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls, outcomes } = await recordedCall(t, [
      () => errorReply(529, anthropicError("overloaded_error", "Overloaded")),
    ]);
    expect(outcome.ok).toBe(false);
    expect(urls).toHaveLength(2);
    if (!outcome.ok) expect(modelFaultCode(outcome.error)).toBe("unknown");
    expect(outcomes).toMatchObject([{ model: "claude-sonnet-5", outcome: "failure" }]);
  });
});

/**
 * OpenRouter's in-flight spending budget 402 on the Messages endpoint, in the
 * documented Anthropic envelope (docs: errors-and-debugging, "Anthropic
 * Messages"; limits, "In-flight spending budget"; read 2026-09-25). The
 * chat-completions `error.metadata` is not documented here.
 */
const IN_FLIGHT_MESSAGE =
  "This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.";
const inFlight402 = (headers: Record<string, string> = { "retry-after": "2" }) =>
  errorReply(402, {
    type: "error",
    error: { type: "billing_error", message: IN_FLIGHT_MESSAGE, error_type: "payment_required" },
    request_id: null,
  }, headers);

const RATE_LIMITED = {
  code: "rate_limited",
  message: "The AI provider is limiting how many requests can run at once. Try again shortly.",
};

describe("openrouter in-flight spending budget (402)", () => {
  test("is retried once after its Retry-After wait, and the answer is used", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const urls: string[] = [];
    const replies = [() => inFlight402(), () => anthropicReply({ provider: "Anthropic" })];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      urls.push(new Request(input, init).url);
      return replies[urls.length - 1]();
    }));
    const result = settle(runAction(t, async (ctx) =>
      await withOutcomeRecording(ctx, "claude-sonnet-5", "transport-contract",
        instrumentedAnthropic(ctx, { callSite: "transport-contract" }) as unknown as GenerationClient
      ).messages.create(SECTION_DRAFT.params as never)
    ));
    await vi.advanceTimersByTimeAsync(1_900);
    expect(urls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect((await result).ok).toBe(true);
    expect(urls).toEqual([OPENROUTER_MESSAGES_URL, OPENROUTER_MESSAGES_URL]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await outcomeRows(t)).toMatchObject([{ model: "claude-sonnet-5", outcome: "success" }]);
  });

  test("still full after the retry: fails as a rate limit, not billing, and is not counted", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls, outcomes } = await recordedCall(t, [() => inFlight402()]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(normalizeProviderError(outcome.error)).toEqual(RATE_LIMITED);
    expect(modelFaultCode(outcome.error)).toBeNull();
    expect(urls).toHaveLength(2);
    expect(outcomes).toEqual([]);
  });

  test("the documented message alone, without Retry-After, is recognised and retried once", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls } = await recordedCall(t, [
      () => inFlight402({}),
      () => anthropicReply({ provider: "Anthropic" }),
    ]);
    expect(outcome.ok).toBe(true);
    expect(urls).toHaveLength(2);
  });

  test("a Retry-After longer than a minute is not waited for: fails at once as a rate limit", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls, outcomes } = await recordedCall(t, [() => inFlight402({ "retry-after": "90" })]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(normalizeProviderError(outcome.error)).toEqual(RATE_LIMITED);
    expect(urls).toHaveLength(1);
    expect(outcomes).toEqual([]);
  });

  test("under the action deadline: retried when a useful attempt fits after the wait", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls } = await recordedCall(t, [
      () => inFlight402({ "retry-after": "2" }),
      () => anthropicReply({ provider: "Anthropic" }),
    ], (ctx) => { startActionDeadline(ctx, Date.now() - (ACTION_REQUEST_WINDOW_MS - 100_000)); });
    expect(outcome.ok).toBe(true);
    expect(urls).toHaveLength(2);
  });

  test("under the action deadline: a wait that leaves no useful attempt fails at once as a rate limit", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls, outcomes } = await recordedCall(t, [
      () => inFlight402({ "retry-after": "2" }),
      () => anthropicReply({ provider: "Anthropic" }),
    ], (ctx) => { startActionDeadline(ctx, Date.now() - (ACTION_REQUEST_WINDOW_MS - 21_000)); });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(normalizeProviderError(outcome.error)).toEqual(RATE_LIMITED);
    expect(urls).toHaveLength(1);
    expect(outcomes).toEqual([]);
  });

  test("one request larger than the whole budget stays billing and is not retried", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls, outcomes } = await recordedCall(t, [
      () => errorReply(402, {
        type: "error",
        error: { type: "billing_error", message: "This request's estimated cost exceeds your in-flight budget.", error_type: "payment_required" },
        metadata: { reason: "weight_exceeds_budget", limit_source: "openrouter_credits" },
        request_id: null,
      }, {}),
    ]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(normalizeProviderError(outcome.error).code).toBe("billing");
    expect(urls).toHaveLength(1);
    expect(outcomes).toEqual([]);
  });

  test("on direct, the same 402 stays billing and is not retried, as before the switch", async () => {
    const t = convexTest(schema, modules);
    const { outcome, urls, outcomes } = await recordedCall(t, [() => inFlight402()]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(normalizeProviderError(outcome.error).code).toBe("billing");
    expect(urls).toEqual(["https://api.anthropic.com/v1/messages"]);
    expect(outcomes).toEqual([]);
  });
});

describe("openrouter answers that say nothing about the model are not counted", () => {
  test("402 without credits stays billing and is not retried", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, urls, outcomes } = await recordedCall(t, [
      () => errorReply(402, {
        type: "error",
        error: { type: "billing_error", message: "Insufficient credits", error_type: "payment_required" },
        request_id: null,
      }, {}),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(normalizeProviderError(outcome.error).code).toBe("billing");
    expect(urls).toHaveLength(1);
    expect(outcomes).toEqual([]);
  });

  test("404 when the Anthropic pin matches no endpoint", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, outcomes } = await recordedCall(t, [
      () => errorReply(404, anthropicError("not_found_error", "No endpoints found matching your data policy and provider preferences")),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(normalizeProviderError(outcome.error).code).toBe("network");
    expect(outcomes).toEqual([]);
  });

  test("403 from a key guardrail", async () => {
    useOpenRouter();
    const t = convexTest(schema, modules);
    const { outcome, outcomes } = await recordedCall(t, [
      () => errorReply(403, anthropicError("permission_error", "Provider blocked by guardrail")),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(normalizeProviderError(outcome.error).code).toBe("authentication");
    expect(outcomes).toEqual([]);
  });

  test("direct 404 and 403 keep their previous codes", async () => {
    const t = convexTest(schema, modules);
    const notFound = await recordedCall(t, [() => errorReply(404, anthropicError("not_found_error", "model: claude-sonnet-5"))]);
    expect(notFound.outcome.ok).toBe(false);
    if (!notFound.outcome.ok) expect(normalizeProviderError(notFound.outcome.error).code).toBe("unknown");
    const forbidden = await recordedCall(t, [() => errorReply(403, anthropicError("permission_error", "Forbidden"))]);
    if (!forbidden.outcome.ok) expect(normalizeProviderError(forbidden.outcome.error).code).toBe("model_access");
    expect((await outcomeRows(t)).map((row) => row.outcome)).toEqual(["failure", "failure"]);
  });
});

test("openrouter under the action deadline: 100 s left cuts the attempt to 100 s and fails with the writer-facing error", async () => {
  useOpenRouter();
  const t = convexTest(schema, modules);
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    urls.push(new Request(input, init).url);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    });
  }));
  const result = settle(runAction(t, async (ctx) => {
    startActionDeadline(ctx, Date.now() - (ACTION_REQUEST_WINDOW_MS - 100_000));
    const client = withOutcomeRecording(ctx, "claude-sonnet-5", "transport-contract",
      instrumentedAnthropic(ctx, { callSite: "transport-contract" }) as unknown as GenerationClient);
    return await client.messages.create(SECTION_DRAFT.params as never);
  }));
  let done = false;
  void result.then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(99_000);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1_000);
  const outcome = await result;
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toBeInstanceOf(ActionTimeBudgetError);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(urls).toEqual([OPENROUTER_MESSAGES_URL]);
  expect(await outcomeRows(t)).toEqual([]);
});

// ─── Configuration errors ───────────────────────────────────────────────────

/** A generation client built lazily, as production call sites build it. */
async function lazyCall(t: TestConvex, model: string) {
  const fetchSpy = vi.fn<typeof fetch>(async () => anthropicReply());
  vi.stubGlobal("fetch", fetchSpy);
  const outcome = await settle(runAction(t, async (ctx) =>
    await clientForModel(ctx, model, { callSite: "transport-contract" }).messages.create({
      ...SECTION_DRAFT.params,
      model,
    } as never)
  ));
  return { outcome, fetchSpy, outcomes: await outcomeRows(t) };
}

function configCode(error: unknown): unknown {
  return error instanceof ConvexError ? (error.data as { code?: unknown }).code : undefined;
}

test.each([
  ["an unknown transport value", () => vi.stubEnv("ANTHROPIC_TRANSPORT", "open-router"), "claude-sonnet-5", /ANTHROPIC_TRANSPORT must be/],
  ["openrouter without an OpenRouter key", () => { useOpenRouter(); vi.stubEnv("OPENROUTER_API_KEY", ""); }, "claude-sonnet-5", /OpenRouter is not configured/],
  ["a model without an OpenRouter id", () => useOpenRouter(), "claude-mythos-5-1", /has no OpenRouter id/],
])("%s fails before sending, as configuration, and is not counted against the model", async (_label, setup, model, message) => {
  setup();
  const t = convexTest(schema, modules);
  const { outcome, fetchSpy, outcomes } = await lazyCall(t, model);
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(configCode(outcome.error)).toBe("PROVIDER_NOT_CONFIGURED");
  expect(String((outcome.error as ConvexError<{ message: string }>).data.message)).toMatch(message);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(outcomes).toEqual([]);
});
