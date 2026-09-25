import { describe, expect, it } from "vitest";
import { estimateCondenseWindows, estimateFactWindows, factsFitBudget } from "./condense";
import { callSlots, FACTS_CONCURRENCY, FACTS_TIMEOUT_MS } from "./transcriptFactsAgent";
import { CONDENSE_TIMEOUT_MS } from "./condenseAgent";
import { CONVEX_ACTION_LIMIT_MS, RESERVED_NON_REQUEST_MS } from "./providers";

const available = CONVEX_ACTION_LIMIT_MS - RESERVED_NON_REQUEST_MS;

describe("extraction inside a generation never costs the draft (plan step 7)", () => {
  it("counts windows from the frozen text length", () => {
    expect(estimateFactWindows(1)).toBe(1);
    expect(estimateFactWindows(120_000)).toBe(1);
    expect(estimateFactWindows(120_001)).toBe(2);
    expect(estimateCondenseWindows(100_000)).toBe(1);
    // splitIntoWindows cuts at blank lines, so a long text may need one more.
    expect(estimateCondenseWindows(400_000)).toBe(4);
  });

  it("fits only when extraction and today's fallback both fit the time left", () => {
    // One wave of extraction and one of condensing.
    expect(factsFitBudget({ factWindows: 4, fallbackWindows: 4, remainingMs: available })).toBe(true);
    expect(FACTS_TIMEOUT_MS + CONDENSE_TIMEOUT_MS).toBeLessThanOrEqual(available);
    // Three waves of extraction alone fit, but not with a fallback wave after.
    expect(factsFitBudget({ factWindows: 12, fallbackWindows: 0, remainingMs: available })).toBe(true);
    expect(factsFitBudget({ factWindows: 12, fallbackWindows: 1, remainingMs: available })).toBe(false);
    // Nothing to extract always fits.
    expect(factsFitBudget({ factWindows: 0, fallbackWindows: 0, remainingMs: 0 })).toBe(true);
  });
});

describe("calls across transcripts share one cap", () => {
  it("never runs more than the limit at once and runs every task", async () => {
    const slots = callSlots(FACTS_CONCURRENCY);
    let active = 0;
    let peak = 0;
    const finished: number[] = [];
    await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        slots.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, index % 3));
          active -= 1;
          finished.push(index);
          return index;
        })
      )
    );
    expect(peak).toBe(FACTS_CONCURRENCY);
    expect(finished.sort((a, b) => a - b)).toEqual(Array.from({ length: 11 }, (_, index) => index));
  });

  it("frees the slot when a task fails", async () => {
    const slots = callSlots(1);
    await expect(slots.run(async () => { throw new Error("provider failed"); })).rejects.toThrow("provider failed");
    await expect(slots.run(async () => "next")).resolves.toBe("next");
  });
});
