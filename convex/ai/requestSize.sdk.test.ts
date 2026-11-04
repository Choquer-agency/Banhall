/// <reference types="vite/client" />

/**
 * F1, step 1 (2026-10-27): every Anthropic request's usage row records the
 * characters it sent (`requestChars`) and the part sent in user turns
 * (`evidenceChars`), measured on the request as sent. Only `fetch` is
 * stubbed: the Anthropic SDK, the instrumented client and the usage row are
 * the production ones. Each count is the request's text counted here by
 * hand. Every passage is fictional.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { api } from "../_generated/api";
import { instrumentedAnthropic } from "./instrument";
import { requestSize } from "./requestSize";
import { charsPerTokenByCallSite, REQUEST_SIZE_MAX_ROWS } from "../aiUsage";
import { anthropicMessageSse, sseResponse } from "../anthropicSse.fixture";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

beforeAll(async () => {
  await import("../modelCatalog");
  await import("../providerCredit");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-27T12:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-request-size-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const USAGE = { input_tokens: 40, output_tokens: 8, cache_creation_input_tokens: 300, cache_read_input_tokens: 1000 };

function reply(): Response {
  return new Response(
    JSON.stringify({
      id: "msg_size",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: USAGE,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

/** Sends `params` through the instrumented client; returns the wire body and the usage row. */
async function sent(t: TestConvex, callSite: string, params: unknown, attributed = false, streaming = false) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = (await new Request(input, init).json()) as Record<string, unknown>;
      bodies.push(body);
      if (body.stream === true) {
        return sseResponse(
          anthropicMessageSse({ model: "claude-sonnet-5", content: [{ type: "text", text: "Done." }], usage: USAGE })
        );
      }
      return reply();
    })
  );
  const generationId = attributed
    ? await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { authId: "size", role: "writer" });
        const projectId = await ctx.db.insert("projects", {
          title: "Seals", clientName: "Quillmere", status: "generating", createdBy: userId, shareToken: "size", createdAt: 1, updatedAt: 1,
        });
        return await ctx.db.insert("generations", { projectId, status: "running", startedAt: 1 });
      })
    : undefined;
  await t.action(async (ctx: ActionCtx) => {
    const client = instrumentedAnthropic(ctx, { callSite, ...(generationId ? { attribution: { generationId } } : {}) });
    if (streaming) {
      await (client.messages as unknown as { createStreaming: (params: unknown, handlers: unknown) => Promise<unknown> }).createStreaming(params, {});
    } else {
      await client.messages.create(params as never);
    }
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const rows = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  return { body: bodies[0]!, row: rows[rows.length - 1]! };
}

const SYSTEM = "You draft Line 242 of a CRA T661 project description.";
const TRANSCRIPT = "Priya Raman: We tuned the seal at 64 C.\nInterviewer: And then?\nPriya Raman: It held for six hours.";

describe("request characters on the usage row (F1)", () => {
  test("a cached generation request: the cache marks add no characters", async () => {
    const t = convexTest(schema, modules);
    const params = {
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        { role: "user", content: TRANSCRIPT },
        { role: "assistant", content: "Understood." },
        { role: "user", content: "Draft Line 242 now." },
      ],
    };
    const { body, row } = await sent(t, "generation:section:242", params, true);
    // The instrument marked the prefix for caching on the wire.
    expect(JSON.stringify(body)).toContain("cache_control");
    const user = TRANSCRIPT.length + "Draft Line 242 now.".length;
    expect(row).toMatchObject({
      requestChars: SYSTEM.length + user + "Understood.".length,
      evidenceChars: user,
      inputTokens: 40,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 1000,
    });
    expect(requestSize(body)).toEqual({ requestChars: row.requestChars, evidenceChars: row.evidenceChars });
  });

  test("a tool-using request: the tools as JSON, the call's input and its result", async () => {
    const t = convexTest(schema, modules);
    const tools = [
      {
        name: "read_file",
        description: "Read one project file.",
        input_schema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] },
      },
    ];
    const params = {
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM }],
      tools,
      messages: [
        { role: "user", content: [{ type: "text", text: "Check the seal notes." }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { fileId: "seal-notes" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: TRANSCRIPT }] }] },
      ],
    };
    const { body, row } = await sent(t, "pd_review", params);
    const toolInput = JSON.stringify({ fileId: "seal-notes" }).length;
    const user = "Check the seal notes.".length + TRANSCRIPT.length;
    expect(row).toMatchObject({
      requestChars: SYSTEM.length + JSON.stringify(body.tools).length + user + toolInput,
      evidenceChars: user,
    });
  });

  test("a citations-mode request: a document's text and title count, a PDF's base64 does not", async () => {
    const t = convexTest(schema, modules);
    const params = {
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", title: "Seal notes", source: { type: "text", media_type: "text/plain", data: TRANSCRIPT }, citations: { enabled: true } },
            { type: "document", title: "Scan", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK".repeat(50) } },
            { type: "text", text: "List the facts." },
          ],
        },
      ],
    };
    const { row } = await sent(t, "generation:facts", params, true);
    const user = "Seal notes".length + TRANSCRIPT.length + "Scan".length + "List the facts.".length;
    expect(row).toMatchObject({ requestChars: user, evidenceChars: user });
  });
});

