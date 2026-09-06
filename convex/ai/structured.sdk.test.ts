/// <reference types="vite/client" />
import Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import schema from "../schema";
import { instrumentedAnthropic } from "./instrument";
import { generateStructured } from "./structured";

// Keep SDK, application decoding and Convex scheduling real; replace only fetch.
const modules = import.meta.glob("../**/*.ts");
const toolSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: { summary: { type: "string" }, accepted: { type: "boolean" } },
  required: ["summary", "accepted"],
  additionalProperties: false,
};
const options = {
  system: "Assess the supplied experiment.",
  user: "The measured trial met its criterion.",
  toolName: "submit_assessment",
  description: "Return the assessment.",
  schema: toolSchema,
  maxTokens: 256,
  model: "claude-sonnet-5",
  validate: z.object({ summary: z.string(), accepted: z.boolean() }),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-sdk-contract-key");
  // No request can escape even if setup below is accidentally removed.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("serializes a forced tool request through the real SDK and decodes its structured result and usage", async () => {
  const t = convexTest(schema, modules);
  const requests: Request[] = [];
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return Response.json({
      id: "msg_synthetic",
      type: "message",
      role: "assistant",
      model: options.model,
      content: [
        { type: "text", text: "Assessment follows." },
        { type: "tool_use", id: "tool_synthetic", name: options.toolName,
          input: { summary: "Criterion met", accepted: true } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 31, output_tokens: 17, cache_creation_input_tokens: 5, cache_read_input_tokens: 9 },
    }, { headers: { "request-id": "req_synthetic" } });
  });
  vi.stubGlobal("fetch", transport);
  const value = await t.action(async (ctx) => generateStructured(
    instrumentedAnthropic(ctx, { callSite: "sdk-contract" }), options,
  ));
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(value).toEqual({ summary: "Criterion met", accepted: true });
  expect(transport).toHaveBeenCalledTimes(1);
  const request = requests[0];
  if (!request) throw new Error("SDK did not reach the HTTP boundary");
  expect(request.url).toBe("https://api.anthropic.com/v1/messages");
  expect(request.method).toBe("POST");
  expect(request.headers.get("x-api-key")).toBe("synthetic-sdk-contract-key");
  expect(request.headers.get("anthropic-version")).toBe("2023-06-01");
  const body: unknown = await request.json();
  expect(body).toEqual({
    model: options.model,
    max_tokens: 256,
    system: options.system,
    tools: [{ name: options.toolName, description: options.description, input_schema: toolSchema }],
    tool_choice: { type: "tool", name: options.toolName },
    messages: [{ role: "user", content: options.user }],
  });
  const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  expect(usage).toHaveLength(1);
  expect(usage[0]).toMatchObject({ callSite: "sdk-contract", model: options.model,
    inputTokens: 31, outputTokens: 17, cacheCreationInputTokens: 5, cacheReadInputTokens: 9 });
});

test("propagates a real SDK authentication error without structured repair or successful usage", async () => {
  const t = convexTest(schema, modules);
  const transport = vi.fn<typeof fetch>(async () => Response.json({
    type: "error",
    error: { type: "authentication_error", message: "Synthetic rejected credential" },
  }, { status: 401, headers: { "request-id": "req_synthetic_error" } }));
  vi.stubGlobal("fetch", transport);
  const result = t.action(async (ctx) => generateStructured(
    instrumentedAnthropic(ctx, { callSite: "sdk-contract-error" }), options,
  ));
  await expect(result).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
  await expect(result).rejects.toMatchObject({ status: 401, requestID: "req_synthetic_error",
    error: { type: "error", error: { type: "authentication_error", message: "Synthetic rejected credential" } } });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await t.run((ctx) => ctx.db.query("aiUsage").collect())).toEqual([]);
});
