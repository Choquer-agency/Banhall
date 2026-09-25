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
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic } from "./instrument";
import { startActionDeadline } from "./actionDeadline";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

const ANTHROPIC_KEY = "synthetic-direct-anthropic-key";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-09-25T12:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", ANTHROPIC_KEY);
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
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

/** The same QA request inside an action that runs under its deadline. */
const QA_UNDER_DEADLINE = { ...OPUS_STRUCTURED, deadline: true } as const;

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
    if (request.deadline) startActionDeadline(ctx);
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
 * captured at b8e97f0a, before the transport switch existed.
 */
const DIRECT_WIRE_HASHES: Record<RequestName, string> = {
  SECTION_DRAFT: "d29f8da09347b348bc2b4e8fbc21860890aae8312e3ff46ee3a1fcb256cac77b",
  SEED_BATCH: "b9b8701e6576a5a90dcaea83abad2f5a7175864c287ad62c59ef7536a0064a9c",
  OPUS_STRUCTURED: "5589bb048cf2343f1f80c515a3b45fde7b63bc836a8f10994f732b0c89d3bdb3",
  CITATIONS_WINDOW: "d3199ca251ac3802d2b97e53007f879243e82a36a8159ae77df534b112746e15",
  QA_UNDER_DEADLINE: "5589bb048cf2343f1f80c515a3b45fde7b63bc836a8f10994f732b0c89d3bdb3",
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
    expect({ name, hash: await sha256(JSON.stringify(wire)) }).toEqual({ name, hash: DIRECT_WIRE_HASHES[name] });
  }
);