describe("request characters on the other transports (F1)", () => {
  test("a streamed request counts the same text", async () => {
    const t = convexTest(schema, modules);
    const params = {
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: TRANSCRIPT }],
    };
    const { body, row } = await sent(t, "pd_review", params, false, true);
    expect(body.stream).toBe(true);
    expect(row).toMatchObject({ requestChars: SYSTEM.length + TRANSCRIPT.length, evidenceChars: TRANSCRIPT.length });
  });

  test("through OpenRouter, the count is the request's text, not the provider pin added for OpenRouter", async () => {
    vi.stubEnv("ANTHROPIC_TRANSPORT", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
    const t = convexTest(schema, modules);
    const params = {
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: TRANSCRIPT }],
    };
    const { body, row } = await sent(t, "pd_review", params);
    expect(body.provider).toBeDefined();
    expect(row).toMatchObject({ transport: "openrouter", requestChars: SYSTEM.length + TRANSCRIPT.length });
  });
});

describe("characters per token by call site and model (F1, step 2)", () => {
  const base = { model: "claude-sonnet-5-5", cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  test("divides the characters sent by every input token, cache writes and reads included, per model, and counts the requests", () => {
    const report = charsPerTokenByCallSite([
      { ...base, callSite: "generation:brief", requestChars: 40_000, evidenceChars: 30_000, inputTokens: 1_000, cacheCreationInputTokens: 4_000, cacheReadInputTokens: 5_000 },
      { ...base, callSite: "generation:brief", requestChars: 20_000, evidenceChars: 10_000, inputTokens: 5_000 },
      // Another model's tokens are another figure.
      { ...base, callSite: "generation:brief", model: "claude-sonnet-5", requestChars: 3_000, evidenceChars: 0, inputTokens: 1_000 },
      { ...base, callSite: "pd_review", requestChars: 3_600, evidenceChars: 0, inputTokens: 1_000 },
      // Rows from before the change carry no characters, and a row charged
      // no input says nothing; both are left out.
      { ...base, callSite: "pd_review", inputTokens: 9_000 },
      { ...base, callSite: "pd_review", requestChars: 5_000, evidenceChars: 5_000, inputTokens: 0 },
    ]);
    expect(report).toEqual([
      { callSite: "generation:brief", model: "claude-sonnet-5-5", requests: 2, requestChars: 60_000, evidenceChars: 40_000, inputSideTokens: 15_000, charsPerToken: 4 },
      { callSite: "generation:brief", model: "claude-sonnet-5", requests: 1, requestChars: 3_000, evidenceChars: 0, inputSideTokens: 1_000, charsPerToken: 3 },
      { callSite: "pd_review", model: "claude-sonnet-5-5", requests: 1, requestChars: 3_600, evidenceChars: 0, inputSideTokens: 1_000, charsPerToken: 3.6 },
    ]);
  });

  test("the report is for admins, reads the last 30 days, and says how many requests it rests on", async () => {
    const t = convexTest(schema, modules);
    const now = Date.parse("2026-10-27T12:00:00Z");
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "size-admin", role: "admin" });
      await ctx.db.insert("users", { authId: "size-writer", role: "writer" });
      const row = { callSite: "pd_review", model: "claude-sonnet-5", outputTokens: 1, costUsd: 0 };
      await ctx.db.insert("aiUsage", { ...row, inputTokens: 1_000, requestChars: 3_000, evidenceChars: 2_000, createdAt: now - 60_000 });
      // Older than 30 days.
      await ctx.db.insert("aiUsage", { ...row, inputTokens: 1_000, requestChars: 9_000, evidenceChars: 0, createdAt: now - 31 * 24 * 60 * 60 * 1000 });
    });
    await expect(t.withIdentity({ subject: "size-writer" }).query(api.aiUsage.requestSizeReport, {})).rejects.toThrow();
    const report = await t.withIdentity({ subject: "size-admin" }).query(api.aiUsage.requestSizeReport, {});
    expect(report).toMatchObject({
      truncated: false,
      measured: 1,
      callSites: [{ callSite: "pd_review", model: "claude-sonnet-5", requests: 1, charsPerToken: 3 }],
    });
    expect(REQUEST_SIZE_MAX_ROWS).toBe(4_000);
  });
});
