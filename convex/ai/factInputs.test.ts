import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FACTS_AFTER_EXTRACTION_RESERVE_MS,
  factsFitBudget,
  factsTimeLeft,
} from "./condense";
import {
  callSlots,
  extractTranscriptFacts,
  FACTS_CONCURRENCY,
  FACTS_TIMEOUT_MS,
  factWindowCount,
  type FactWindowExtractor,
} from "./transcriptFactsAgent";
import { CONDENSE_TIMEOUT_MS } from "./condenseAgent";
import { ANTHROPIC_TIMEOUT_MS, CONVEX_ACTION_LIMIT_MS, RESERVED_NON_REQUEST_MS } from "./providers";
import { FACT_WINDOW_TOKENS, planFactWindows, type FactTurn } from "../lib/transcriptFacts";

afterEach(() => {
  vi.useRealTimers();
});

describe("extraction inside a generation never costs the draft (review 2026-09-25, P2-1)", () => {
  it("keeps time for the analyzer and the Brief that run after extraction", () => {
    expect(FACTS_AFTER_EXTRACTION_RESERVE_MS).toBe(ANTHROPIC_TIMEOUT_MS);
    expect(factsTimeLeft(0)).toBe(CONVEX_ACTION_LIMIT_MS - RESERVED_NON_REQUEST_MS - ANTHROPIC_TIMEOUT_MS);
    expect(factsTimeLeft(20_000)).toBe(factsTimeLeft(0) - 20_000);
  });

  it("counts extraction, today's fallback and the work after it against the action", () => {
    const left = factsTimeLeft(0);
    // Two waves of extraction fit; a third wave (the reviewed case: 12
    // windows with digests already stored) no longer does.
    expect(factsFitBudget({ factWindows: 8, fallbackWindows: 0, remainingMs: left })).toBe(true);
    expect(factsFitBudget({ factWindows: 12, fallbackWindows: 0, remainingMs: left })).toBe(false);
    // One wave of extraction and one wave of condensing fit; two of
    // extraction with a condense wave after them do not.
    expect(factsFitBudget({ factWindows: 4, fallbackWindows: 4, remainingMs: left })).toBe(true);
    expect(factsFitBudget({ factWindows: 8, fallbackWindows: 1, remainingMs: left })).toBe(false);
    // Whatever fits leaves the reserve and the non-request slack untouched.
    const worstFit = 2 * FACTS_TIMEOUT_MS;
    expect(worstFit + FACTS_AFTER_EXTRACTION_RESERVE_MS + RESERVED_NON_REQUEST_MS).toBeLessThanOrEqual(CONVEX_ACTION_LIMIT_MS);
    expect(FACTS_TIMEOUT_MS + CONDENSE_TIMEOUT_MS).toBeLessThanOrEqual(left);
    // Nothing to extract always fits; late in the action nothing else does.
    expect(factsFitBudget({ factWindows: 0, fallbackWindows: 0, remainingMs: 0 })).toBe(true);
    expect(factsFitBudget({ factWindows: 1, fallbackWindows: 0, remainingMs: factsTimeLeft(400_000) })).toBe(false);
  });

  it("counts the windows planFactWindows really makes, not characters over the window size (P3-1)", () => {
    // 2,500 short turns under 120,000 characters: each turn is charged its
    // text plus 24 for the line prefix, so this needs two windows.
    const turns: FactTurn[] = Array.from({ length: 2_500 }, (_, index) => ({
      index,
      role: "client",
      charStart: index * 47,
      charEnd: index * 47 + 45,
      cleanText: `Short answer number ${String(index).padStart(5, "0")} about ramps.`,
    }));
    const chars = turns.reduce((total, turn) => total + turn.cleanText.length, 0);
    expect(chars).toBeLessThan(FACT_WINDOW_TOKENS * 4);
    expect(factWindowCount(turns)).toBe(planFactWindows(turns).length);
    expect(factWindowCount(turns)).toBeGreaterThanOrEqual(2);
  });
});

describe("abandoned calls stop (review 2026-09-25, #8)", () => {
  const turns: FactTurn[] = Array.from({ length: 3 }, (_, index) => ({
    index,
    role: "client",
    charStart: index * 50,
    charEnd: index * 50 + 40,
    cleanText: `Client turn ${index} about the ramp forecaster.`,
  }));
  const content = turns.map((turn) => turn.cleanText.padEnd(48, " ")).join("\n\n");

  it("aborts a call that runs past its time limit", async () => {
    let aborted: AbortSignal | undefined;
    const extractWindow: FactWindowExtractor = (_lines, signal) => {
      aborted = signal;
      return new Promise(() => {});
    };
    await expect(
      extractTranscriptFacts({ content, turns, placeholders: [], extractWindow, timeoutMs: 20 })
    ).rejects.toThrow("ran past its time limit");
    expect(aborted?.aborted).toBe(true);
  });

  it("starts no new window, and aborts the ones in flight, after one fails", async () => {
    const many: FactTurn[] = Array.from({ length: 40 }, (_, index) => ({
      index,
      role: "client",
      charStart: index * 10,
      charEnd: index * 10 + 8,
      cleanText: `${index} ${"x".repeat(20_000)}`,
    }));
    const windows = planFactWindows(many).length;
    expect(windows).toBeGreaterThan(4);
    const started: AbortSignal[] = [];
    let call = 0;
    const extractWindow: FactWindowExtractor = async (_lines, signal) => {
      started.push(signal!);
      call += 1;
      if (call === 1) throw new Error("provider failed");
      return await new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    await expect(
      extractTranscriptFacts({ content: "x".repeat(400), turns: many, placeholders: [], extractWindow, concurrency: 2 })
    ).rejects.toThrow("provider failed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(started.length).toBeLessThan(windows);
    expect(started.slice(1).every((signal) => signal.aborted)).toBe(true);
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
