import { describe, test, expect } from "vitest";
import { pdReviewResultSchema } from "../../../shared/pdReview";

/**
 * A PD review used to be stored as `completed` without validation, so an
 * unreadable result rendered a blank panel that could not be retried. These
 * lock in what the shared contract accepts and rejects.
 */

const valid = {
  summary: "The PD covers a firmware project with a clear uncertainty.",
  qualitative_score: 72,
  score_rationale: "Systematic investigation is evidenced but thin.",
  strengths: ["Clear technological objective"],
  risks: ["Advancement is asserted, not demonstrated"],
  suggested_strengthening: ["Add iteration-level results"],
};

describe("pdReviewResultSchema", () => {
  test("accepts a well-formed review", () => {
    expect(pdReviewResultSchema.safeParse(valid).success).toBe(true);
  });

  test("defaults absent bullet lists instead of failing", () => {
    const result = pdReviewResultSchema.safeParse({
      summary: valid.summary,
      qualitative_score: 72,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.strengths).toEqual([]);
    expect(result.success && result.data.risks).toEqual([]);
    expect(result.success && result.data.score_rationale).toBe("");
  });

  test("keeps the review when one bullet is malformed", () => {
    const result = pdReviewResultSchema.safeParse({
      ...valid,
      risks: ["A real risk", { not: "a string" }],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.risks).toHaveLength(2);
    expect(result.success && result.data.risks[0]).toBe("A real risk");
  });

  test("rejects a score outside 0-100", () => {
    expect(
      pdReviewResultSchema.safeParse({ ...valid, qualitative_score: 900 }).success
    ).toBe(false);
    expect(
      pdReviewResultSchema.safeParse({ ...valid, qualitative_score: -1 }).success
    ).toBe(false);
  });

  test("rejects a review with no summary or score", () => {
    // These carry the verdict; without them there is nothing to show and the
    // review should surface as unreadable rather than render empty.
    expect(pdReviewResultSchema.safeParse({}).success).toBe(false);
    expect(
      pdReviewResultSchema.safeParse({ summary: "Only prose" }).success
    ).toBe(false);
  });
});
