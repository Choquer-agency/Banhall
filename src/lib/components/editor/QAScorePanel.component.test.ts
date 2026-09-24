import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import QAScorePanel from "./QAScorePanel.svelte";

const scorecard = {
  overall_score: 78,
  section_scores: {
    "242": { score: 86, issues: [], strengths: ["Clear framing"] },
    "244": { score: 62, issues: [{ text: "Hypothesis is not in if/then form.", severity: "deduction", deduction: 5 }], strengths: [] },
    "246": { score: 45, issues: [], strengths: [] },
  },
  cra_compliance: { verbiage_present: true },
  hallucination_risks: [],
  ai_language_flags: [],
  superlative_flags: [],
  gaps_requiring_client_followup: [],
  suggested_improvements: [],
};

beforeEach(() => {
  __resetConvexStub();
  __setQueryData("users:getCurrentUser", { role: "consultant" });
  __setQueryData("reviews:getMyWriterReview", null);
  __setQueryData("reviews:getMyQaItemFeedback", []);
});

describe("QAScorePanel (final UI contract)", () => {
  it("shows a quiet 78/100 line with a band bar and no middle dot", async () => {
    const { container } = await render(QAScorePanel, { rawQa: scorecard });
    const line = container.querySelector<HTMLElement>("[data-qa-score-line]")!;
    expect(line.querySelector("[data-qa-overall]")?.textContent).toBe("78/100");
    expect(line.textContent).toContain("AI QA score");
    expect(container.textContent).not.toContain("\u00B7");
    const bar = line.querySelector<HTMLElement>("[data-qa-overall-bar]")!;
    expect(getComputedStyle(bar).backgroundColor).toBe("rgb(245, 158, 11)");
  });

  it("colours Section bars by band", async () => {
    const { container } = await render(QAScorePanel, { rawQa: scorecard });
    const bars = [...container.querySelectorAll<HTMLElement>("[data-qa-section-bar]")];
    expect(bars.map((bar) => getComputedStyle(bar).backgroundColor)).toEqual([
      "rgb(22, 163, 74)",
      "rgb(245, 158, 11)",
      "rgb(220, 38, 38)",
    ]);
  });

  it("uses no font weight above 500", async () => {
    const { container } = await render(QAScorePanel, { rawQa: scorecard });
    for (const element of container.querySelectorAll<HTMLElement>("*")) {
      expect(Number(getComputedStyle(element).fontWeight)).toBeLessThanOrEqual(500);
    }
  });
});
