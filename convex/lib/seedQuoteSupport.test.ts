import { describe, expect, it } from "vitest";
import {
  canJudgeQuote,
  contentWords,
  excerptSupportsSeed,
  quoteCheckIssues,
  quotesExcerpt,
  sharedContentWords,
  unbackedBullets,
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

describe("word forms, numbers and units (review P3-6)", () => {
  it.each([
    ["cure", "curing"],
    ["cure", "cured"],
    ["bake", "baking"],
    ["mix", "mixed"],
    ["run", "running"],
    ["tap", "tapped"],
    ["fill", "filled"],
    ["12", "twelve"],
    ["23", "twenty-three"],
    ["fibre", "fiber"],
    ["millimetres", "mm"],
  ])("reads %s and %s as one word", (left, right) => {
    expect(contentWords(left)).toEqual(contentWords(right));
  });

  it("reads degree signs, percent signs and glued units as words", () => {
    expect(sharedContentWords("Bonds cured at 5 degrees Celsius held 15 MPa.", "cure at 5°C holds 15MPa")).toBe(6);
    expect(sharedContentWords("Retention stayed above eighty percent.", "retention above 80%")).toBe(3);
  });

  it("keeps different words apart", () => {
    expect(sharedContentWords("The process was slow.", "The procedure was slow.")).toBe(1);
    expect(contentWords("speed")).toEqual(["speed"]);
  });
});

describe("quotes the word check cannot judge are never marked (review P2-3)", () => {
  // Fictional lines from a made-up Lyon bonding interview.
  const french = "Nous collons les supports à cinq degrés et la colle durcit en deux jours.";
  const chinese = "我们在五度下粘接支架，胶水两天后固化。";
  const english = "Brackets were bonded at five degrees and the adhesive cured in two days.";

  it("does not judge a French quote behind an English card", () => {
    expect(canJudgeQuote(english, french)).toBe(false);
    expect(quoteCheckIssues([{ bullets: [english], provenance: [citation("cap", {})].map((item) => ({ ...item, exactExcerpt: french })) }], { reuse: true })).toEqual([]);
  });

  it("still judges a French quote behind a French card", () => {
    const card = "Les supports sont collés à cinq degrés et la colle durcit en deux jours.";
    expect(canJudgeQuote(card, french)).toBe(true);
    expect(excerptSupportsSeed(card, french)).toBe(true);
    expect(canJudgeQuote("Nous testons les capteurs sur les mâts et les tours.", french)).toBe(true);
    expect(excerptSupportsSeed("Nous testons les capteurs sur les mâts et les tours.", french)).toBe(false);
  });

  it("does not judge a Chinese quote, behind an English or a Chinese card", () => {
    expect(canJudgeQuote(english, chinese)).toBe(false);
    expect(canJudgeQuote("支架在五度下粘接。", chinese)).toBe(false);
    const seeds = [
      { bullets: [english], provenance: [{ ...citation("cap"), exactExcerpt: chinese }] },
      { bullets: ["支架在五度下粘接。"], provenance: [{ ...citation("cap"), exactExcerpt: chinese }] },
    ];
    expect(quoteCheckIssues(seeds, { reuse: true })).toEqual([]);
  });

  it("does not judge a quote with no usable words", () => {
    expect(canJudgeQuote(english, "and so, we did it")).toBe(false);
    expect(canJudgeQuote(english, "12:30")).toBe(false);
    expect(
      quoteCheckIssues([{ bullets: [english], provenance: [{ ...citation("cap"), exactExcerpt: "and so, we did it" }] }], { reuse: true })
    ).toEqual([]);
  });
});

describe("unbackedBullets (2026-10-04, second, round 3 and its review)", () => {
  const steel = { exactExcerpt: "Normal powder for steel cures at 160 to 200 C.", needsQuoteCheck: true };
  const limitation = [
    "Standard datasheet powder processes are built for flat steel-like panels, not thick routed MDF.",
    "No prior process showed whether MDF could reach conductivity without heat that triggers outgassing defects.",
  ];
  const advancement = [
    "The team learned that outgassing defects track peak panel surface temperature rather than dwell time on this board.",
    "Trial 1's datasheet process confirmed that heat built for flat steel panels causes severe outgassing defects on routed MDF edges.",
  ];
  const moisture = { exactExcerpt: "The moisture that gives you conductivity is the same moisture that outgasses, so we didn't know if there was any setting that did both." };
  const peak = { exactExcerpt: "And that on our board the pinholes track the peak board temperature, not the time." };
  const datasheet = { exactExcerpt: "That the datasheet number is for flat panels." };
  const thinFlat = { exactExcerpt: "It does, on thin flat panels, and that's what the suppliers show you." };

  it("names the sentence of each run 6 Seed that only its marked steel quote stood behind", () => {
    expect(unbackedBullets(limitation, [moisture, steel])).toEqual([limitation[0]]);
    expect(unbackedBullets(advancement, [peak, steel])).toEqual([advancement[1]]);
  });

  it("re-check P3-2: with every quote marked, names every sentence, since no quote is left to back one", () => {
    expect(unbackedBullets(limitation, [steel])).toEqual(limitation);
    expect(unbackedBullets(advancement, [steel])).toEqual(advancement);
    // Only the sentences left to judge.
    expect(unbackedBullets([limitation[0]], [steel], limitation)).toEqual([limitation[0]]);
  });

  it("re-check P3-1: of the sentences holding a marked quote's word, one another quote backs is not named", () => {
    const seed = [
      "Standard powder processes are built for flat steel panels.",
      "Low-temperature powder on MDF outgasses at the routed edges.",
    ];
    // Backs the second sentence, without the word "powder".
    const edges = { exactExcerpt: "Low-temperature coatings on MDF outgas at the routed edges, where the fibres open." };
    expect(unbackedBullets(seed, [edges, steel])).toEqual([seed[0]]);
  });

  it("review P2-1: names the steel sentence even beside a good quote that shares other words with it", () => {
    // Each good quote shares "datasheet", "flat" or "panel" with the steel
    // sentence; the other sentence has its own quote, so only the steel one is named.
    expect(unbackedBullets(limitation, [datasheet, moisture, steel])).toEqual([limitation[0]]);
    expect(unbackedBullets(limitation, [thinFlat, moisture, steel])).toEqual([limitation[0]]);
    expect(unbackedBullets(advancement, [datasheet, peak, steel])).toEqual([advancement[1]]);
    expect(unbackedBullets(advancement, [thinFlat, peak, steel])).toEqual([advancement[1]]);
  });

  it("Greptile on PR #26 at 1da92721: checks every sentence, so one no quote backs is named beside the steel sentence", () => {
    // The good quote backs neither sentence's own claim: the steel sentence
    // is named for "steel", and the other because no quote backs it.
    expect(unbackedBullets(limitation, [datasheet, steel])).toEqual(limitation);
    expect(unbackedBullets(advancement, [datasheet, steel])).toEqual(advancement);
    expect(unbackedBullets(limitation, [thinFlat, steel])).toEqual(limitation);
    // The steel sentence, named through the marked quote, and a second
    // sentence nothing backs: both named.
    const third = "The line ran at 2.5 metres per minute throughout.";
    expect(unbackedBullets([...limitation, third], [moisture, steel])).toEqual([limitation[0], third]);
  });

  it("names the sentences no quote backs when a marked quote shares no word with the Seed", () => {
    const knot = { exactExcerpt: "Mireille Strand: That was the knot.", needsQuoteCheck: true };
    expect(unbackedBullets(limitation, [moisture, knot])).toEqual([limitation[0]]);
  });

  it("names nothing for a Seed with no marked quote, even a sentence no quote backs", () => {
    expect(unbackedBullets(limitation, [moisture])).toEqual([]);
    expect(unbackedBullets(limitation, [])).toEqual([]);
  });

  it("review P3-2: a quote marked only because another Seed reused it still backs its sentence", () => {
    // The moisture line shares enough words with the Seed: a reuse mark, not an unrelated one.
    expect(unbackedBullets(limitation, [{ ...moisture, needsQuoteCheck: true }, datasheet])).toEqual([]);
    // Judged against the Seed's own wording, not only the sentences left to judge.
    expect(unbackedBullets([limitation[1]], [{ ...moisture, needsQuoteCheck: true }], limitation)).toEqual([]);
  });

  it("review P2-2: names an unchanged steel sentence beside a changed one, and nothing once the writer rewrote it", () => {
    expect(unbackedBullets([limitation[0]], [datasheet, steel], limitation)).toEqual([limitation[0]]);
    expect(unbackedBullets([limitation[1]], [datasheet, moisture, steel], limitation)).toEqual([]);
    // An unchanged sentence no quote backs is still named (Greptile at 1da92721).
    expect(unbackedBullets([limitation[1]], [datasheet, steel], limitation)).toEqual([limitation[1]]);
  });

  it("never names a sentence beside a quote the word check cannot judge", () => {
    const french = { exactExcerpt: "Nous testons les capteurs sur les mâts et les tours." };
    expect(unbackedBullets(["The sensors were tested on masts and towers."], [french, steel])).toEqual([]);
  });
});
