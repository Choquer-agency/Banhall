import { describe, expect, test, vi } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { computeEditDistance, recordReportEditDistance } from "./editDistance";

describe("computeEditDistance", () => {
  test("identical text scores zero distance and no changed paragraphs", () => {
    const text = "The team built a rig.\n\nThen they measured drift.";
    const r = computeEditDistance(text, text);
    expect(r.ped).toBe(0);
    expect(r.wordSimilarity).toBe(1);
    expect(r.paragraphsTotal).toBe(2);
    expect(r.paragraphsUnchanged).toBe(2);
    expect(r.draftWords).toBe(r.currentWords);
  });

  test("fully rewritten text scores near one with nothing unchanged", () => {
    const r = computeEditDistance(
      "alpha beta gamma delta",
      "onyx quartz sable topaz"
    );
    expect(r.ped).toBe(1);
    expect(r.wordSimilarity).toBe(0);
    expect(r.paragraphsTotal).toBe(1);
    expect(r.paragraphsUnchanged).toBe(0);
  });

  test("partial edits land strictly between the extremes", () => {
    const r = computeEditDistance(
      "alpha beta gamma delta",
      "alpha beta gamma epsilon"
    );
    expect(r.ped).toBeGreaterThan(0);
    expect(r.ped).toBeLessThan(1);
    expect(r.paragraphsUnchanged).toBe(0);
  });

  test("both-empty text is perfectly similar", () => {
    const r = computeEditDistance("", "");
    expect(r.wordSimilarity).toBe(1);
    expect(r.ped).toBe(0);
    expect(r.draftWords).toBe(0);
    expect(r.currentWords).toBe(0);
    expect(r.paragraphsTotal).toBe(0);
    expect(r.paragraphsUnchanged).toBe(0);
  });

  // Asymmetric-empty sides are how unparseable content reaches the formula
  // (extractPlainText swallows JSON.parse failures and returns ""). These lock
  // the CURRENT behaviour; the "bogus ped 1" concern is deferred work DW-44 in
  // _bmad-output/implementation-artifacts/deferred-work.md.
  test("an empty draft against non-empty current scores full distance", () => {
    const r = computeEditDistance("", "the rig drifted");
    expect(r.ped).toBe(1);
    expect(r.wordSimilarity).toBe(0);
    expect(r.draftWords).toBe(0);
    expect(r.currentWords).toBe(3);
    expect(r.paragraphsTotal).toBe(0);
    expect(r.paragraphsUnchanged).toBe(0);
  });

  test("a non-empty draft edited down to empty scores full distance", () => {
    const r = computeEditDistance("the rig drifted", "");
    expect(r.ped).toBe(1);
    expect(r.wordSimilarity).toBe(0);
    expect(r.draftWords).toBe(3);
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

  test("paragraph matching ignores case and whitespace runs", () => {
    const r = computeEditDistance("The  Rig   Drifted", "the rig drifted");
    expect(r.paragraphsUnchanged).toBe(1);
    expect(r.ped).toBe(0);
  });
});

describe("recordReportEditDistance", () => {
  test("swallows a failing read and resolves null instead of throwing into the caller", async () => {
    const boom = new Error("index unavailable");
    const ctx = {
      db: {
        query: () => {
          throw boom;
        },
        get: async () => null,
        insert: async () => {
          throw new Error("insert must not be reached");
        },
      },
    } as unknown as MutationCtx;
    const report = {
      _id: "reports:1",
      _creationTime: 1,
      projectId: "projects:1",
      content: "{}",
      version: 1,
      revisionNumber: 2,
      generatedAt: 1,
      updatedAt: 1,
    } as unknown as Doc<"reports">;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        recordReportEditDistance(ctx, report, "milestone")
      ).resolves.toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[1]).toBe(boom);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
