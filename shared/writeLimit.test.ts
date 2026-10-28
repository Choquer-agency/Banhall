import { describe, expect, it, vi } from "vitest";
import {
  WRITE_RETRY_DELAYS_MS,
  isWriteRateLimitError,
  retryOnWriteLimit,
} from "./writeLimit";

// As an action and the HTTP client saw it on the F5 stress run (2026-10-27).
const REFUSED = new Error(
  '{"code":"TooManyWrites","message":"Too many writes per second. Your deployment is limited to 4 MiB bytes written per second. Reduce your write rate or upgrade to a larger deployment."}'
);

describe("isWriteRateLimitError", () => {
  it("knows the write rate's refusal by its words only", () => {
    expect(isWriteRateLimitError(REFUSED)).toBe(true);
    expect(isWriteRateLimitError(new Error("[CONVEX M(generations:requestGeneration)] Too many writes per second."))).toBe(true);
    // The code alone is not enough: it may also name one function's own write limit (review, 2026-10-28).
    expect(isWriteRateLimitError("TooManyWrites")).toBe(false);
    expect(isWriteRateLimitError(new Error('{"code":"TooManyWrites","message":"Too many writes in a single function execution"}'))).toBe(false);
    expect(isWriteRateLimitError(new Error("The AI provider is rate-limiting requests."))).toBe(false);
    expect(isWriteRateLimitError(new Error("Too many bytes read in a single function execution"))).toBe(false);
    expect(isWriteRateLimitError(undefined)).toBe(false);
  });
});

describe("retryOnWriteLimit", () => {
  const instant = () => {
    const waits: number[] = [];
    return { waits, options: { wait: async (ms: number) => void waits.push(ms), random: () => 0.5 } };
  };

  it("sends again after each refusal until the write goes through", async () => {
    const { waits, options } = instant();
    const send = vi.fn().mockRejectedValueOnce(REFUSED).mockRejectedValueOnce(REFUSED).mockResolvedValueOnce("begun");
    await expect(retryOnWriteLimit(send, options)).resolves.toBe("begun");
    expect(send).toHaveBeenCalledTimes(3);
    // Each wait stretched by a quarter here (random 0.5 of half the wait).
    expect(waits).toEqual([312, 625]);
  });

  it("throws the last refusal after every wait is spent", async () => {
    const { waits, options } = instant();
    const send = vi.fn().mockRejectedValue(REFUSED);
    await expect(retryOnWriteLimit(send, options)).rejects.toBe(REFUSED);
    expect(send).toHaveBeenCalledTimes(WRITE_RETRY_DELAYS_MS.length + 1);
    expect(waits).toHaveLength(WRITE_RETRY_DELAYS_MS.length);
  });

  it("throws the refusal at once when a wait is not allowed (an action near its limit)", async () => {
    const { waits, options } = instant();
    const send = vi.fn().mockRejectedValue(REFUSED);
    await expect(retryOnWriteLimit(send, { ...options, mayWait: () => false })).rejects.toBe(REFUSED);
    expect(send).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("never sends again on any other error", async () => {
    const { waits, options } = instant();
    const other = new Error("Generation not found");
    const send = vi.fn().mockRejectedValue(other);
    await expect(retryOnWriteLimit(send, options)).rejects.toBe(other);
    expect(send).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("waits between 1 and 1.5 times each step, so starts refused together spread out", async () => {
    const waits: number[] = [];
    const send = vi.fn().mockRejectedValueOnce(REFUSED).mockResolvedValueOnce("ok");
    await retryOnWriteLimit(send, { wait: async (ms) => void waits.push(ms), random: () => 0 });
    await retryOnWriteLimit(vi.fn().mockRejectedValueOnce(REFUSED).mockResolvedValueOnce("ok"), {
      wait: async (ms) => void waits.push(ms),
      random: () => 0.999,
    });
    expect(waits).toEqual([250, 374]);
  });
});
