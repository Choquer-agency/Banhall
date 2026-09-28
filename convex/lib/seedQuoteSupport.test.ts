import { describe, expect, it } from "vitest";
import {
  contentWords,
  excerptSupportsSeed,
  quoteCheckIssues,
  quotesExcerpt,
  sharedContentWords,
} from "./seedQuoteSupport";

// Fictional lines modelled on the Northwind live-test transcript (a made-up
// bonding project), the fixture the thresholds were tuned on.
const LINES = {
  company:
    "Northwind is a test and instrumentation company. We design and install sensor packages for customers who need long-term structural monitoring.",
  mount:
    "We mount strain gauges, accelerometers and temperature probes on composite brackets, and those brackets have to be attached to the structure somehow.",
  drill: "Historically we attached them mechanically. Drill, tap, bolt. But the structure owners hate holes.",
  hole: "A hole in a fibreglass turbine blade root or in a coated steel mast is a corrosion or crack initiation site",
  datasheet:
    "Every structural adhesive data sheet assumes you cure at room temperature or above, usually twenty-three degrees, and many of them want an elevated post-cure.",
  outdoor:
    "Our installs happen outdoors, often in the shoulder seasons or in winter, at sites where the surface temperature of the structure is somewhere between minus five and plus ten degrees.",
  lead: "I'm Maren Kowalczyk, senior materials engineer at Northwind Test Labs. I've been here about six years.",
  hotWork:
    "a couple of our customers have rules about hot work and heat sources near their equipment, because of the resin systems in the blades and the lubricants in the nacelle.",
  cap: "One customer caps any surface heat source at thirty-five degrees and wants it attended the whole time.",
} as const;
type Line = keyof typeof LINES;

// Cards that cite the line their claim comes from (the run where all five
// first cards underlined).
const SUPPORTED: Array<[string, Line]> = [
  ["Northwind is a test and instrumentation company that mounts sensor packages on wind turbine towers, telecom masts and bridge structures.", "company"],
  ["It designs and installs strain gauges, accelerometers and temperature probes on composite brackets attached to customer structures.", "mount"],
  ["Historically brackets were attached mechanically by drilling, tapping and bolting into the structure.", "drill"],
  ["Customers increasingly prohibit drilling because holes create corrosion or crack initiation sites in the structure.", "hole"],
  ["Standard structural adhesive data sheets assume room temperature curing near twenty-three degrees, often with an elevated post-cure.", "datasheet"],
  ["Northwind's outdoor installs occur at surface temperatures between minus five and plus ten degrees Celsius.", "outdoor"],
  ["The senior materials engineer has led similar formulation and thermal analysis work for six years at the company.", "lead"],
  ["Site rules at several customers prohibit or sharply limit attended heat sources near turbine electronics and resin systems.", "hotWork"],
  ["One customer caps any surface heat source at thirty-five degrees and requires constant attendance.", "cap"],
];

// Cards that cite a neighbouring or unrelated line (the run where none of
// the first cards underlined).
const UNRELATED: Array<[string, Line]> = [
  ["The technical lead is a senior materials engineer with about six years at the company.", "company"],
  ["Historically Northwind attached sensor brackets mechanically by drilling, tapping and bolting into the host structure.", "company"],
  ["Customer sites impose hot-work restrictions near turbine resin systems and electronics that limit heating options.", "mount"],
  ["The outdoor test yard, with retired tower sections and composite panels, enabled realistic field weather testing.", "hole"],
  ["A junior engineer and a technician supported the trials, with chemical engineering and field backgrounds.", "datasheet"],
  ["Northwind is a test and instrumentation company installing sensor packages on wind turbine towers.", "cap"],
  ["The field lead is a mechanical engineering technologist with fifteen years of experience in field instrumentation.", "lead"],
];

function share(seed: string, excerpt: string): number {
  return sharedContentWords(seed, excerpt) / Math.min(contentWords(seed).length, contentWords(excerpt).length);
}

describe("contentWords", () => {
  it("drops stop words and fillers and folds plurals and possessives", () => {
    expect(contentWords("Yeah, so we basically mount the brackets on Northwind's masts.")).toEqual([
      "mount",
      "bracket",
      "northwind",
      "mast",
    ]);
  });

  it("treats the words every interview uses about itself as stop words", () => {
    expect(contentWords("The project team did the work at the company.")).toEqual([]);
  });
});

describe("excerptSupportsSeed on the Northwind fixture", () => {
  it.each(SUPPORTED)("keeps a card that cites its own line: %s", (seed, line) => {
    expect(excerptSupportsSeed(seed, LINES[line])).toBe(true);
    expect(sharedContentWords(seed, LINES[line])).toBeGreaterThanOrEqual(5);
    expect(share(seed, LINES[line])).toBeGreaterThanOrEqual(0.4);
  });

  it.each(UNRELATED)("flags a card that cites another line: %s", (seed, line) => {
    expect(excerptSupportsSeed(seed, LINES[line])).toBe(false);
    expect(sharedContentWords(seed, LINES[line])).toBeLessThanOrEqual(3);
    expect(share(seed, LINES[line])).toBeLessThan(0.3);
  });

  it("matches word forms: cure and cured, drill and drilling, structure and structural", () => {
    expect(sharedContentWords("They cured it after drilling the structural frame.", "Cure, drill, structure.")).toBe(3);
    expect(sharedContentWords("The process was slow.", "The procedure was slow.")).toBe(1);
  });

  it("asks a short excerpt for all of its meaningful words, up to two", () => {
    expect(excerptSupportsSeed("Holes cause corrosion in coated masts.", "corrosion")).toBe(true);
    expect(excerptSupportsSeed("Holes cause corrosion in coated masts.", "corrosion or cracking")).toBe(false);
    expect(excerptSupportsSeed("Holes cause corrosion and cracking.", "corrosion or cracking")).toBe(true);
  });

  it("never supports a Seed with an excerpt of stop words only", () => {
    expect(excerptSupportsSeed("We did the work.", "we did the work")).toBe(false);
  });
});

