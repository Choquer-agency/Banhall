import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import QAScorePanel from "./QAScorePanel.svelte";
import TooltipProviderHarness from "$lib/test/TooltipProviderHarness.svelte";

function renderSide(props: Record<string, unknown>) {
  return render(TooltipProviderHarness, { props: { panel: QAScorePanel, panelProps: { variant: "side", ...props } } });
}

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

const fullScorecard = {
  ...scorecard,
  section_scores: {
    "242": { score: 86, issues: [], strengths: ["Clear framing"] },
    "244": {
      score: 62,
      issues: [
        { text: "Hypothesis is not in if/then form.", severity: "deduction", deduction: 5 },
        { text: "96 of 100 lines used.", severity: "warning" },
      ],
      strengths: ["Chronology follows the interview."],
    },
    "246": { score: 84, issues: [], strengths: [] },
  },
  cra_compliance: { verbiage_present: true, why_how_why_intact: true, uncertainties_distinguished: false },
  ai_language_flags: ["\u201cessentially\u201d in 242, paragraph 1. Remove the filler qualifier."],
  gaps_requiring_client_followup: [
    { section: "246", question: "Which trials failed?" },
    { section: "244", paragraph: 2, question: "What test range was recorded?" },
  ],
};

describe("QAScorePanel side panel (board 2.2)", () => {
  it("draws the QA score header with Re-run and close, and no icon", async () => {
    const onClose = vi.fn();
    const onRunQa = vi.fn();
    const { container } = await renderSide({
      rawQa: fullScorecard,
      onClose,
      onRunQa,
      lastRunAt: Date.now() - 2 * 60_000,
    });
    const header = container.querySelector<HTMLElement>("[data-qa-panel-header]")!;
    expect(header.querySelector("h2")?.textContent).toBe("QA score");
    expect(header.querySelector("svg path[d^='M9 12l2 2']")).toBeNull();
    await page.getByRole("button", { name: "Close QA score", exact: true }).click();
    expect(onClose).toHaveBeenCalledOnce();
    await page.getByRole("button", { name: "Re-run", exact: true }).click();
    expect(onRunQa).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-qa-score-line]")?.textContent).toContain(
      "AI QA score, last run 2 min ago"
    );
  });

  it("uses sentence-case group labels and tinted Issues, Warnings and Strengths rows", async () => {
    const { container } = await renderSide({ rawQa: fullScorecard });
    const labels = [...container.querySelectorAll("p")].map((p) => p.textContent?.trim());
    for (const label of ["Sections", "CRA compliance", "Language flags", "Client follow-ups"]) {
      expect(labels).toContain(label);
    }
    await page.getByRole("button", { name: /^244/ }).click();
    const section = container.querySelector<HTMLElement>('[data-qa-section="244"]')!;
    expect(section.textContent).toMatch(/Issues\s*1/);
    expect(section.textContent).toMatch(/Warnings\s*1/);
    expect(section.textContent).toMatch(/Strengths\s*1/);
    const rows = [...section.querySelectorAll<HTMLElement>("li.rounded")];
    expect(rows.map((row) => row.textContent?.trim())).toEqual([
      "Hypothesis is not in if/then form. (\u22125)",
      "96 of 100 lines used.",
      "Chronology follows the interview.",
    ]);
    const fills = rows.map((row) => getComputedStyle(row).backgroundColor);
    expect(new Set(fills).size).toBe(3);
    expect(fills).not.toContain("rgba(0, 0, 0, 0)");
  });

  it("shows CRA compliance as check or cross chips in sentence case", async () => {
    const { container } = await renderSide({ rawQa: fullScorecard });
    const chips = [...container.querySelectorAll<HTMLElement>("[data-qa-compliance]")];
    expect(chips.map((chip) => [chip.dataset.qaCompliance, chip.textContent?.trim().replace(/^(Met|Not met):\s*/, "")])).toEqual([
      ["pass", "Verbiage present"],
      ["pass", "Why, how, why intact"],
      ["fail", "Uncertainties distinguished"],
    ]);
  });

  it("lists client follow-ups as simple rows tagged by line and paragraph", async () => {
    const onLocateGap = vi.fn();
    const { container } = await renderSide({ rawQa: fullScorecard, onLocateGap });
    const rows = [...container.querySelectorAll<HTMLElement>("[data-qa-follow-up]")];
    expect(rows.map((row) => row.querySelector(".font-mono")?.textContent)).toEqual(["244, P2", "246"]);
    await page.getByRole("button", { name: "Jump to paragraph" }).click();
    expect(onLocateGap).toHaveBeenCalledWith({ section: "244", paragraph: 2 });
  });
});

describe("QAScorePanel after a failed re-run (review f2 #1)", () => {
  it("says the last run failed and keeps the older score's time out of the meta line", async () => {
    const { container } = await renderSide({ rawQa: fullScorecard, postQaStatus: "failed", lastRunAt: null });
    expect(container.querySelector("[data-qa-score-meta]")?.textContent).toBe("AI QA score");
    expect(container.querySelector("[data-qa-last-run-failed]")?.textContent?.trim()).toBe(
      "The last run failed. This score is from an earlier run."
    );
  });

  it("uses muted ink, not placeholder ink, for the meta line", async () => {
    const { container } = await renderSide({ rawQa: fullScorecard, lastRunAt: Date.now() });
    const meta = container.querySelector<HTMLElement>("[data-qa-score-meta]")!;
    expect(getComputedStyle(meta).color).toBe("rgb(107, 127, 123)");
  });
});
