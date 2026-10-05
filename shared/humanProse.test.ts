import { describe, expect, it } from "vitest";
import {
  detectFirstPersonPreference,
  FACT_RULES,
  findDashConnectors,
  findSourceTalk,
  isDashClean,
  RULES_HUMAN_PROSE,
  RULES_REPORT_FACTS,
  RULES_SEED_WORDING,
  SOURCE_TALK,
  sourceTalkSubject,
  TARGET_DIRECTIONS,
  TARGET_RULES,
} from "./humanProse";
import run11 from "./__fixtures__/release-suite-run11-report-text.json";

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
    expect(RULES_REPORT_FACTS).toContain(TARGET_RULES.reach);
    expect(RULES_REPORT_FACTS).toContain(TARGET_RULES.limit);
    expect(RULES_REPORT_FACTS).toContain("Where you cannot tell which way a target runs");
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
    // Greptile round (lead decision): an interviewee always counts; the plain
    // mention gives way to the same noun phrase in the subject.
    expect(phrases(text, ["Scheduling each interviewee", "the interview slot"])).toEqual(["interviewee"]);
  });

  it("returns each hit once, in text order, with a short context", () => {
    const hits = findSourceTalk("Per the test memo, the memo states 2.4 percent.");
    expect(hits.map((hit) => [hit.phrase, hit.index])).toEqual([["Per the test memo", 0], ["the memo states", 19]]);
    expect(hits[0]!.context).toContain("Per the test memo");
  });
});

describe("figures and details as the sources give them (2026-10-04, second)", () => {
  it("carries the rule once, in plain words with no typographic dash, after the targets rule and apart from RULES_HUMAN_PROSE", () => {
    for (const sentence of Object.values(FACT_RULES)) {
      expect(findDashConnectors(sentence)).toEqual([]);
      expect(RULES_REPORT_FACTS.split(sentence)).toHaveLength(2);
      expect(RULES_HUMAN_PROSE).not.toContain(sentence);
    }
    const figures = RULES_REPORT_FACTS.indexOf("Figures and details as the sources give them:");
    expect(figures).toBeGreaterThan(RULES_REPORT_FACTS.indexOf("Results against targets:"));
    expect(figures).toBeLessThan(RULES_REPORT_FACTS.indexOf("No talk about sources:"));
  });

  it("names both errors of the 2026-10-04 run in general words, and allows rounding and plain arithmetic", () => {
    // A figure for another group, and a detail the sources do not give or give for another thing.
    expect(FACT_RULES.scope).toContain("A rate over all items is not the rate of one subset, even when every failure came from that subset.");
    expect(FACT_RULES.detail).toContain("no material, place, person, organization, product, supplier, date or number of your own");
    expect(FACT_RULES.detail).toContain("Never move a detail from the thing it belongs to onto another thing.");
    expect(FACT_RULES.cause).toContain("A suspected or expected cause stays suspected");
    expect(FACT_RULES.allowed).toBe(
      "Rounding, the same figure in another unit or form, plain arithmetic on the sources' own numbers and plain-language wording are fine."
    );
    expect(RULES_REPORT_FACTS).toContain(
      '"3 percent of all castings were rejected, every one from the night shift" does not mean 3 percent of the night shift\'s castings were rejected.'
    );
  });

  it("is neutral: no fixture's figures or terms are in the rule", () => {
    const rule = [...Object.values(FACT_RULES), RULES_REPORT_FACTS].join(" ").toLowerCase();
    for (const term of ["velloway", "deep cove", "shaker", "mdf", "powder", "steel", "datasheet", "4 percent", "13 percent", "600"]) {
      expect(rule).not.toContain(term);
    }
  });
});

