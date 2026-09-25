/// <reference types="vite/client" />

/**
 * Thinking room for Claude models whose thinking is always on (2026-09-25,
 * cutoff review P2-1). Only `fetch` is stubbed: the Anthropic SDK, the
 * direct-gateway adapter and the Convex scheduler are the production ones.
 *
 * - Opus 5.5 (and Fable 5.1) think on every direct request, and the thinking
 *   is billed from max_tokens. The 4,096-token judge answers (QA, Self-check,
 *   consistency, chronology) are sent with the answer budget times
 *   REASONING_TOKEN_MULTIPLIER, within the model's 128K output cap. The
 *   cut-off repair is sent with the same room.
 * - Every other model's request body is byte-identical to what it was.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic } from "./instrument";
import { generateStructured } from "./structured";
import { QA_REQUEST } from "./qaAgent";
import { CHRONOLOGY_REQUEST, runChronologyAgent } from "./chronologyAgent";
import { CONSISTENCY_REQUEST, SELF_CHECK_REQUEST } from "./promptDefinitions";
import type { TranscriptAnalysis } from "./analyzerAgent";
import {
  ALWAYS_THINKING_MAX_OUTPUT_TOKENS,
  REASONING_TOKEN_MULTIPLIER,
  alwaysThinkingMaxTokens,
  registerModelEntries,
  resetRegisteredModelEntries,
} from "../../shared/generationModels";

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-headroom-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  resetRegisteredModelEntries();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type WireBody = Record<string, unknown> & { max_tokens: number; model: string };

function reply(model: string, stopReason: string, toolName: string, input: unknown) {
  return Response.json({
    id: `msg_${stopReason}`,
    type: "message",
    role: "assistant",
    model,
    content: [
      { type: "thinking", thinking: "", signature: "sig-synthetic" },
      { type: "tool_use", id: "tool_synthetic", name: toolName, input },
    ],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  });
}

const judge = (model: string, maxTokens: number) => ({
  system: "Judge the draft.",
  user: "The seal failed at 4.2 bar.",
  toolName: "submit_judgement",
  description: "Return the judgement.",
  schema: { type: "object" as const, properties: { ok: { type: "boolean" } }, required: ["ok"] },
  maxTokens,
  model,
});

test("the judges' 4,096-token answer caps are unchanged as declared", () => {
  expect([QA_REQUEST.maxTokens, SELF_CHECK_REQUEST.maxTokens, CONSISTENCY_REQUEST.maxTokens, CHRONOLOGY_REQUEST.maxTokens])
    .toEqual([4096, 4096, 4096, 4096]);
});

test("Opus 5.5 and Fable 5.1: a 4,096-token judge answer is sent with room for thinking, and so is its cut-off repair", async () => {
  const t = convexTest(schema, modules);
  const bodies: WireBody[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const body = await new Request(input, init).json() as WireBody;
    bodies.push(body);
    // Each model's first answer is cut off; the repair completes.
    const firstForModel = bodies.filter((sent) => sent.model === body.model).length === 1;
    return reply(body.model, firstForModel ? "max_tokens" : "tool_use", "submit_judgement", { ok: true });
  }));
  const values = await runAction(t, async (ctx) => {
    const client = instrumentedAnthropic(ctx, { callSite: "headroom-contract" });
    return [
      await generateStructured(client, judge("claude-opus-5-5", QA_REQUEST.maxTokens)),
      await generateStructured(client, judge("claude-fable-5-1", SELF_CHECK_REQUEST.maxTokens)),
    ];
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(values).toEqual([{ ok: true }, { ok: true }]);
  expect(bodies.map((body) => [body.model, body.max_tokens])).toEqual([
    ["claude-opus-5-5", 4096 * REASONING_TOKEN_MULTIPLIER],
    ["claude-opus-5-5", 4096 * REASONING_TOKEN_MULTIPLIER],
    ["claude-fable-5-1", 4096 * REASONING_TOKEN_MULTIPLIER],
    ["claude-fable-5-1", 4096 * REASONING_TOKEN_MULTIPLIER],
  ]);
  expect(4096 * REASONING_TOKEN_MULTIPLIER).toBe(16_384);
});

test("the real chronology call site sends Opus 5.5 its answer cap with thinking room, and Sonnet 5 its cap as is", async () => {
  const t = convexTest(schema, modules);
  const bodies: WireBody[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const body = await new Request(input, init).json() as WireBody;
    bodies.push(body);
    return reply(body.model, "tool_use", CHRONOLOGY_REQUEST.toolName, { entries: [] });
  }));
  const analysis = { uncertainties: ["Seal fatigue."] } as unknown as TranscriptAnalysis;
  await runAction(t, async (ctx) => {
    const client = instrumentedAnthropic(ctx, { callSite: "headroom-contract" }) as never;
    await runChronologyAgent(client, analysis, "claude-opus-5-5");
    await runChronologyAgent(client, analysis, "claude-sonnet-5");
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(bodies.map((body) => [body.model, body.max_tokens])).toEqual([
    ["claude-opus-5-5", 16_384],
    ["claude-sonnet-5", 4096],
  ]);
});

test("models that do not always think: the request body is byte-identical to the one generateStructured builds", async () => {
  const t = convexTest(schema, modules);
  const raw: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const text = await new Request(input, init).text();
    raw.push(text);
    return reply((JSON.parse(text) as WireBody).model, "tool_use", "submit_judgement", { ok: true });
  }));
  const models = ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"];
  await runAction(t, async (ctx) => {
    const client = instrumentedAnthropic(ctx, { callSite: "headroom-contract" });
    for (const model of models) await generateStructured(client, judge(model, 4096));
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const schemaJson = JSON.stringify(judge("", 0).schema);
  expect(raw).toEqual(models.map((model) =>
    `{"model":"${model}","max_tokens":4096,"system":"Judge the draft.","tools":[{"name":"submit_judgement","description":"Return the judgement.","input_schema":${schemaJson}}],"tool_choice":{"type":"tool","name":"submit_judgement"},"messages":[{"role":"user","content":"The seal failed at 4.2 bar."}]}`
  ));
});

test("the thinking room stays inside the model's output cap", () => {
  expect(alwaysThinkingMaxTokens("claude-opus-5-5", 4096)).toBe(16_384);
  expect(alwaysThinkingMaxTokens("claude-opus-5-5", 40_000)).toBe(ALWAYS_THINKING_MAX_OUTPUT_TOKENS);
  // A caller asking for more than the cap is never lowered.
  expect(alwaysThinkingMaxTokens("claude-opus-5-5", 200_000)).toBe(200_000);
  // A catalog entry that rejects forced tool calls and declares its own cap.
  registerModelEntries([{
    id: "claude-future-thinker",
    label: "Future",
    provider: "Anthropic",
    gateway: "anthropic",
    forcedToolChoice: false,
    maxCompletionTokens: 20_000,
  }]);
  expect(alwaysThinkingMaxTokens("claude-future-thinker", 4096)).toBe(16_384);
  expect(alwaysThinkingMaxTokens("claude-future-thinker", 8192)).toBe(20_000);
  // Models that accept forced tool calls do not always think: unchanged.
  for (const id of ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001", "unknown-model"]) {
    expect(alwaysThinkingMaxTokens(id, 4096), id).toBe(4096);
  }
});

test("the evaluation spending ceiling counts the thinking room the direct gateway sends", async () => {
  const { maxRequestOutputTokens } = await import("../../shared/modelCatalog");
  const { EVAL_ENVELOPE } = await import("./modelEvaluation");
  const qa = EVAL_ENVELOPE.qa_structured;
  const seed = EVAL_ENVELOPE.seed_batch;
  const thinking = { gateway: "anthropic" as const, reasoning: false, alwaysThinks: true };
  const plain = { gateway: "anthropic" as const, reasoning: false };
  expect(maxRequestOutputTokens(thinking, qa)).toBe(alwaysThinkingMaxTokens("claude-opus-5-5", qa.answerTokens.anthropic));
  expect(maxRequestOutputTokens(thinking, seed)).toBe(alwaysThinkingMaxTokens("claude-opus-5-5", seed.answerTokens.anthropic));
  expect(maxRequestOutputTokens(plain, qa)).toBe(qa.answerTokens.anthropic);
});
