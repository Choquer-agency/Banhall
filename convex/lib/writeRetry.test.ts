import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { startActionDeadline, ACTION_REQUEST_WINDOW_MS } from "../ai/actionDeadline";
import { withWriteRetries } from "./writeRetry";

const REFUSED = new Error('{"code":"TooManyWrites","message":"Too many writes per second."}');

describe("withWriteRetries (owner, 2026-10-28, question 14)", () => {
  it("sends a refused mutation again with the same arguments, and leaves the rest of ctx as it was", async () => {
    vi.useFakeTimers();
    try {
      const runMutation = vi.fn().mockRejectedValueOnce(REFUSED).mockResolvedValueOnce("written");
      const runQuery = vi.fn();
      const ctx = withWriteRetries({ runMutation, runQuery, scheduler: { runAfter: vi.fn(), runAt: vi.fn(), cancel: vi.fn() } } as unknown as ActionCtx);
      const pending = ctx.runMutation("generations:beginGeneration" as never, { generationId: "g1" } as never);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe("written");
      expect(runMutation.mock.calls).toEqual([
        ["generations:beginGeneration", { generationId: "g1" }],
        ["generations:beginGeneration", { generationId: "g1" }],
      ]);
      expect(ctx.runQuery).toBe(runQuery);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a refused schedule again too, and keeps cancel as it was (review, 2026-10-28)", async () => {
    vi.useFakeTimers();
    try {
      const runAfter = vi.fn().mockRejectedValueOnce(REFUSED).mockResolvedValueOnce("job-1");
      const runAt = vi.fn().mockRejectedValueOnce(REFUSED).mockResolvedValueOnce("job-2");
      const cancel = vi.fn();
      const ctx = withWriteRetries({ runMutation: vi.fn(), scheduler: { runAfter, runAt, cancel } } as unknown as ActionCtx);
      const after = ctx.scheduler.runAfter(0, "ai/pipeline:generateCandidate" as never, { candidateRunId: "c1" } as never);
      const at = ctx.scheduler.runAt(1_000, "ai/pipeline:generateCandidate" as never, { candidateRunId: "c2" } as never);
      await vi.runAllTimersAsync();
      await expect(after).resolves.toBe("job-1");
      await expect(at).resolves.toBe("job-2");
      expect(runAfter).toHaveBeenCalledTimes(2);
      expect(runAfter.mock.calls[1]).toEqual([0, "ai/pipeline:generateCandidate", { candidateRunId: "c1" }]);
      expect(runAt).toHaveBeenCalledTimes(2);
      expect(ctx.scheduler.cancel).toBe(cancel);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never sends any other failure again", async () => {
    const other = new Error("This generation is no longer active");
    const runMutation = vi.fn().mockRejectedValue(other);
    const ctx = withWriteRetries({ runMutation } as unknown as ActionCtx);
    await expect(ctx.runMutation("generations:failGeneration" as never, {} as never)).rejects.toBe(other);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("takes no wait that would run into the Convex action limit: the refusal is thrown at once (review, 2026-10-28)", async () => {
    const runMutation = vi.fn().mockRejectedValue(REFUSED);
    const ctx = withWriteRetries({ runMutation } as unknown as ActionCtx);
    // An action started long enough ago that its request window is over and
    // less than the end margin is left before the Convex limit.
    startActionDeadline(ctx, Date.now() - ACTION_REQUEST_WINDOW_MS - 50_000);
    await expect(ctx.runMutation("generations:failGeneration" as never, {} as never)).rejects.toBe(REFUSED);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });
});