describe("results against targets, split by direction (review P2-3)", () => {
  // The list's own reading: a word the direction forbids for a met target,
  // unless negated ("not exceeding" says a limit was met).
  const misstates = (direction: keyof typeof TARGET_DIRECTIONS, phrase: string) =>
    TARGET_DIRECTIONS[direction].misstated.filter((word) =>
      new RegExp(`(?<!\\bnot )\\b${word}\\b`, "i").test(phrase));
  const RUN_11 =
    "Combined, these results reached 97.8 percent of edges in the edge radius window and 2.6 percent rejects, close to but not exceeding the 97 percent and 3 percent targets.";

  it("keeps one list, and never forbids below or not exceeding for a limit", () => {
    expect(TARGET_DIRECTIONS.reach.misstated).toContain("below");
    expect(TARGET_DIRECTIONS.limit.misstated).not.toContain("below");
    expect(TARGET_RULES.reach).toBe(
      "For a target to reach, a result at or above it met it; never call a met one close to, short of, just under, below or only approached."
    );
    expect(TARGET_RULES.limit).toBe(
      "For a limit to stay under, a result at or below it met it; never call a met one over, above or exceeding it."
    );
    // The limit rule's own example says "below" for a met limit.
    expect(RULES_REPORT_FACTS).toContain("scrap below 2 percent");
  });

  it("reads run 11's sentence as wrong for the 97 percent reach target and fine for the 3 percent limit", () => {
    expect(misstates("reach", RUN_11)).toEqual(["close to"]);
    expect(misstates("limit", RUN_11)).toEqual([]);
  });

  it("reads reach and limit cases both ways", () => {
    // A target to reach, met.
    expect(misstates("reach", "97.8 percent of edges, above the 97 percent target")).toEqual([]);
    expect(misstates("reach", "97.8 percent, just under the 97 percent threshold")).toEqual(["just under"]);
    expect(misstates("reach", "97.8 percent, which only approached the 97 percent target")).toEqual(["only approached"]);
    expect(misstates("reach", "97.8 percent, not below the 97 percent target")).toEqual([]);
    // A limit to stay under, met.
    expect(misstates("limit", "2.6 percent rejects, below the 3 percent limit")).toEqual([]);
    expect(misstates("limit", "2.6 percent rejects, not exceeding the 3 percent limit")).toEqual([]);
    expect(misstates("limit", "2.6 percent rejects, above the 3 percent limit")).toEqual(["above"]);
    expect(misstates("limit", "2.6 percent rejects, exceeding the 3 percent limit")).toEqual(["exceeding"]);
  });
});

