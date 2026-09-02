/**
 * Integration test of the ACTUAL retry loop in openRouterChatCompletion
 * (convex/ai/openrouter.ts) — the pure decision functions are unit-tested in
 * openrouterCore.test.ts, but nothing else drives the loop end-to-end with a
 * stubbed fetch. Sleeps are made instant (and their requested delays recorded)
 * by stubbing setTimeout, so backoff behavior is asserted without waiting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id, TableNames } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { openRouterChatCompletion, OpenRouterError } from "./openrouter";
import { fromChatCompletions, OPENROUTER_MAX_RETRIES } from "./openrouterCore";

const successBody = {
  choices: [
    { message: { content: "hello from gateway" }, finish_reason: "stop" },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    cost: 0.0012,
    prompt_tokens_details: { cached_tokens: 2 },
  },
};

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function fakeCtx() {
  const runAfter = vi.fn(async (..._args: unknown[]) => {});
  const runMutation = vi.fn(async (..._args: unknown[]) => {});
  const ctx = {
    scheduler: { runAfter },
    runMutation,
  } as unknown as ActionCtx;
  return { ctx, runAfter, runMutation };
}

function testId<TableName extends TableNames>(value: string): Id<TableName> {
  return value as Id<TableName>;
}

const baseInput = {
  body: { model: "openai/gpt-test", messages: [] },
  model: "openai/gpt-test",
  callSite: "retry-loop-test",
};

let fetchMock: ReturnType<typeof vi.fn>;
let sleepDelays: number[];

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Make the loop's `sleep` instant while recording the delay it asked for.
  sleepDelays = [];
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    ms?: number
  ) => {
    sleepDelays.push(ms ?? 0);
    callback();
    return 0;
  }) as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openRouterChatCompletion retry loop", () => {
  it("CAP-6: pins one retry (two attempts total) to share the generateCandidate action budget", () => {
    expect(OPENROUTER_MAX_RETRIES).toBe(1);
  });

  it("survives a 429 then succeeds on the second attempt, logging usage once", async () => {
    const { ctx, runAfter, runMutation } = fakeCtx();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(429, { error: { message: "rate limited" } }, { "retry-after": "0" })
      )
      .mockResolvedValueOnce(jsonResponse(200, successBody));

    const result = await openRouterChatCompletion(ctx, baseInput);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The 200 body parses through the same adapter the agents use.
    const parsed = fromChatCompletions(result);
    expect(parsed.content).toEqual([
      { type: "text", text: "hello from gateway" },
    ]);
    expect(parsed.stop_reason).toBe("stop");
    // Usage logged exactly once, with OpenRouter's cached-token split and cost.
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      callSite: "retry-loop-test",
      model: "openai/gpt-test",
      inputTokens: 8, // prompt_tokens minus cached_tokens
      outputTokens: 5,
      cacheReadInputTokens: 2,
      costUsd: 0.0012,
    });
  });

  it("unions one call's digests before its retry loop and attributes one candidate usage row", async () => {
    const { ctx, runAfter, runMutation } = fakeCtx();
    const generationId = testId<"generations">("openrouter-generation");
    const candidateRunId = testId<"generationCandidateRuns">(
      "openrouter-candidate",
    );
    const digestId = testId<"learningDigests">("openrouter-digest");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          429,
          { error: { message: "rate limited" } },
          { "retry-after": "0" },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(200, successBody));
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(100)
      .mockReturnValue(250);

    await openRouterChatCompletion(ctx, {
      ...baseInput,
      attribution: {
        generationId,
        candidateRunId,
        learningDigestIds: [digestId],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toEqual({
      generationId,
      digestIds: [digestId],
    });
    expect(runMutation.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      generationId,
      candidateRunId,
      durationMs: 150,
      inputTokens: 8,
      outputTokens: 5,
    });
  });

  it("keeps an explicit all-zero usage object as a genuine response", async () => {
    const { ctx, runAfter } = fakeCtx();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [{ message: { content: "zero" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          cost: 0,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      }),
    );

    await openRouterChatCompletion(ctx, baseInput);

    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0,
    });
  });

  it.each([
    ["absent", undefined],
    ["empty", {}],
    [
      "wholly malformed",
      { prompt_tokens: "bad", completion_tokens: -1, cost: Number.NaN },
    ],
  ])("does not synthesize usage for a successful response with %s usage", async (_label, usage) => {
    const { ctx, runAfter } = fakeCtx();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          { message: { content: "no usage" }, finish_reason: "stop" },
        ],
        ...(usage === undefined ? {} : { usage }),
      }),
    );

    await openRouterChatCompletion(ctx, baseInput);

    expect(runAfter).not.toHaveBeenCalled();
  });

  it("schedules genuine usage before downstream tool decoding fails", async () => {
    const { ctx, runAfter } = fakeCtx();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "broken-tool",
                  function: { name: "submit", arguments: "{" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 6, completion_tokens: 2 },
      }),
    );

    const response = await openRouterChatCompletion(ctx, baseInput);
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(() => fromChatCompletions(response)).toThrow(/malformed JSON/);
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      inputTokens: 6,
      outputTokens: 2,
    });
  });

  it("honors a numeric Retry-After header for the backoff delay", async () => {
    const { ctx } = fakeCtx();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(429, { error: { message: "slow down" } }, { "retry-after": "7" })
      )
      .mockResolvedValueOnce(jsonResponse(200, successBody));

    await openRouterChatCompletion(ctx, baseInput);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepDelays).toContain(7_000);
  });

  it("retries a 500 once and succeeds", async () => {
    const { ctx, runAfter } = fakeCtx();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { error: { message: "boom" } }))
      .mockResolvedValueOnce(jsonResponse(200, successBody));

    const result = await openRouterChatCompletion(ctx, baseInput);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.choices?.[0]?.message?.content).toBe("hello from gateway");
    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  it("retries a pre-response network failure and succeeds", async () => {
    const { ctx, runAfter } = fakeCtx();
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed: connection reset"))
      .mockResolvedValueOnce(jsonResponse(200, successBody));

    const result = await openRouterChatCompletion(ctx, baseInput);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.choices?.[0]?.message?.content).toBe("hello from gateway");
    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget (2 attempts) of 429 and surfaces the status without logging usage", async () => {
    const { ctx, runAfter, runMutation } = fakeCtx();
    fetchMock.mockImplementation(async () =>
      jsonResponse(429, { error: { message: "still rate limited" } }, { "retry-after": "0" })
    );

    const error = await openRouterChatCompletion(ctx, baseInput).catch(
      (caught) => caught
    );
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.status).toBe(429);
    expect(error.message).toContain("still rate limited");
    // Attempt count tracks the exported policy, not a number copied here.
    expect(fetchMock).toHaveBeenCalledTimes(OPENROUTER_MAX_RETRIES + 1);
    expect(runAfter).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("gives up after the retry budget (2 attempts) when the network keeps failing", async () => {
    const { ctx, runAfter } = fakeCtx();
    fetchMock.mockRejectedValue(new TypeError("fetch failed: DNS"));

    await expect(openRouterChatCompletion(ctx, baseInput)).rejects.toThrow(
      /DNS/
    );
    expect(fetchMock).toHaveBeenCalledTimes(OPENROUTER_MAX_RETRIES + 1);
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("retains the digest handoff but writes no usage when every transport attempt fails", async () => {
    const { ctx, runAfter, runMutation } = fakeCtx();
    const generationId = testId<"generations">("failed-openrouter-generation");
    const digestId = testId<"learningDigests">("failed-openrouter-digest");
    fetchMock.mockRejectedValue(new TypeError("fetch failed: offline"));

    await expect(
      openRouterChatCompletion(ctx, {
        ...baseInput,
        attribution: { generationId, learningDigestIds: [digestId] },
      }),
    ).rejects.toThrow(/offline/);

    expect(fetchMock).toHaveBeenCalledTimes(OPENROUTER_MAX_RETRIES + 1);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not start the OpenRouter retry loop when the required digest union fails", async () => {
    const { ctx, runAfter, runMutation } = fakeCtx();
    runMutation.mockRejectedValueOnce(new Error("digest union unavailable"));

    await expect(
      openRouterChatCompletion(ctx, {
        ...baseInput,
        attribution: {
          generationId: testId<"generations">("openrouter-union-failure"),
          learningDigestIds: [
            testId<"learningDigests">("openrouter-union-failure-digest"),
          ],
        },
      }),
    ).rejects.toThrow("digest union unavailable");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("fails fast on a 401 without retrying or logging usage", async () => {
    const { ctx, runAfter } = fakeCtx();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: "bad key" } })
    );

    const error = await openRouterChatCompletion(ctx, baseInput).catch(
      (caught) => caught
    );
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.status).toBe(401);
    expect(error.message).toContain("bad key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("surfaces a non-JSON gateway error body instead of a status-only error", async () => {
    const { ctx } = fakeCtx();
    fetchMock.mockResolvedValueOnce(
      new Response("<!DOCTYPE html>Bad gateway page", { status: 400 })
    );

    await expect(openRouterChatCompletion(ctx, baseInput)).rejects.toThrow(
      /status 400: <!DOCTYPE html>Bad gateway page/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a timed-out attempt fails fast with the default 180s budget in the message", async () => {
    const { ctx, runAfter } = fakeCtx();
    const timeoutError = new Error("The operation timed out");
    timeoutError.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeoutError);

    await expect(openRouterChatCompletion(ctx, baseInput)).rejects.toThrow(
      /timed out after 180000ms/
    );
    // No retry: a timed-out attempt already spent its whole budget.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("a timed-out attempt reports a caller-supplied timeoutMs", async () => {
    const { ctx } = fakeCtx();
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    fetchMock.mockRejectedValue(abortError);

    await expect(
      openRouterChatCompletion(ctx, { ...baseInput, timeoutMs: 1_234 })
    ).rejects.toThrow(/timed out after 1234ms/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
