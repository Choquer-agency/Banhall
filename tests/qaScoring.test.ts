import { describe, expect, test } from "bun:test";
import { adjustedQaScores, issueDeduction } from "../src/lib/qaScoring";

const legacyIssue = {
  severity: "deduction" as const,
  text: "CRITICAL - P4 structural failure: the paragraphs collapse. Deduct 5 points.",
};

describe("QA score category overrides", () => {
  test("recovers the displayed legacy deduction from the exact prose form", () => {
    expect(issueDeduction(legacyIssue)).toBe(5);
  });

  test("prefers structured deduction metadata", () => {
    expect(issueDeduction({ ...legacyIssue, deduction: 3 })).toBe(3);
  });

  test("does not infer deductions from unrelated numbers or original warnings", () => {
    expect(issueDeduction({ severity: "deduction", text: "Line 244 needs 3 paragraphs." })).toBe(0);
    expect(issueDeduction({ severity: "warning", text: "Deduct 5 points." })).toBe(0);
  });

  test("restores both overall and section score when a deduction becomes a warning", () => {
    const scores = adjustedQaScores(
      72,
      {
        "242": { score: 70, issues: [legacyIssue] },
        "244": { score: 82, issues: [] },
      },
      (section, index, issue) => section === "242" && index === 0 ? "warning" : issue.severity
    );

    expect(scores).toEqual({
      overall: 77,
      sections: { "242": 75, "244": 82 },
    });
  });

  test("leaves scores unchanged when no category changes", () => {
    expect(adjustedQaScores(
      72,
      { "242": { score: 70, issues: [legacyIssue] } },
      (_section, _index, issue) => issue.severity
    )).toEqual({ overall: 72, sections: { "242": 70 } });
  });

  test("caps restored scores at 100", () => {
    expect(adjustedQaScores(
      98,
      { "242": { score: 99, issues: [legacyIssue] } },
      () => "warning"
    )).toEqual({ overall: 100, sections: { "242": 100 } });
  });
});
