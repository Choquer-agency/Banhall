import { describe, expect, it } from "vitest";
import { qaFinishedAgo, qaSectionScores } from "./qaSectionScores";

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
