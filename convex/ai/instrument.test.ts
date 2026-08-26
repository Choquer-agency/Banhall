/**
 * Drives the ACTUAL instrumentedAnthropic proxy (convex/ai/instrument.ts)
 * with a stubbed SDK client so the CAP-9 attribution fields
 * (generationId / candidateRunId / durationMs) are asserted on the scheduled
 * logUsage payload, not just accepted by the mutation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const createMock = vi.fn();
vi.mock("./providers", () => ({
  createAnthropicClient: () => ({
    messages: { create: createMock },
  }),
}));

import { instrumentedAnthropic } from "./instrument";

function fakeCtx() {
  const runAfter = vi.fn(async (..._args: unknown[]) => {});
  const runMutation = vi.fn(async (..._args: unknown[]) => {});
  const ctx = {
    scheduler: { runAfter },
    runMutation,
  } as unknown as ActionCtx;
  return { ctx, runAfter, runMutation };
}

const response = {
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3 },
};

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue(response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("instrumentedAnthropic attribution", () => {
  it("schedules logUsage with generationId, candidateRunId and durationMs", async () => {
    const { ctx, runAfter, runMutation } = fakeCtx();
    const generationId = "gen_1" as Id<"generations">;
    const candidateRunId = "run_1" as Id<"generationCandidateRuns">;
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:242",
      projectId: "proj_1" as Id<"projects">,
      generationId,
      candidateRunId,
    });

    const result = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 10,
      messages: [],
    });

    expect(result).toBe(response);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runMutation).not.toHaveBeenCalled();
    const payload = runAfter.mock.calls[0][2] as Record<string, unknown>;
    expect(payload).toMatchObject({
      callSite: "generation:242",
      projectId: "proj_1",
      generationId,
      candidateRunId,
      model: "claude-sonnet-5",
      inputTokens: 12,
      outputTokens: 7,
      cacheReadInputTokens: 3,
    });
    expect(typeof payload.durationMs).toBe("number");
    expect(payload.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it("measures durationMs around the whole SDK call", async () => {
    const { ctx, runAfter } = fakeCtx();
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    createMock.mockImplementation(async () => {
      now += 250;
      return response;
    });
    const client = instrumentedAnthropic(ctx, {
      callSite: "generation:qa",
      generationId: "gen_2" as Id<"generations">,
    });
    await client.messages.create({ model: "m", max_tokens: 1, messages: [] });
    const payload = runAfter.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.durationMs).toBe(250);
    expect(payload.generationId).toBe("gen_2");
    expect(payload).not.toHaveProperty("candidateRunId");
  });

  it("omits attribution keys when the call site has no generation", async () => {
    const { ctx, runAfter } = fakeCtx();
    const client = instrumentedAnthropic(ctx, { callSite: "chat" });
    await client.messages.create({ model: "m", max_tokens: 1, messages: [] });
    const payload = runAfter.mock.calls[0][2] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("generationId");
    expect(payload).not.toHaveProperty("candidateRunId");
    expect(typeof payload.durationMs).toBe("number");
  });
});
