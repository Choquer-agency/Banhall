/// <reference types="vite/client" />

/**
 * Fact extraction feeds the model catalog's error rate honestly (review
 * 2026-09-25, p3e section B). Only `fetch` is stubbed; the SDK, the
 * OpenRouter transport, the outcome wrappers and the recording mutation are
 * the production ones.
 *
 * - P3-a: every citations-mode request records exactly one outcome, settled
 *   after its answer is parsed.
 * - P3-b: a request the extraction itself gave up on (a sibling window
 *   failed, or its time limit passed) records nothing, is never retried, and
 *   is reported as aborted, not timed out.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { ensureTranscriptFacts } from "./ai/condense";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { openRouterChatCompletion } from "./ai/openrouter";
import { citationsExtractor } from "./ai/transcriptFactsAgent";
import { instrumentedAnthropic } from "./ai/instrument";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

const ANTHROPIC_MODEL = "claude-sonnet-5";
const OPENROUTER_MODEL = "openai/gpt-5.6-sol";

const SHORT = [
  "Dana Whitfield: What made the forecast hard?",
  "Priya Shah: We couldn't forecast net load fast enough when cloud cover changed.",
].join("\n\n");

/** Many client turns, so one extraction makes several windows at once. */
const LONG = Array.from(
  { length: 24 },
  (_, index) => `Priya Shah: Trial ${index} of the ramp forecaster. ${`Reading ${index} held steady. `.repeat(560)}`
).join("\n\n");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-outcome-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-outcome-openrouter");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(content: string) {
  const t = convexTest(schema, modules);
  const { projectId } = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "fo-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "fo-token",
      createdAt: 1,
      updatedAt: 1,
      interviewer: "Dana Whitfield",
      interviewees: ["Priya Shah"],
    });
    await ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: "all", updatedBy: writerId, updatedAt: 1 });
    return { projectId };
  });
  const writer = t.withIdentity({ subject: "fo-writer" });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  const transcriptId = await writer.mutation(api.transcripts.addTranscript, { projectId, content, label: "call.txt" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const generationId: Id<"generations"> = await writer.mutation(api.generations.requestGeneration, {
    projectId,
    candidateMode: "iterative",
  });
  // Only the extraction under test runs: the reserved pipeline never starts.
  await t.run(async (ctx) => {
    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    }
  });
  return { t, projectId, transcriptId, generationId };
}

async function outcomes(t: T) {
  return await t.run(async (ctx) => ({
    rows: (await ctx.db.query("modelCallOutcomes").collect()).map((row) => [row.model, row.outcome]),
    buckets: (await ctx.db.query("modelCallBuckets").collect()).map((row) => ({
      model: row.model,
      successes: row.successes,
      failures: row.failures,
      lastFailureCode: row.lastFailureCode,
      lastFailureCallSite: row.lastFailureCallSite,
    })),
  }));
}

function citationsAnswer(stopReason: "end_turn" | "max_tokens" = "end_turn") {
  return Response.json({
    id: "msg_outcome",
    type: "message",
    role: "assistant",
    model: ANTHROPIC_MODEL,
    content: [
      { type: "text", text: "uncertainty | " },
      {
        type: "text",
        text: "They could not forecast net load fast enough when cloud cover changed",
        citations: [
          {
            type: "content_block_location",
            cited_text: "We couldn't forecast net load fast enough when cloud cover changed.",
            document_index: 0,
            document_title: "Interview transcript window",
            start_block_index: 1,
            end_block_index: 2,
          },
        ],
      },
      { type: "text", text: "\nresult | half a cla" },
    ],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 80, output_tokens: 30 },
  });
}

/** A request that answers only when its caller aborts it, as fetch does. */
function hangUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    const signal = init?.signal;
    const fail = () => reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    if (signal?.aborted) fail();
    else signal?.addEventListener("abort", fail, { once: true });
  });
}

