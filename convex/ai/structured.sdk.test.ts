/// <reference types="vite/client" />
import Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import schema from "../schema";
import { instrumentedAnthropic } from "./instrument";
import { STRUCTURED_OUTPUT_PROGRAM, generateStructured } from "./structured";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import { buildSeedPrompt } from "./trustedContext";
import { seedToolSchema } from "../lib/seedContract";
import { PD_SUBSECTIONS } from "../../shared/pdSubsections";

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

// ─── Cost phase 1: shared cacheable prefixes across generation roles ─────────

function anthropicReply(content: unknown[], model = "claude-sonnet-5") {
  return Response.json({
    id: "msg_prefix",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 2 },
  });
}

type WireBlock = { type: string; text: string; cache_control?: unknown };
type WireBody = {
  system?: unknown;
  tools?: unknown;
  messages: Array<{ role: string; content: string | WireBlock[] }>;
};
const wireBlocks = (body: WireBody): WireBlock[] => {
  const content = body.messages[0].content;
  if (typeof content === "string") throw new Error("expected text blocks");
  return content;
};

test("section drafts 242 and 244 share a byte-identical cached prefix at the SDK boundary", async () => {
  const t = convexTest(schema, modules);
  const bodies: WireBody[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    bodies.push(await new Request(input, init).json() as WireBody);
    return anthropicReply([{ type: "text", text: "Drafted paragraph." }]);
  }));
  const { runSection242Agent } = await import("./section242Agent");
  const { runSection244Agent } = await import("./section244Agent");
  const analysis = { uncertainties: ["Seal fatigue under cyclic load."] } as never;
  const brief = "\n\n--- BEGIN [GENERATION BRIEF] ---\nStoryline.\n--- END [GENERATION BRIEF] ---";
  await t.action(async (ctx) => {
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:section:242",
      attribution: { generationId: "generation-prefix" as never },
    });
    await runSection242Agent(client as never, analysis, "claude-sonnet-5", "", "\n\nBudget 242.", "", undefined, brief);
    await runSection244Agent(client as never, analysis, "claude-sonnet-5", "", "\n\nBudget 244.", "", undefined, brief);
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(bodies).toHaveLength(2);
  const [draft242, draft244] = bodies;
  expect(draft244.system).toEqual(draft242.system);
  expect(draft242.tools).toBeUndefined();
  const [shared242, task242] = wireBlocks(draft242);
  const [shared244, task244] = wireBlocks(draft244);
  expect(shared244).toEqual(shared242);
  expect(shared242.cache_control).toEqual({ type: "ephemeral" });
  expect(shared242.text).toContain("Seal fatigue under cyclic load.");
  // The Brief stays after the line's plan, outside the shared block.
  expect(shared242.text).not.toContain("GENERATION BRIEF");
  expect(task242.text.endsWith(brief)).toBe(true);
  expect(task242.cache_control).toBeUndefined();
  expect(task242.text).toContain("Your task is to draft Line 242 ");
  expect(task244.text).toContain("Your task is to draft Line 244 ");
  expect(task244.text).toContain("Budget 244.");
  // The instrument never adds its own breakpoints to an explicit policy.
  expect(JSON.stringify(draft242.system)).not.toContain("cache_control");
});

test("every seed role and both modes share tools, system and the cached source block; the repair keeps the prefix", async () => {
  const t = convexTest(schema, modules);
  const bodies: WireBody[] = [];
  let call = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    bodies.push(await new Request(input, init).json() as WireBody);
    call += 1;
    // The first call returns no tool output, forcing the one repair attempt.
    return anthropicReply(call === 1
      ? [{ type: "text", text: "No tool." }]
      : [{ type: "tool_use", id: `tool-${call}`, name: SEED_PROMPT_PROGRAM.request.toolName, input: { seeds: [] } }]);
  }));
  const common = {
    brief: { storyline: "A frozen storyline.", entries: ["Complete Brief item."] },
    sources: [{ sourceId: "source-1", label: "Interview", kind: "transcript",
      content: "The team measured seal fatigue at 400 kPa. ".repeat(50), contentHash: "hash-1" }],
    projection: { decisions: "(none)", feedback: "(none)" },
    writerSettings: { profile: "Frozen profile.", styleOverrides: {} },
    lengthTarget: "standard",
  };
  const runs = PD_SUBSECTIONS.flatMap((role) =>
    (["batch", "feedback"] as const).map((mode) => ({
      roleId: role.roleId,
      mode,
      request: buildSeedPrompt({ ...common, mode, objective: role.objective }),
    }))
  );
  for (const run of runs) {
    expect(run.request.userBlocks.map((block) => block.text).join("")).toBe(run.request.user);
  }
  await t.action(async (ctx) => {
    for (const run of runs) {
      await generateStructured(
        instrumentedAnthropic(ctx, {
          callSite: `generation:${run.mode === "batch" ? "seeds" : "seedFeedback"}:${run.roleId}`,
          attribution: { generationId: "generation-seeds" as never },
        }),
        {
          system: run.request.system,
          user: run.request.userBlocks,
          toolName: SEED_PROMPT_PROGRAM.request.toolName,
          description: SEED_PROMPT_PROGRAM.request.description,
          schema: seedToolSchema() as never,
          maxTokens: SEED_PROMPT_PROGRAM.request.maxTokens,
          model: "claude-sonnet-5",
        },
      );
    }
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // The first run spends its repair; every other run is one request.
  expect(bodies).toHaveLength(runs.length + 1);
  const [firstTry, repair, ...others] = bodies;
  // One schema carries every role's fields and both modes' bounds.
  const tools = JSON.stringify(firstTry.tools);
  expect(tools).toContain("experimentSeedIds");
  expect(tools).toContain('"minItems":1,"maxItems":5');
  const firstBlock = wireBlocks(firstTry)[0];
  expect(firstBlock.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  expect(firstBlock.text).toContain("seal fatigue at 400 kPa");
  expect(firstBlock.text).not.toContain("SUBSECTION OBJECTIVE");
  for (const other of others) {
    // Tools render first, then system, then the cached source block: all
    // three must be byte-identical for every role and both modes.
    expect(JSON.stringify(other.tools)).toBe(JSON.stringify(firstTry.tools));
    expect(other.system).toEqual(firstTry.system);
    expect(wireBlocks(other)[0]).toEqual(firstBlock);
  }
  expect(new Set(others.map((body) => wireBlocks(body)[1].text)).size).toBe(others.length);
  // The repair re-sends the same blocks and appends the scaffold uncached.
  expect(wireBlocks(repair).slice(0, 2)).toEqual(wireBlocks(firstTry));
  expect(wireBlocks(repair)[2].text).toContain(STRUCTURED_OUTPUT_PROGRAM.repairScaffold.prefix.trim());
  expect(wireBlocks(repair)[2].cache_control).toBeUndefined();
});
