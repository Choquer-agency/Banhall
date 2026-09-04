import { describe, expect, test, vi } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { computeEditDistance, recordReportEditDistance } from "./editDistance";

describe("computeEditDistance", () => {
  test("identical text scores an untouched draft", () => {
    const text = "The team ran a trial.\n\nResults were inconclusive.";
    const r = computeEditDistance(text, text);
    expect(r.ped).toBe(0);
    expect(r.wordSimilarity).toBe(1);
    expect(r.paragraphsTotal).toBe(2);
    expect(r.paragraphsUnchanged).toBe(2);
    expect(r.draftWords).toBe(r.currentWords);
  });

  test("a full rewrite scores near 1 with no unchanged paragraphs", () => {
    const r = computeEditDistance(
      "alpha beta gamma delta",
      "zulu yankee xray whiskey"
    );
    expect(r.ped).toBe(1);
    expect(r.wordSimilarity).toBe(0);
    expect(r.paragraphsTotal).toBe(1);
    expect(r.paragraphsUnchanged).toBe(0);
  });

  test("both empty is treated as unchanged", () => {
    const r = computeEditDistance("", "");
    expect(r.wordSimilarity).toBe(1);
    expect(r.ped).toBe(0);
    expect(r.draftWords).toBe(0);
    expect(r.currentWords).toBe(0);
    expect(r.paragraphsTotal).toBe(0);
    expect(r.paragraphsUnchanged).toBe(0);
  });

  test("empty draft against real current text is fully rewritten", () => {
    const r = computeEditDistance("", "some new prose here");
    expect(r.wordSimilarity).toBe(0);
    expect(r.ped).toBe(1);
    expect(r.draftWords).toBe(0);
    expect(r.currentWords).toBe(4);
    expect(r.paragraphsTotal).toBe(0);
  });

  test("emptied current text against a real draft is fully rewritten", () => {
    const r = computeEditDistance("some old prose here", "");
    expect(r.wordSimilarity).toBe(0);
    expect(r.ped).toBe(1);
    expect(r.draftWords).toBe(4);
    expect(r.currentWords).toBe(0);
    expect(r.paragraphsTotal).toBe(1);
    expect(r.paragraphsUnchanged).toBe(0);
  });

  test("paragraphs split on both single and blank-line separators", () => {
    const draft = "one\ntwo\n\nthree";
    const r = computeEditDistance(draft, "one\n\ntwo\nthree");
    expect(r.paragraphsTotal).toBe(3);
    expect(r.paragraphsUnchanged).toBe(3);
  });

  test("paragraph matching ignores whitespace and case", () => {
    const r = computeEditDistance("The   Trial\n\nSecond", "the trial\n\nSecond");
    expect(r.paragraphsUnchanged).toBe(2);
  });

  test("a partial edit lands strictly between 0 and 1", () => {
    const r = computeEditDistance(
      "the team ran a controlled trial\n\nresults were inconclusive",
      "the team ran a controlled trial\n\nresults were entirely different here"
    );
    expect(r.ped).toBeGreaterThan(0);
    expect(r.ped).toBeLessThan(1);
    expect(r.paragraphsTotal).toBe(2);
    expect(r.paragraphsUnchanged).toBe(1);
  });
});

describe("recordReportEditDistance", () => {
  test("never throws into the caller: a failing read logs once and returns null", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      db: {
        query: () => {
          throw new Error("boom");
        },
        get: async () => null,
        insert: async () => {
          throw new Error("should not insert");
        },
      },
    } as unknown as MutationCtx;
    const report = {
      _id: "reports:1",
      projectId: "projects:1",
      content: "{}",
      revisionNumber: 0,
    } as unknown as Doc<"reports">;

    await expect(
      recordReportEditDistance(ctx, report, "milestone")
    ).resolves.toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
