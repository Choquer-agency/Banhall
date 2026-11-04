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

/**
 * 2026-10-30 (owner, "please fix all properly", item 4): QA items read
 * "(an issue in this report could not be read)". The QA prompt says a
 * warning MUST have no deduction, so the model sent `"deduction": null`,
 * which `.optional()` rejected, and the whole item, text and all, became the
 * placeholder. These are the exact shapes.
 */
describe("qaScorecardSchema: readable QA items", () => {
  const withIssues = (issues: unknown[]) => ({
    ...base,
    section_scores: { "244": { score: 70, issues, strengths: [] } },
  });
  const issuesOf = (raw: unknown) => {
    const result = qaScorecardSchema.safeParse(raw);
    if (!result.success) throw new Error(`the scorecard failed: ${result.error.message}`);
    return result.data.section_scores["244"]!.issues;
  };

  test("a warning with a null deduction keeps its text and has no deduction", () => {
    const [issue] = issuesOf(withIssues([
      { text: "Two acceptable paragraphs were merged.", severity: "warning", deduction: null, paragraph: null },
    ]));
    expect(issue).toEqual({ text: "Two acceptable paragraphs were merged.", severity: "warning", paragraph: null });
    expect(issue!.deduction).toBeUndefined();
  });

  test("a paragraph of 0 reads as section-wide", () => {
    const [issue] = issuesOf(withIssues([
      { text: "The line has no year-end status.", severity: "warning", deduction: null, paragraph: 0 },
    ]));
    expect(issue).toMatchObject({ text: "The line has no year-end status.", severity: "warning", paragraph: null });
  });

  test("a deduction written as a number in a string reads as that number", () => {
    const [issue] = issuesOf(withIssues([
      { text: "The hypothesis reads like a plan.", severity: "deduction", deduction: "10", paragraph: 2 },
    ]));
    expect(issue).toEqual({ text: "The hypothesis reads like a plan.", severity: "deduction", deduction: 10, paragraph: 2 });
  });

  test("an item still malformed keeps its own text, never the placeholder", () => {
    const issues = issuesOf(withIssues([
      { text: "The cold-room trial is not described.", severity: "deduction", deduction: "five", paragraph: 3 },
      { text: "A step is out of order.", severity: "warning", paragraph: 2.5 },
      { text: "Mixed voice in one paragraph.", severity: "loud", deduction: -2, paragraph: -1 },
    ]));
    expect(issues).toEqual([
      { text: "The cold-room trial is not described.", severity: "deduction", paragraph: 3 },
      { text: "A step is out of order.", severity: "warning", paragraph: null },
      { text: "Mixed voice in one paragraph.", severity: "deduction", paragraph: null },
    ]);
    expect(issues.some((issue) => issue.text.includes("could not be read"))).toBe(false);
  });

  test("only an item with no usable text becomes the placeholder, and the rest of the card stays", () => {
    const issues = issuesOf(withIssues([
      { severity: "warning", deduction: null, paragraph: 1 },
      { text: 42, severity: "warning" },
      { text: "Kept.", severity: "warning", deduction: null, paragraph: 0 },
    ]));
    expect(issues.map((issue) => issue.text)).toEqual([
      "(an issue in this report could not be read)",
      "(an issue in this report could not be read)",
      "Kept.",
    ]);
  });

  test("a bad follow-up question is salvaged or dropped, never the whole scorecard", () => {
    const result = qaScorecardSchema.safeParse({
      ...base,
      gaps_requiring_client_followup: [
        { section: "246", paragraph: 0, question: "Which alloys were tested in the second run?" },
        { section: 244, paragraph: 2, question: "How long did the cold-room trial run?" },
        { section: "242", paragraph: 1.5, question: "Which standard method was ruled out?" },
        { section: "244", paragraph: 1 },
        null,
        "not a row",
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.gaps_requiring_client_followup).toEqual([
      { section: "246", paragraph: null, question: "Which alloys were tested in the second run?" },
      { section: "244", paragraph: 2, question: "How long did the cold-room trial run?" },
      { section: "242", paragraph: null, question: "Which standard method was ruled out?" },
    ]);
  });

  test("a bad row in a string list is dropped or its text kept, and null reads as empty", () => {
    const result = qaScorecardSchema.safeParse({
      ...base,
      section_scores: { "242": { score: 80, issues: null, strengths: ["Names the standard method.", 7, { text: "Clear cause." }] } },
      hallucination_risks: null,
      ai_language_flags: ["utilize", { word: "leverage" }],
      superlative_flags: "cutting-edge",
      suggested_improvements: [{ text: "Name the alloy." }, false, "Give the year-end status."],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.section_scores["242"]).toEqual({ score: 80, issues: [], strengths: ["Names the standard method.", "Clear cause."] });
    expect(result.data.hallucination_risks).toEqual([]);
    expect(result.data.ai_language_flags).toEqual(["utilize"]);
    expect(result.data.superlative_flags).toEqual(["cutting-edge"]);
    expect(result.data.suggested_improvements).toEqual(["Name the alloy.", "Give the year-end status."]);
  });
});
