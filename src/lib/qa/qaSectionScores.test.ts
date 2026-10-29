import { describe, expect, it } from "vitest";
import { chatQaIssues, qaFinishedAgo, qaSectionScores, qaTopIssues } from "./qaSectionScores";

const scorecard = {
  overall_score: 78,
  section_scores: {
    "246": { score: 84, issues: [], strengths: [] },
    "242": { score: 86, issues: [], strengths: ["Clear framing"] },
    "244": { score: 61.6, issues: [{ text: "Hypothesis is not in if/then form.", severity: "deduction", deduction: 5 }], strengths: [] },
  },
  cra_compliance: {},
  hallucination_risks: [],
  ai_language_flags: [],
  superlative_flags: [],
  gaps_requiring_client_followup: [],
  suggested_improvements: [],
};

describe("qaSectionScores", () => {
  it("maps a scorecard to rows in line order with short names", () => {
    expect(qaSectionScores(scorecard)).toEqual({
      overall: 78,
      sections: [
        { key: "242", number: "242", name: "Uncertainty", score: 86 },
        { key: "244", number: "244", name: "Work performed", score: 62 },
        { key: "246", number: "246", name: "Advancement", score: 84 },
      ],
    });
  });

  it("accepts the agentOutputs JSON string and object that hold qa", () => {
    const fromString = qaSectionScores(JSON.stringify({ analysis: {}, qa: scorecard }));
    const fromObject = qaSectionScores({ qa: scorecard });
    expect(fromString?.overall).toBe(78);
    expect(fromObject?.sections.map((row) => row.number)).toEqual(["242", "244", "246"]);
  });

  it("keeps only the sections the model returned", () => {
    const partial = { ...scorecard, section_scores: { "244": { score: 70, issues: [], strengths: [] } } };
    expect(qaSectionScores(partial)?.sections).toEqual([
      { key: "244", number: "244", name: "Work performed", score: 70 },
    ]);
  });

  it("normalises prefixed keys and names unknown lines plainly", () => {
    const odd = {
      ...scorecard,
      section_scores: {
        s242: { score: 90, issues: [], strengths: [] },
        "248": { score: 50, issues: [], strengths: [] },
      },
    };
    expect(qaSectionScores(odd)?.sections).toEqual([
      { key: "s242", number: "242", name: "Uncertainty", score: 90 },
      { key: "248", number: "248", name: "Section 248", score: 50 },
    ]);
  });

  it("returns null when there is no readable scorecard", () => {
    expect(qaSectionScores(null)).toBeNull();
    expect(qaSectionScores(undefined)).toBeNull();
    expect(qaSectionScores("not json")).toBeNull();
    expect(qaSectionScores(JSON.stringify({ analysis: {} }))).toBeNull();
    expect(qaSectionScores({ qa: { overall_score: 140 } })).toBeNull();
  });
});

describe("qaFinishedAgo", () => {
  const now = 10_000_000;
  it("reads Just now under a minute and without a time", () => {
    expect(qaFinishedAgo(now - 30_000, now)).toBe("Just now");
    expect(qaFinishedAgo(null, now)).toBe("Just now");
    expect(qaFinishedAgo(now + 5_000, now)).toBe("Just now");
  });
  it("counts minutes, hours and days", () => {
    expect(qaFinishedAgo(now - 60_000, now)).toBe("1 minute ago");
    expect(qaFinishedAgo(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(qaFinishedAgo(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(qaFinishedAgo(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
});

describe("qaTopIssues", () => {
  const card = (sections: Record<string, Array<{ text: string; severity?: "deduction" | "warning"; deduction?: number } | string>>) => ({
    qa: {
      overall_score: 80,
      section_scores: Object.fromEntries(
        Object.entries(sections).map(([key, issues]) => [key, { score: 80, issues, strengths: [] }])
      ),
    },
  });

  it("takes each Line's costliest deduction, costliest Line first", () => {
    const outputs = JSON.stringify(card({
      "242": [
        { text: "Minor wording.", severity: "deduction", deduction: 2 },
        { text: "The uncertainty restates the goal.", severity: "deduction", deduction: 5 },
      ],
      "244": [{ text: "No baseline for the first test. It matters.", severity: "deduction", deduction: 8 }],
      "246": [{ text: "Only a warning.", severity: "warning", deduction: 0 }],
    }));
    expect(qaTopIssues(outputs)).toEqual([
      { line: "244", text: "No baseline for the first test." },
      { line: "242", text: "The uncertainty restates the goal." },
    ]);
  });

  it("drops an older scorecard's Deduct lead and cuts a long sentence on a word", () => {
    const long = `Deduct 4 points: ${"the work performed lists tasks without saying what each one tested ".repeat(4)}`;
    const [issue] = qaTopIssues(card({ "244": [long] }));
    expect(issue.line).toBe("244");
    expect(issue.text.startsWith("The work performed")).toBe(true);
    expect(issue.text.length).toBeLessThanOrEqual(161);
    expect(issue.text.endsWith("…")).toBe(true);
    expect(issue.text).not.toMatch(/ …$/);
  });

  it("strips Deduct only as a lead, keeps e.g. inside a sentence, and starts with a capital", () => {
    expect(qaTopIssues(card({ "242": [{ text: "Missing baseline, so deduct 5 points. Add it.", severity: "deduction", deduction: 5 }] })))
      .toEqual([{ line: "242", text: "Missing baseline, so deduct 5 points." }]);
    expect(qaTopIssues(card({ "244": [{ text: "the tests, e.g. the pH runs, lack a control. More text.", severity: "deduction", deduction: 3 }] })))
      .toEqual([{ line: "244", text: "The tests, e.g. the pH runs, lack a control." }]);
  });

  it("leaves out an issue the writer marked a warning, and offers the next costliest", () => {
    const outputs = card({
      "242": [
        { text: "Costliest.", severity: "deduction", deduction: 6 },
        { text: "Next.", severity: "deduction", deduction: 3 },
      ],
    });
    expect(qaTopIssues(outputs, new Map([["issue:242:0", "warning"]]))).toEqual([{ line: "242", text: "Next." }]);
  });

  it("offers QA issues only from a finished run on the report as saved then", () => {
    const outputs = card({ "246": [{ text: "Advancement is vague.", severity: "deduction", deduction: 4 }] });
    const base = { agentOutputs: outputs, qaDone: true, completedAt: 2_000, reportUpdatedAt: 1_500 };
    expect(chatQaIssues(base)).toEqual([{ line: "246", text: "Advancement is vague." }]);
    expect(chatQaIssues({ ...base, reportUpdatedAt: 2_001 })).toEqual([]);
    expect(chatQaIssues({ ...base, qaDone: false })).toEqual([]);
    expect(chatQaIssues({ ...base, completedAt: null })).toEqual([]);
  });

  it("returns nothing without a readable scorecard or outside Lines 242 to 246", () => {
    expect(qaTopIssues(null)).toEqual([]);
    expect(qaTopIssues("not json")).toEqual([]);
    expect(qaTopIssues(card({ "248": [{ text: "Elsewhere.", severity: "deduction", deduction: 9 }] }))).toEqual([]);
  });
});