describe("P3-a: citations-mode extraction records one outcome per request", () => {
  it("records a success for a parsed answer, at the generation's facts slot", async () => {
    const f = await setup(SHORT);
    const fetchMock = vi.fn(async () => citationsAnswer());
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await f.t.action(async (ctx) =>
      ensureTranscriptFacts(ctx, f.transcriptId, { kind: "generation", generationId: f.generationId, modelId: ANTHROPIC_MODEL })
    );
    expect(outcome).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await outcomes(f.t)).toEqual({
      rows: [[ANTHROPIC_MODEL, "success"]],
      buckets: [{ model: ANTHROPIC_MODEL, successes: 1, failures: 0, lastFailureCode: undefined, lastFailureCallSite: undefined }],
    });
  });

  it("records one failure for an answer cut off at max_tokens, even though its complete lines are kept", async () => {
    const f = await setup(SHORT);
    vi.stubGlobal("fetch", vi.fn(async () => citationsAnswer("max_tokens")));
    const outcome = await f.t.action(async (ctx) =>
      ensureTranscriptFacts(ctx, f.transcriptId, { kind: "generation", generationId: f.generationId, modelId: ANTHROPIC_MODEL })
    );
    expect(outcome).toBe("ready");
    const recorded = await outcomes(f.t);
    expect(recorded.rows).toEqual([[ANTHROPIC_MODEL, "failure"]]);
    expect(recorded.buckets[0]).toMatchObject({ lastFailureCode: "output_limit", lastFailureCallSite: "generation:facts" });
  });

  it("records one failure for a model fault, and nothing for a rate limit", async () => {
    const fault = await setup(SHORT);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ type: "error", error: { type: "invalid_request_error", message: "bad document" } }, { status: 400 }))
    );
    const failed = await fault.t.action(async (ctx) =>
      ensureTranscriptFacts(ctx, fault.transcriptId, { kind: "generation", generationId: fault.generationId, modelId: ANTHROPIC_MODEL })
    );
    expect(failed).toBe("failed");
    expect((await outcomes(fault.t)).rows).toEqual([[ANTHROPIC_MODEL, "failure"]]);

    const limited = await setup(SHORT);
    // The SDK waits before its one retry of a 429: real time, a short wait.
    vi.useRealTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ type: "error", error: { type: "rate_limit_error", message: "rate limit" } }, { status: 429, headers: { "retry-after": "0" } })
      )
    );
    await limited.t.action(async (ctx) =>
      ensureTranscriptFacts(ctx, limited.transcriptId, {
        kind: "generation",
        generationId: limited.generationId,
        modelId: ANTHROPIC_MODEL,
      })
    );
    expect((await outcomes(limited.t)).rows).toEqual([]);
  });

  it("negative control: the bare client the extraction used before records nothing", async () => {
    const f = await setup(SHORT);
    vi.stubGlobal("fetch", vi.fn(async () => citationsAnswer()));
    await f.t.action(async (ctx) => {
      const bare = instrumentedAnthropic(ctx, { callSite: "generation:facts", capability: "generation" });
      await citationsExtractor(bare, ANTHROPIC_MODEL)([{ turnIndex: 0, text: "[T0000] (client) We tested it." }]);
    });
    expect((await outcomes(f.t)).rows).toEqual([]);
  });
});

describe("P3-b: requests the extraction gave up on are not the model's failures", () => {
  it("records only the failing window when it aborts its siblings, and never retries them", async () => {
    const f = await setup(LONG);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes("openrouter.ai")) throw new Error(`Unexpected ${url}`);
        calls.push(url);
        // The first window fails at once (a model fault); the others hang
        // until the extraction aborts them.
        if (calls.length === 1) return new Response(JSON.stringify({ error: { message: "bad window" } }), { status: 400 });
        return await hangUntilAborted(init);
      })
    );
    const outcome = await f.t.action(async (ctx) =>
      ensureTranscriptFacts(ctx, f.transcriptId, { kind: "generation", generationId: f.generationId, modelId: OPENROUTER_MODEL })
    );
    expect(outcome).toBe("failed");
    // Four windows were in flight; the three aborted ones were not retried.
    expect(calls).toHaveLength(4);
    const recorded = await outcomes(f.t);
    expect(recorded.rows).toEqual([[OPENROUTER_MODEL, "failure"]]);
    expect(recorded.buckets[0]).toMatchObject({ failures: 1, lastFailureCallSite: "generation:facts" });
  });

  it("records nothing for a call aborted at its time limit, on either gateway", async () => {
    for (const modelId of [OPENROUTER_MODEL, ANTHROPIC_MODEL]) {
      const f = await setup(SHORT);
      vi.useRealTimers();
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => await hangUntilAborted(init));
      vi.stubGlobal("fetch", fetchMock);
      const outcome = await f.t.action(async (ctx) =>
        ensureTranscriptFacts(ctx, f.transcriptId, { kind: "generation", generationId: f.generationId, modelId }, { timeoutMs: 40 })
      );
      expect(outcome).toBe("failed");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await outcomes(f.t)).rows).toEqual([]);
      vi.useFakeTimers();
    }
  });

  it("reports an OpenRouter request its caller aborted as aborted, not timed out, and does not send it again", async () => {
    const f = await setup(SHORT);
    vi.useRealTimers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => await hangUntilAborted(init));
    vi.stubGlobal("fetch", fetchMock);
    const caller = new AbortController();
    const error = await f.t.action(async (ctx) => {
      const pending = openRouterChatCompletion(ctx, {
        body: { model: OPENROUTER_MODEL, messages: [] },
        model: OPENROUTER_MODEL,
        callSite: "generation:facts",
        timeoutMs: 150_000,
        signal: caller.signal,
      });
      setTimeout(() => caller.abort(new Error("a plain reason")), 20);
      try {
        await pending;
        return null;
      } catch (thrown) {
        return { name: (thrown as Error).name, message: (thrown as Error).message };
      }
    });
    expect(error).toEqual({ name: "AbortError", message: "OpenRouter request aborted by the caller" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Already aborted: nothing is sent at all.
    fetchMock.mockClear();
    const aborted = AbortSignal.abort(new DOMException("gone", "AbortError"));
    const before = await f.t.action(async (ctx) => {
      try {
        await openRouterChatCompletion(ctx, {
          body: { model: OPENROUTER_MODEL, messages: [] },
          model: OPENROUTER_MODEL,
          callSite: "generation:facts",
          signal: aborted,
        });
        return null;
      } catch (thrown) {
        return (thrown as Error).name;
      }
    });
    expect(before).toBe("AbortError");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
