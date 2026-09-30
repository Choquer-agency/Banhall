import { describe, expect, it } from "vitest";
import {
  detectFirstPersonPreference,
  findDashConnectors,
  findSourceTalk,
  isDashClean,
  RULES_HUMAN_PROSE,
  RULES_REPORT_FACTS,
  RULES_SEED_WORDING,
  SOURCE_TALK,
} from "./humanProse";

const hits = (t: string) => findDashConnectors(t).length;

describe("findDashConnectors", () => {
  it("flags an em dash used as punctuation", () => {
    const found = findDashConnectors("The data was clear — engagement had collapsed.");
    expect(found).toHaveLength(1);
    expect(found[0].token).toBe("—");
    expect(found[0].context).toContain("clear — engagement");
  });

  it("flags the stand-ins: double hyphen, spaced hyphen, spaced en dash, horizontal bar, NBSP-padded hyphen", () => {
    expect(hits("It compiled -- and it was fast.")).toBe(1);
    expect(hits("It compiled --and it was fast.")).toBe(1);
    expect(hits("It compiled - and it was fast.")).toBe(1);
    expect(hits("It compiled – and it was fast.")).toBe(1);
    expect(hits("It compiled –and it was fast.")).toBe(1);
    expect(hits("It compiled ― and it was fast.")).toBe(1);
    expect(hits("It compiled - and it was fast.")).toBe(1);
    expect(hits("Étude – résumé")).toBe(1);
  });

  it("leaves hyphenated compounds, hyphen ranges, paired names, and minus signs alone", () => {
    const clean = [
      "Wall-to-batch heat transfer in the in-situ reactor ran 10-20 minutes over 2019-2024.",
      "Held at -5 °C with a five-year plan, a 3-1 result, pH 7-8, ISO 9001-2015, part AB-123-X.",
      "The Newton-Raphson solver on a Ni-Cd cell, plotted on a T-S diagram, pp. 12-15.",
      "For 10 - 20 minutes over the 2019 - 2024 period at 5% - 10%.",
      "Where a - b = c and T2 - T1 = ΔT.",
    ].join(" ");
    expect(findDashConnectors(clean)).toEqual([]);
    expect(isDashClean(clean)).toBe(true);
  });

  it("flags every en dash and typographic hyphen, closed ranges and paired names included (dashfix)", () => {
    expect(hits("a 3–1 result")).toBe(1);
    expect(hits("The Newton–Raphson solver")).toBe(1);
    expect(hits("pp. 12–15")).toBe(1);
    expect(hits("non\u2010linear, non\u2011breaking, figure\u2012dash")).toBe(3);
    expect(isDashClean("2019–2024")).toBe(false);
  });

  it("ignores dashes that are line structure, not punctuation", () => {
    expect(hits("para one\n\n---\n\npara two")).toBe(0);
    expect(hits("regards\n-- \nJohn")).toBe(0);
    expect(hits("line one -- \r\nline two")).toBe(0);
    expect(hits("list:\n- item one\n- item two")).toBe(0);
  });

  it("counts every hit across a paragraph", () => {
    const text = "One goal — to win. Not a tool — a platform. Speed, clarity, polish — that is the goal.";
    expect(hits(text)).toBe(3);
  });

  it("stays linear on long input", () => {
    const long = "word ".repeat(10_000) + " - ".repeat(1000) + "—".repeat(1000);
    const t0 = performance.now();
    findDashConnectors(long);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe("detectFirstPersonPreference", () => {
  it("returns null with no text", () => {
    expect(detectFirstPersonPreference("")).toBeNull();
    expect(detectFirstPersonPreference(null)).toBeNull();
  });
  it("detects common first-person requests", () => {
    expect(detectFirstPersonPreference("Write in first person plural.")).toBe(true);
    expect(detectFirstPersonPreference('Use "we" and "our" for the company.')).toBe(true);
    expect(detectFirstPersonPreference("Refer to the company as we throughout.")).toBe(true);
    expect(detectFirstPersonPreference("Prefer we/our over the company name.")).toBe(true);
  });
  it("returns false when silent or negated", () => {
    expect(detectFirstPersonPreference("Short declarative sentences. Lead with the hypothesis.")).toBe(false);
    expect(detectFirstPersonPreference("Do not use first person; keep the company as subject.")).toBe(false);
    expect(detectFirstPersonPreference("Avoid we/our.")).toBe(false);
  });
});

describe("RULES_HUMAN_PROSE", () => {
  it("is the always-on block the writing agents receive", () => {
    expect(RULES_HUMAN_PROSE).toMatch(/^HUMAN PROSE \(MANDATORY/);
    expect(RULES_HUMAN_PROSE).toContain("Never use an em dash");
  });

  it("carries the dashfix hyphen rule and copywriting's plain-language rules, not its sales tactics", () => {
    expect(RULES_HUMAN_PROSE).toContain('the plain hyphen "-" is the only dash');
    expect(RULES_HUMAN_PROSE).toContain("Ranges and paired names take the plain hyphen");
    expect(RULES_HUMAN_PROSE).toContain("Verbatim quotations");
    expect(RULES_HUMAN_PROSE).toContain("Clear over clever");
    expect(RULES_HUMAN_PROSE).toContain("no calls to action, rhetorical questions, jokes or benefit claims");
  });
});

describe("RULES_SEED_WORDING", () => {
  it("never tells a Seed to split into two sentences and contains no dash of its own", () => {
    expect(RULES_SEED_WORDING).toContain("never split a bullet into two sentences");
    expect(findDashConnectors(RULES_SEED_WORDING)).toEqual([]);
  });
});

describe("report text rules (2026-09-30, third)", () => {
  const phrases = (text: string, subjectText: readonly string[] = []) =>
    findSourceTalk(text, { subjectText }).map((hit) => hit.phrase);

  it("carries both rules in plain words, with no typographic dash, apart from RULES_HUMAN_PROSE", () => {
    expect(findDashConnectors(RULES_REPORT_FACTS)).toEqual([]);
    expect(Object.values(SOURCE_TALK).flatMap((text) => findDashConnectors(text))).toEqual([]);
    expect(RULES_REPORT_FACTS).toContain("A result at or past its target met it.");
    expect(RULES_REPORT_FACTS).toContain("for a limit to stay under");
    expect(RULES_REPORT_FACTS).toContain("Never carry it to a later or final result.");
    expect(RULES_REPORT_FACTS).toContain("State the fact, never where it came from.");
    // Notes, QA and the Brief name their sources on purpose.
    expect(RULES_HUMAN_PROSE).not.toContain(RULES_REPORT_FACTS);
  });

  it("finds the phrases the release suite judges flagged in runs 10 and 11", () => {
    expect(phrases("The two interviewees describe the motivation differently, one emphasizing breakage.")).toEqual(["interviewees"]);
    expect(phrases("roughly 3 extra hours per load (recorded elsewhere as a rise from about 19 to 22 hours)")).toEqual(["recorded elsewhere"]);
    expect(phrases("roughly 7 to 8 percent below the baseline depending on the measurement source, and")).toEqual(["depending on the measurement source"]);
    expect(phrases("Over 240 brackets, the test memo indicates reject rate held stable at 2.4 percent.")).toEqual(["the test memo indicates"]);
  });

  it("finds the other clear ways of naming a source", () => {
    expect(phrases("In the interview, the lead said the kiln ran hot.")).toEqual(["the interview"]);
    expect(phrases("According to the trial log, 2 of 36 parts delaminated.")).toEqual(["According to the trial log"]);
    expect(phrases("According to the interview notes, the flow held.")).toEqual(["According to the interview notes"]);
    expect(phrases("The transcript says the ramp was slowed.")).toEqual(["The transcript says"]);
    expect(phrases("The figure in the transcript is 7 percent.")).toEqual(["in the transcript"]);
    expect(phrases("The sources disagree on the driver, and one source puts it at 8 percent.")).toEqual(["The sources disagree", "one source puts"]);
    expect(phrases("As the Brief notes, the Storyline and the Confidence Map agree.")).toEqual(["the Brief", "Storyline", "Confidence Map"]);
    expect(phrases("The Brief says so.")).toEqual(["The Brief"]);
  });

  it("never fires on technical uses of source, a lowercase confidence map or brief, or heat and light sources", () => {
    const technical = [
      "A light source and a heat source were compared against a reference source.",
      "The sources of error were stray reflection and thermal drift.",
      "An open-source solver read the source code, and the power source held 24 V.",
      "Two light sources were used. The sources gave 5 W each.",
      "A stereo confidence map rated each depth pixel.",
      "The brief exposure lasted 3 s, and the result was brief.",
      "The model accuracy varied depending on the data source.",
      "A data source was added, and the source term was linearized.",
      "The storyboard and the memory map were checked.",
    ].join(" ");
    expect(phrases(technical)).toEqual([]);
  });

  it("treats the project's own subject, named in the plan or a Glossary Term, as subject, not source talk", () => {
    const text = "The engine ranked each interviewee by availability after the interview.";
    expect(phrases(text)).toEqual(["interviewee", "the interview"]);
    expect(phrases(text, ["Scheduling each interviewee", "the interview slot"])).toEqual([]);
  });

  it("returns each hit once, in text order, with a short context", () => {
    const hits = findSourceTalk("Per the test memo, the memo states 2.4 percent.");
    expect(hits.map((hit) => [hit.phrase, hit.index])).toEqual([["Per the test memo", 0], ["the memo states", 19]]);
    expect(hits[0]!.context).toContain("Per the test memo");
  });
});
