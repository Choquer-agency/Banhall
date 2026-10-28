import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { withWriteRetries } from "./writeRetry";

const REFUSED = new Error('{"code":"TooManyWrites","message":"Too many writes per second."}');

describe("withWriteRetries (owner, 2026-10-28, question 14)", () => {
  it("sends a refused mutation again with the same arguments, and leaves the rest of ctx as it was", async () => {
    vi.useFakeTimers();
    try {
      const runMutation = vi.fn().mockRejectedValueOnce(REFUSED).mockResolvedValueOnce("written");
      const runQuery = vi.fn();
      const scheduler = { runAfter: vi.fn() };
      const ctx = withWriteRetries({ runMutation, runQuery, scheduler } as unknown as ActionCtx);
      const pending = ctx.runMutation("generations:beginGeneration" as never, { generationId: "g1" } as never);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe("written");
      expect(runMutation.mock.calls).toEqual([
        ["generations:beginGeneration", { generationId: "g1" }],
        ["generations:beginGeneration", { generationId: "g1" }],
      ]);
      expect(ctx.runQuery).toBe(runQuery);
      expect(ctx.scheduler).toBe(scheduler);
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
});