describe("quotesExcerpt", () => {
  it("is the card's underline test", () => {
    expect(quotesExcerpt(["One customer caps any surface heat source at thirty-five degrees."], LINES.cap)).toBe(true);
    expect(quotesExcerpt(["A customer limits heaters to thirty-five degrees."], LINES.cap)).toBe(false);
  });
});

function citation(line: Line, extra: { factId?: string; sourceId?: string } = {}) {
  const start = Object.keys(LINES).indexOf(line) * 1000;
  return {
    sourceId: extra.sourceId ?? "source-1",
    startOffset: start,
    endOffset: start + LINES[line].length,
    exactExcerpt: LINES[line],
    ...(extra.factId ? { factId: extra.factId } : {}),
  };
}

describe("quoteCheckIssues", () => {
  it("finds nothing in a good Batch", () => {
    const seeds = SUPPORTED.slice(0, 5).map(([bullet, line]) => ({ bullets: [bullet], provenance: [citation(line)] }));
    expect(quoteCheckIssues(seeds, { reuse: true })).toEqual([]);
  });

  it("flags each unrelated citation and leaves the related one on the same Seed", () => {
    const seeds = [
      { bullets: [SUPPORTED[0][0]], provenance: [citation("company")] },
      { bullets: [UNRELATED[0][0]], provenance: [citation("lead"), citation("company")] },
      { bullets: [UNRELATED[2][0]], provenance: [citation("mount")] },
    ];
    expect(quoteCheckIssues(seeds, { reuse: true })).toEqual([
      { code: "CITATION_UNRELATED", seedIndex: 1, citationIndex: 1 },
      { code: "CITATION_UNRELATED", seedIndex: 2, citationIndex: 0 },
    ]);
  });

  it("flags an excerpt reused on a second card that does not quote it", () => {
    const seeds = [
      // Paraphrases the line; shares the most words with it.
      { bullets: ["Northwind is a test and instrumentation company that installs sensor packages for structural monitoring customers."], provenance: [citation("company")] },
      // Related enough to pass alone, but the claim is another one.
      { bullets: ["Northwind sensor packages give customers long-term monitoring data on towers."], provenance: [citation("company")] },
    ];
    expect(quoteCheckIssues(seeds, { reuse: true })).toEqual([
      { code: "CITATION_REUSED", seedIndex: 1, citationIndex: 0 },
    ]);
  });

  it("gives a reused excerpt to the card that quotes it, and keeps it on every card that quotes it", () => {
    const quoting = "Its customers need long-term structural monitoring on towers and masts.";
    const paraphrase = "Northwind tests and instruments structures, installing sensor packages for its customers.";
    const seeds = [
      { bullets: [paraphrase], provenance: [citation("company")] },
      { bullets: [quoting], provenance: [citation("company")] },
      { bullets: [`Northwind builds sensor packages; ${quoting.toLowerCase()}`], provenance: [citation("company")] },
    ];
    expect(quoteCheckIssues(seeds, { reuse: true })).toEqual([
      { code: "CITATION_REUSED", seedIndex: 0, citationIndex: 0 },
    ]);
  });

  it("does not look for reuse among the Revised Seeds of one Feedback request", () => {
    const seeds = [
      { bullets: ["Northwind is a test and instrumentation company that installs sensor packages."], provenance: [citation("company")] },
      { bullets: ["Northwind installs sensor packages as a test and instrumentation company."], provenance: [citation("company")] },
    ];
    expect(quoteCheckIssues(seeds, { reuse: false })).toEqual([]);
  });

  it("judges a fact's quotes together: one related quote clears the fact", () => {
    const seeds = [
      {
        bullets: [SUPPORTED[8][0]],
        provenance: [citation("cap", { factId: "F1-4" }), citation("hotWork", { factId: "F1-4" })],
      },
      {
        bullets: [UNRELATED[0][0]],
        provenance: [citation("cap", { factId: "F1-9" }), citation("outdoor", { factId: "F1-9" })],
      },
    ];
    expect(quoteCheckIssues(seeds, { reuse: true })).toEqual([
      { code: "CITATION_UNRELATED", seedIndex: 1, citationIndex: 0 },
      { code: "CITATION_UNRELATED", seedIndex: 1, citationIndex: 1 },
    ]);
  });

  it("does not count the same words in two sources as reuse", () => {
    const seeds = [
      { bullets: [SUPPORTED[8][0]], provenance: [citation("cap")] },
      { bullets: ["A customer caps surface heat sources at thirty-five degrees during installs."], provenance: [citation("cap", { sourceId: "source-2" })] },
    ];
    expect(quoteCheckIssues(seeds, { reuse: true })).toEqual([]);
  });
});
