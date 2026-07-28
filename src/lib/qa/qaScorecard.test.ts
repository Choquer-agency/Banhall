import { describe, test, expect } from "vitest";
import { qaScorecardSchema } from "../../../shared/qaScorecard";

/**
 * Regression tests for the scorecard that was produced, paid for, stored, and
 * then discarded by validation — leaving "No QA scorecard yet" on screen while
 * every retry burned another API call.
 */

const base = {
  overall_score: 80,
  section_scores: {
    "242": { score: 78, issues: [], strengths: ["Clear uncertainty framing"] },
  },
  cra_compliance: { verbiage_present: true },
  hallucination_risks: [],
  ai_language_flags: [],
  superlative_flags: [],
  gaps_requiring_client_followup: [],
  suggested_improvements: [],
};

describe("qaScorecardSchema", () => {
  test("accepts a warning that deducts zero points", () => {
    // `.positive()` rejected this and took the whole scorecard with it.
    const result = qaScorecardSchema.safeParse({
      ...base,
      section_scores: {
        "242": {
          score: 78,
          issues: [
            {
              text: "BECAUSE clause detection shows 0/0.",
              severity: "warning",
              deduction: 0,
              paragraph: 5,
            },
          ],
          strengths: [],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts a section-wide gap with a null paragraph", () => {
    const result = qaScorecardSchema.safeParse({
      ...base,
      gaps_requiring_client_followup: [
        { section: "246", paragraph: null, question: "Any bench test data?" },
        { section: "244", paragraph: 1, question: "Which prototype?" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.gaps_requiring_client_followup).toHaveLength(2);
  });

  test("accepts a gap with the paragraph key absent entirely", () => {
    const result = qaScorecardSchema.safeParse({
      ...base,
      gaps_requiring_client_followup: [{ section: "242", question: "Details?" }],
    });
    expect(result.success).toBe(true);
  });

  test("keeps the scorecard when one issue row is malformed", () => {
    // The whole report's QA must not vanish over a single bad row.
    const result = qaScorecardSchema.safeParse({
      ...base,
      section_scores: {
        "242": {
          score: 78,
          issues: [
            { text: "Real issue", severity: "deduction", deduction: 5 },
            { severity: 12345 },
          ],
          strengths: [],
        },
      },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.section_scores["242"].issues).toHaveLength(2);
  });

  test("accepts legacy string issues", () => {
    const result = qaScorecardSchema.safeParse({
      ...base,
      section_scores: {
        "242": { score: 78, issues: ["An older plain-string issue"], strengths: [] },
      },
    });
    expect(result.success).toBe(true);
    const issue = result.success && result.data.section_scores["242"].issues[0];
    expect(issue && issue.text).toBe("An older plain-string issue");
  });

  test("defaults absent optional collections rather than failing", () => {
    const result = qaScorecardSchema.safeParse({ overall_score: 91 });
    expect(result.success).toBe(true);
    expect(result.success && result.data.hallucination_risks).toEqual([]);
    expect(result.success && result.data.suggested_improvements).toEqual([]);
  });

  test("still rejects a payload with no usable score", () => {
    // Permissive is not the same as accepting anything: a scorecard with no
    // overall score is genuinely unreadable and must surface as such.
    expect(qaScorecardSchema.safeParse({}).success).toBe(false);
    expect(qaScorecardSchema.safeParse({ overall_score: "high" }).success).toBe(false);
    expect(qaScorecardSchema.safeParse(null).success).toBe(false);
  });
});

describe("qaScorecardSchema — score bounds", () => {
  test("rejects an out-of-range overall score", () => {
    // A percentage outside 0-100 is meaningless; rendering it would misreport
    // report quality as reassuringly fine.
    expect(qaScorecardSchema.safeParse({ overall_score: 4200 }).success).toBe(false);
    expect(qaScorecardSchema.safeParse({ overall_score: -5 }).success).toBe(false);
  });

  test("clamps an out-of-range section score instead of dropping the card", () => {
    const result = qaScorecardSchema.safeParse({
      overall_score: 80,
      section_scores: { "242": { score: 900, issues: [], strengths: [] } },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.section_scores["242"].score).toBe(0);
  });
});
