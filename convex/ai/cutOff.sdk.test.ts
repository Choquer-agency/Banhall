/// <reference types="vite/client" />

/**
 * Answers cut off at the output token limit (2026-09-25). Only `fetch` is
 * stubbed: the Anthropic SDK, the OpenRouter transport, the usage and
 * outcome recording and the Convex scheduler are the production ones.
 *
 * - A structured answer the provider stopped at `max_tokens` (or OpenRouter
 *   `length`) is never accepted, even when its partial tool input would pass
 *   validation. It spends the one repair attempt, whose note asks for a
 *   shorter answer, then fails cleanly as an output-limit failure.
 * - A plain-text section answer cut off the same way is refused and counted
 *   as an output-limit failure. A cut-off compression pass keeps the text
 *   it was given and is not counted, on both gateways.
 * - Every usage row records the provider's stop reason.
 * - Uncut answers and requests are exactly what they were.
 */
import Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic } from "./instrument";
import { instrumentedOpenRouter } from "./openrouter";
import { OutputLimitError, type GenerationClient } from "./openrouterCore";
import { normalizeProviderError, withOutcomeRecording } from "./providers";
import { STRUCTURED_OUTPUT_PROGRAM, generateStructured } from "./structured";
import { compressSection } from "./pipeline";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

const toolSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    gaps: { type: "array", items: { type: "string" } },
    quotes: { type: "array", items: { type: "string" } },
  },
  required: ["summary"],
};
// Like the analyzer and the Brief: the trailing lists default to empty, so a
// reply cut inside them still validates.
const validate = z.object({
  summary: z.string(),
  gaps: z.array(z.string()).default([]),
  quotes: z.array(z.string()).default([]),
});
const options = {
  system: "Analyze the interview.",
  user: "Priya Shah: The seal failed at 4.2 bar in the third trial.",
  toolName: "submit_analysis",
  description: "Return the analysis.",
  schema: toolSchema,
  maxTokens: 256,
  model: "claude-sonnet-5",
  validate,
};
const PARTIAL = { summary: "The seal failed at 4.2 bar." };
const COMPLETE = {
  summary: "The seal failed at 4.2 bar.",
  gaps: ["Seal material not named."],
  quotes: ["The seal failed at 4.2 bar in the third trial."],
};
const REPAIR_NOTE =
  "\n\nYour previous tool output was invalid: it was cut off at the output token limit before it finished, so write a shorter answer. Return the complete tool object and include every required field.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-cutoff-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-cutoff-openrouter");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function anthropicMessage(content: unknown[], stopReason: string, outputTokens: number) {
  return Response.json({
    id: `msg_${stopReason}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 40, output_tokens: outputTokens },
  });
}

const toolUse = (input: unknown) => ({ type: "tool_use", id: "tool_synthetic", name: options.toolName, input });

type WireBody = { max_tokens: number; messages: Array<{ role: string; content: unknown }> };

test("a cut-off tool answer that would validate spends the repair, then fails cleanly as an output-limit failure", async () => {
  // The partial object passes the schema: before this change it was saved.
  expect(validate.safeParse(PARTIAL).success).toBe(true);
  const t = convexTest(schema, modules);
  const bodies: WireBody[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    bodies.push(await new Request(input, init).json() as WireBody);
    return anthropicMessage([toolUse(PARTIAL)], "max_tokens", options.maxTokens);
  }));

  const outcome = await runAction(t, async (ctx) => {
    const client = withOutcomeRecording(
      ctx,
      options.model,
      "cutoff-contract",
      instrumentedAnthropic(ctx, { callSite: "cutoff-contract" }) as unknown as GenerationClient
    );
    try {
      await generateStructured(client, options);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        cutOff: error instanceof OutputLimitError,
        message: error instanceof Error ? error.message : String(error),
        code: normalizeProviderError(error).code,
      };
    }
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(outcome).toEqual({
    ok: false,
    cutOff: true,
    message: "submit_analysis: response was truncated at the max_tokens limit before completing",
    code: "output_limit",
  });
  expect(bodies).toHaveLength(2);
  expect(bodies[0].messages).toEqual([{ role: "user", content: options.user }]);
  // The repair keeps the same output limit and asks for a shorter answer.
  expect(bodies[1].max_tokens).toBe(options.maxTokens);
  expect(bodies[1].messages).toEqual([{ role: "user", content: `${options.user}${REPAIR_NOTE}` }]);
  const scaffold = STRUCTURED_OUTPUT_PROGRAM.repairScaffold;
  expect(`${scaffold.prefix}${scaffold.cutOffSummary}${scaffold.suffix}`).toBe(REPAIR_NOTE);

  const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  expect(usage.map((row) => [row.callSite, row.outputTokens, row.stopReason])).toEqual([
    ["cutoff-contract", 256, "max_tokens"],
    ["cutoff-contract", 256, "max_tokens"],
  ]);
  // Each billed request counts once, as a failure of the model.
  const outcomes = await t.run((ctx) => ctx.db.query("modelCallOutcomes").collect());
  expect(outcomes.map((row) => row.outcome)).toEqual(["failure", "failure"]);
  const buckets = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
  expect(buckets).toHaveLength(1);
  expect(buckets[0]).toMatchObject({ successes: 0, failures: 2, lastFailureCode: "output_limit" });
});

test("a cut-off tool answer followed by a complete one returns the complete answer, never the partial", async () => {
  const t = convexTest(schema, modules);
  const bodies: WireBody[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    bodies.push(await new Request(input, init).json() as WireBody);
    return bodies.length === 1
      ? anthropicMessage([toolUse(PARTIAL)], "max_tokens", options.maxTokens)
      : anthropicMessage([toolUse(COMPLETE)], "tool_use", 90);
  }));

  const value = await runAction(t, async (ctx) =>
    generateStructured(instrumentedAnthropic(ctx, { callSite: "cutoff-contract" }), options)
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(value).toEqual(COMPLETE);
  expect(bodies).toHaveLength(2);
  expect(bodies[1].messages).toEqual([{ role: "user", content: `${options.user}${REPAIR_NOTE}` }]);
  const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  expect(usage.map((row) => row.stopReason)).toEqual(["max_tokens", "tool_use"]);
});

test("an uncut tool answer is accepted exactly as before, in one request, with its stop reason recorded", async () => {
  const t = convexTest(schema, modules);
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    bodies.push(await new Request(input, init).json());
    return anthropicMessage([toolUse(COMPLETE)], "tool_use", 90);
  }));

  const value = await runAction(t, async (ctx) =>
    generateStructured(instrumentedAnthropic(ctx, { callSite: "cutoff-contract" }), options)
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(value).toEqual(COMPLETE);
  expect(bodies).toEqual([{
    model: options.model,
    max_tokens: options.maxTokens,
    system: options.system,
    tools: [{ name: options.toolName, description: options.description, input_schema: toolSchema }],
    tool_choice: { type: "tool", name: options.toolName },
    messages: [{ role: "user", content: options.user }],
  }]);
  const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  expect(usage).toHaveLength(1);
  expect(usage[0]).toMatchObject({ inputTokens: 40, outputTokens: 90, stopReason: "tool_use" });
});

test("OpenRouter: a length-truncated tool answer gets the same shorter-answer repair and records its finish reason", async () => {
  const t = convexTest(schema, modules);
  const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    bodies.push(await request.json() as (typeof bodies)[number]);
    const cut = bodies.length === 1;
    return Response.json({
      model: "openai/gpt-6-sol",
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_synthetic",
            function: {
              name: options.toolName,
              arguments: cut ? '{"summary":"The seal fa' : JSON.stringify(COMPLETE),
            },
          }],
        },
        finish_reason: cut ? "length" : "tool_calls",
      }],
      usage: { prompt_tokens: 40, completion_tokens: cut ? 1024 : 90, cost: 0.001 },
    });
  }));

  const value = await runAction(t, async (ctx) =>
    generateStructured(instrumentedOpenRouter(ctx, { callSite: "cutoff-contract" }), {
      ...options,
      model: "openai/gpt-6-sol",
    })
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(value).toEqual(COMPLETE);
  expect(bodies).toHaveLength(2);
  expect(bodies[1].messages.at(-1)).toEqual({ role: "user", content: `${options.user}${REPAIR_NOTE}` });
  const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  expect(usage.map((row) => row.stopReason)).toEqual(["length", "tool_calls"]);
});

test("a section draft cut off at the output limit is refused, never delivered; an uncut draft is unchanged", async () => {
  const t = convexTest(schema, modules);
  let call = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
    call += 1;
    return call === 1
      ? anthropicMessage([{ type: "text", text: "The team measured seal fatigue at" }], "max_tokens", 8192)
      : anthropicMessage([{ type: "text", text: "  The team measured seal fatigue at 400 kPa.  " }], "end_turn", 12);
  }));
  const { runSection242Agent } = await import("./section242Agent");
  const analysis = { uncertainties: ["Seal fatigue under cyclic load."] } as never;

  const results = await runAction(t, async (ctx) => {
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:section:242",
    }) as unknown as GenerationClient;
    const cut = await runSection242Agent(client, analysis, "claude-sonnet-5").then(
      (text) => ({ text }),
      (error: unknown) => ({
        cutOff: error instanceof OutputLimitError,
        code: normalizeProviderError(error).code,
      })
    );
    const uncut = await runSection242Agent(client, analysis, "claude-sonnet-5");
    return { cut, uncut };
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(results).toEqual({
    cut: { cutOff: true, code: "output_limit" },
    uncut: "The team measured seal fatigue at 400 kPa.",
  });
  const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  expect(usage.map((row) => row.stopReason)).toEqual(["max_tokens", "end_turn"]);
});

test("a cut-off compression keeps the section it was given, on both gateways", async () => {
  const t = convexTest(schema, modules);
  const original = "The original, longer section text about seal fatigue.";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new Request(input, init).url;
    if (url.startsWith("https://openrouter.ai/")) {
      return Response.json({
        model: "openai/gpt-6-sol",
        choices: [{ message: { content: "The shorter sec" }, finish_reason: "length" }],
        usage: { prompt_tokens: 40, completion_tokens: 4096, cost: 0.001 },
      });
    }
    return anthropicMessage([{ type: "text", text: "The shorter sec" }], "max_tokens", 4096);
  }));

  const outputs = await runAction(t, async (ctx) => [
    await compressSection(
      instrumentedAnthropic(ctx, { callSite: "cutoff-contract" }) as unknown as GenerationClient,
      "claude-sonnet-5",
      "s242",
      original,
      "standard"
    ),
    await compressSection(
      instrumentedOpenRouter(ctx, { callSite: "cutoff-contract" }),
      "openai/gpt-6-sol",
      "s242",
      original,
      "standard"
    ),
  ]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(outputs).toEqual([original, original]);
  const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  expect(usage.map((row) => row.stopReason).sort()).toEqual(["length", "max_tokens"]);
});

test("a cut-off section draft or tool answer records the same output-limit failure on both gateways (cutoff review P3-1)", async () => {
  const t = convexTest(schema, modules);
  let openRouterCalls = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (!request.url.startsWith("https://openrouter.ai/")) {
      return anthropicMessage([{ type: "text", text: "The team measured seal fatigue at" }], "max_tokens", 8192);
    }
    openRouterCalls += 1;
    const body = (await request.json()) as { tools?: unknown[] };
    if (!body.tools) {
      return Response.json({
        model: "openai/gpt-6-sol",
        choices: [{ message: { content: "The team measured seal fatigue at" }, finish_reason: "length" }],
        usage: { prompt_tokens: 40, completion_tokens: 8192, cost: 0.001 },
      });
    }
    return Response.json({
      model: "openai/gpt-6-luna",
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: "call_synthetic", function: { name: options.toolName, arguments: '{"summary":"The seal fa' } }],
        },
        finish_reason: "length",
      }],
      usage: { prompt_tokens: 40, completion_tokens: 256, cost: 0.001 },
    });
  }));
  const { runSection242Agent } = await import("./section242Agent");
  const analysis = { uncertainties: ["Seal fatigue under cyclic load."] } as never;

  const drafts = await runAction(t, async (ctx) => {
    const anthropic = withOutcomeRecording(ctx, "claude-sonnet-5", "generation:section:242",
      instrumentedAnthropic(ctx, { callSite: "generation:section:242" }) as unknown as GenerationClient);
    const openRouter = (model: string, callSite: string) => withOutcomeRecording(ctx, model, callSite,
      instrumentedOpenRouter(ctx, { callSite }));
    const refused = (error: unknown) => error instanceof OutputLimitError;
    const outcomes = [
      await runSection242Agent(anthropic, analysis, "claude-sonnet-5").then(() => false, refused),
      await runSection242Agent(openRouter("openai/gpt-6-sol", "generation:section:242"), analysis, "openai/gpt-6-sol")
        .then(() => false, refused),
    ];
    await generateStructured(openRouter("openai/gpt-6-luna", "cutoff-contract"), { ...options, model: "openai/gpt-6-luna" })
      .catch(() => null);
    return outcomes;
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(drafts).toEqual([true, true]);
  expect(openRouterCalls).toBe(3);
  const buckets = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
  const byModel = Object.fromEntries(buckets.map((row) => [row.model, row]));
  // Text: one failure each, never a success. Tool: both attempts cut.
  expect(byModel["claude-sonnet-5"]).toMatchObject({ successes: 0, failures: 1, lastFailureCode: "output_limit" });
  expect(byModel["openai/gpt-6-sol"]).toMatchObject({ successes: 0, failures: 1, lastFailureCode: "output_limit" });
  expect(byModel["openai/gpt-6-luna"]).toMatchObject({ successes: 0, failures: 2, lastFailureCode: "output_limit" });
});

test("a cut-off compression is not counted toward rollback on either gateway; an uncut one counts as a success", async () => {
  const t = convexTest(schema, modules);
  const original = "The original, longer section text about seal fatigue.";
  let cut = true;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new Request(input, init).url;
    if (url.startsWith("https://openrouter.ai/")) {
      return Response.json({
        model: "openai/gpt-6-sol",
        choices: [{ message: { content: cut ? "The shorter sec" : "The shorter section." }, finish_reason: cut ? "length" : "stop" }],
        usage: { prompt_tokens: 40, completion_tokens: 4096, cost: 0.001 },
      });
    }
    return cut
      ? anthropicMessage([{ type: "text", text: "The shorter sec" }], "max_tokens", 4096)
      : anthropicMessage([{ type: "text", text: "The shorter section." }], "end_turn", 12);
  }));

  const compress = (t: TestConvex) => runAction(t, async (ctx) => {
    const callSite = "generation:compression:242";
    const anthropic = withOutcomeRecording(ctx, "claude-sonnet-5", callSite,
      instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient);
    const openRouter = withOutcomeRecording(ctx, "openai/gpt-6-sol", callSite,
      instrumentedOpenRouter(ctx, { callSite }));
    return [
      await compressSection(anthropic, "claude-sonnet-5", "s242", original, "standard"),
      await compressSection(openRouter, "openai/gpt-6-sol", "s242", original, "standard"),
    ];
  });
  const buckets = async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
    return Object.fromEntries(rows.map((row) => [row.model, { successes: row.successes, failures: row.failures }]));
  };

  expect(await compress(t)).toEqual([original, original]);
  expect(await buckets()).toEqual({});
  const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
  expect(usage.map((row) => row.stopReason).sort()).toEqual(["length", "max_tokens"]);

  cut = false;
  expect(await compress(t)).toEqual(["The shorter section.", "The shorter section."]);
  expect(await buckets()).toEqual({
    "claude-sonnet-5": { successes: 1, failures: 0 },
    "openai/gpt-6-sol": { successes: 1, failures: 0 },
  });
});

test("a cut-off repair keeps its draft and is not counted toward rollback on either gateway; a cut-off section draft is", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new Request(input, init).url;
    if (url.startsWith("https://openrouter.ai/")) {
      return Response.json({
        model: "openai/gpt-6-sol",
        choices: [{ message: { content: "The repaired sec" }, finish_reason: "length" }],
        usage: { prompt_tokens: 40, completion_tokens: 4096, cost: 0.001 },
      });
    }
    return anthropicMessage([{ type: "text", text: "The repaired sec" }], "max_tokens", 4096);
  }));
  const send = (callSite: string) => runAction(t, async (ctx) => {
    const anthropic = withOutcomeRecording(ctx, "claude-sonnet-5", callSite,
      instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient);
    const openRouter = withOutcomeRecording(ctx, "openai/gpt-6-sol", callSite,
      instrumentedOpenRouter(ctx, { callSite }));
    const request = { max_tokens: 4096, messages: [{ role: "user" as const, content: "Repair this section." }] };
    await anthropic.messages.create({ ...request, model: "claude-sonnet-5" }).catch(() => null);
    await openRouter.messages.create({ ...request, model: "openai/gpt-6-sol" }).catch(() => null);
  });
  const buckets = async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run((ctx) => ctx.db.query("modelCallBuckets").collect());
    return Object.fromEntries(rows.map((row) => [row.model, { successes: row.successes, failures: row.failures }]));
  };

  await send("generation:repair:242");
  expect(await buckets()).toEqual({});

  await send("generation:section:242");
  expect(await buckets()).toEqual({
    "claude-sonnet-5": { successes: 0, failures: 1 },
    "openai/gpt-6-sol": { successes: 0, failures: 1 },
  });
});