describe("source talk and the project's own subject (review P2-4)", () => {
  const phrases = (text: string, planWording: string[][] = [], glossaryTerms: string[] = []) =>
    findSourceTalk(text, { subjectText: sourceTalkSubject({ planWording, glossaryTerms }) }).map((hit) => hit.phrase);

  it("never reports a plain mention whose noun phrase the project's subject holds", () => {
    // Greptile round (lead decision): the same noun phrase, the noun with the
    // same modifier, or none.
    const cases: Array<[string, string[][], string[]]> = [
      ["Each interview ran 30 minutes, and the interview slot moved.", [["Each interview is booked into a free slot."]], ["Each interview", "the interview"]],
      ["The word error rate in the transcript fell to 4 percent.", [["Each call becomes a transcript."]], ["in the transcript"]],
      ["The totals from the credit memo matched the ledger.", [["Credit memos are matched to invoices."]], ["from the credit memo"]],
      ["Each source puts 5 W on the target, and both sources differ by 2 nm.", [["Two sources illuminate the sample."]], ["Each source puts", "both sources differ"]],
    ];
    for (const [text, plan, found] of cases) {
      expect(phrases(text)).toEqual(found);
      expect(phrases(text, plan)).toEqual([]);
    }
    // A Glossary Term is subject too.
    expect(phrases("The totals from the credit memo matched.", [], ["credit memo"])).toEqual([]);
    // A different noun phrase is no subject: "interview slots" holds no bare
    // interview, a speech-to-text "transcription" is not "the transcript".
    expect(phrases("Each interview ran 30 minutes.", [["The engine ranks interview slots."]])).toEqual(["Each interview"]);
    expect(phrases("The word error rate in the transcript fell.", [["Speech-to-text transcription of call audio."]])).toEqual(["in the transcript"]);
  });

  it("always reports a reporting phrase, whatever the subject (Greptile round, lead decision)", () => {
    // A document-management project: its documents are its subject, but
    // "The documents say" still names a source.
    const documents = [["The system indexes the documents each team uploads."], ["Each document is tagged by its owner."]];
    expect(phrases("The documents say the ramp was slowed.", documents)).toEqual(["The documents say"]);
    expect(phrases("The event log indicated a 40 ms stall.", [["The agent parses event logs."]])).toEqual(["The event log indicated"]);
    expect(phrases("The log shows a 40 ms stall.", [["The agent parses the log."]])).toEqual(["The log shows"]);
    expect(phrases("The credit memo states 2.4 percent.", [["Credit memos are matched to invoices."]])).toEqual(["The credit memo states"]);
    expect(phrases("According to the interview, the flow held.", [["Each interview is booked into a free slot."]])).toEqual(["According to the interview"]);
    expect(phrases("The engine ranked each interviewee.", [["The engine schedules each interviewee."]])).toEqual(["interviewee"]);
    expect(phrases("The ramp time was recorded elsewhere as 3 hours.", [["Ramp times are recorded per load."]])).toEqual(["recorded elsewhere"]);
  });

  it("re-check: a subject word matches only as the same noun, and a source only with the same modifier", () => {
    // A verb or an adjective is no subject: "documented", "logged",
    // "transcribed" and "interviewing" silence nothing.
    const verbs: Array<[string, string[][], string[]]> = [
      ["The documents say the ramp was slowed.", [["No documented method existed for grading templates."]], ["The documents say"]],
      ["The log notes a 40 ms stall.", [["Each fault was logged by the controller."]], ["The log notes"]],
      ["The transcript says the ramp was slowed.", [["Every call was transcribed by hand."]], ["The transcript says"]],
      ["The two interviewees differ on the driver.", [["Interviewing staff took a week."]], ["interviewees"]],
    ];
    for (const [text, plan, found] of verbs) expect(phrases(text, plan)).toEqual(found);
    // "according to the minutes" is a reporting phrase: it always counts.
    expect(phrases("According to the minutes, the ramp was slowed.", [["Each cycle took 4 minutes."]])).toEqual(["According to the minutes"]);
    expect(phrases("According to the minutes, the ramp was slowed.", [["The engine summarizes meeting minutes."]])).toEqual(["According to the minutes"]);
    // A "source of error" or a light source is not the project's bare sources.
    const errorSource = [["The main source of error was glare on machined faces."]];
    expect(phrases("According to the sources, the ramp was slowed.", errorSource)).toEqual(["According to the sources"]);
    expect(phrases("The two sources differ on the driver.", errorSource)).toEqual(["The two sources differ"]);
    expect(phrases("roughly 7 to 8 percent below the baseline depending on the measurement source", errorSource))
      .toEqual(["depending on the measurement source"]);
    const lightSources = [["Two light sources illuminate the sample."]];
    expect(phrases("Each source puts 5 W on the target, and both sources differ by 2 nm.", lightSources))
      .toEqual(["Each source puts", "both sources differ"]);
    // A reporting phrase counts even with the same modifier.
    expect(phrases("According to the light sources, glare fell.", lightSources)).toEqual(["According to the light sources"]);
    // The same modifier silences its own phrase only.
    const measurement = [["A second measurement source feeds the flow model."]];
    expect(phrases("7 to 8 percent below the baseline depending on the measurement source", measurement)).toEqual([]);
    expect(phrases("According to the sources, the flow held.", measurement)).toEqual(["According to the sources"]);
  });

  it("matches Storyline and Confidence Map by case only", () => {
    expect(phrases("The storyline engine branched at each choice.")).toEqual([]);
    expect(phrases("A stereo confidence map rated each pixel.")).toEqual([]);
    expect(phrases("The Storyline says so, and the Confidence Map agrees.")).toEqual(["Storyline", "Confidence Map"]);
  });

  it("still finds all four run 10 and 11 phrases in the real run 11 text, with the real subject", () => {
    const fixture = run11.fixtures as Record<string, { planWording: string[][]; glossaryTerms: string[]; sections: Record<string, string> }>;
    const found = (id: string, section: string) => {
      const entry = fixture[id]!;
      return phrases(entry.sections[section]!, entry.planWording, entry.glossaryTerms);
    };
    expect(found("carried-old-selections", "s242")).toContain("interviewees");
    expect(found("carried-old-selections", "s244")).toEqual(expect.arrayContaining(["recorded elsewhere", "depending on the measurement source"]));
    expect(found("withdrawn-feedback", "s244")).toContain("the test memo indicates");
    expect(found("withdrawn-feedback", "s246")).toEqual([]);
  });
});
