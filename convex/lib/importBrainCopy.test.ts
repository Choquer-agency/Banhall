// The Brain copy of an imported final PD (2026-11-17): the scrub, the
// independent leak check, the neutral title, the industry refusal and the
// writer tier default. Every company and person here is made up.
import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  IMPORT_BRAIN_DEFAULT_WRITER_TIER,
  IMPORT_BRAIN_REFUSALS,
  buildImportBrainCopy,
  camelParts,
  companyNameVariants,
  domainStem,
  findAlsoRemoveLeak,
  findIdentityLeak,
  importBrainTitle,
  scrubImportText,
  websiteHost,
  type ImportBrainCopyInput,
} from "./importBrainCopy";

const itemId = "ingestionItems:1" as unknown as Id<"ingestionItems">;

function input(overrides: Partial<ImportBrainCopyInput> = {}, item: Partial<ImportBrainCopyInput["item"]> = {}): ImportBrainCopyInput {
  return {
    item: {
      _id: itemId,
      name: "04 QuillmereAnalytics 2024-03-31 T2.DW.PN Sensor Drift.docx",
      clientName: "Quillmere Analytics Ltd.",
      companyKey: "quillmere analytics ltd.",
      category: "final_pd",
      contentHash: "bytes-hash-1",
      fiscalYear: 2024,
      ...item,
    },
    company: { name: "Quillmere Analytics Ltd.", industry: "software", website: "https://www.quillmere.example/about" },
    identity: { organizations: ["Quillmere Analytics Ltd."], people: ["Priya Rautio"] },
    writer: null,
    ...overrides,
  };
}

const PD = [
  "Prepared by Dana Whitlock",
  "",
  "Quillmere Analytics Ltd. (Quillmere) builds sensor platforms. QUILLMERE tried a drift model.",
  "Quillmere's QuillmereCloud service failed under load; see www.quillmere.example or write to info@quillmere.example.",
  "Priya Rautio led the work. The team measured analytics latency on the sensor array.",
].join("\n");

function scrubWith(names: string[], text: string, people: string[] = [], hosts: string[] = []) {
  const stems = hosts.map(domainStem).filter((s): s is string => !!s);
  const variants = companyNameVariants(names, stems);
  const scrubbed = scrubImportText(text, { organizations: names, people, hosts }, variants);
  return { scrubbed, leak: findIdentityLeak(scrubbed, names, stems), variants };
}

/** A copy of the test PD for a company with these names and no other record. */
function copyFor(name: string, text: string, extra: Partial<ImportBrainCopyInput> = {}) {
  return buildImportBrainCopy(
    input(
      { company: { name, industry: "software" }, identity: { organizations: [], people: [] }, ...extra },
      { clientName: name, companyKey: name.toLowerCase(), name: "PD.docx" }
    ),
    text
  );
}

describe("scrub and leak check", () => {
  test("a multi-word name, its coined first word, CamelCase, capitals, the domain and an email are hidden", () => {
    const result = buildImportBrainCopy(input(), PD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const content = result.fields.content;
    expect(content).not.toMatch(/quillmere/i);
    expect(content).not.toMatch(/Dana Whitlock|Priya Rautio/);
    expect(content).toContain("[redacted]Cloud");
    expect(content).toContain("[redacted email]");
    // Ordinary words of the name stay: "analytics" alone is not the company.
    expect(content).toContain("analytics latency on the sensor array");
    // Paragraphs are kept.
    expect(content.split("\n")).toHaveLength(PD.split("\n").length);
  });

  test("a name of ordinary words: the phrase, its joined form, its first two words and its initialism go, the words alone stay", () => {
    const { scrubbed, leak } = scrubWith(
      ["Northern Equity Partners Inc."],
      "Northern Equity Partners Inc. reviewed the northern site. NorthernEquity and NEP ran a northern-equity partners trial. Northern equity markets."
    );
    expect(leak).toBeNull();
    expect(scrubbed).not.toMatch(/northern[^a-z]{0,6}equity/i);
    expect(scrubbed).not.toMatch(/\bNEP\b/);
    expect(scrubbed).toContain("the northern site");
  });

  test("an initialism is hidden as written, dotted or joined to a word", () => {
    const { scrubbed, leak } = scrubWith(
      ["J.R.T. Nurseries"],
      "JRT Nurseries grew seedlings. J.R.T. measured roots. JRTNurseries logged it. The jrt flag is unrelated."
    );
    expect(leak).toBeNull();
    expect(scrubbed).not.toMatch(/JRT|J\.R\.T/);
    expect(scrubbed).toContain("[redacted] measured roots");
    // Lower case is not the initialism.
    expect(scrubbed).toContain("The jrt flag");
  });

  test("a hyphenated domain stem is hidden as a phrase and joined", () => {
    const host = websiteHost("https://shop.harrowfield-farms.example/about");
    expect(host).toBe("shop.harrowfield-farms.example");
    expect(domainStem(host!)).toBe("harrowfield-farms");
    const { scrubbed, leak } = scrubWith(
      ["Harrowfield Farms"],
      "Orders came from shop.harrowfield-farms.example and the HarrowfieldFarms app; harrowfield farms staff confirmed.",
      [],
      [host!]
    );
    expect(leak).toBeNull();
    expect(scrubbed).not.toMatch(/harrowfield/i);
  });

  test("a name inside another word is never hidden or flagged", () => {
    const text = "Ionization rose in the lab. The Ionlabsx rig and IONIC baths were fine.";
    const { scrubbed, leak } = scrubWith(["Ion Labs"], text);
    expect(scrubbed).toBe(text);
    expect(leak).toBeNull();
    const single = scrubWith(["Acme"], "Acmeist and PACME texts stay.");
    expect(single.scrubbed).toBe("Acmeist and PACME texts stay.");
    expect(single.leak).toBeNull();
  });

  test("the leak check builds its own forms and finds each one", () => {
    const names = ["Verdant Grid Technologies"];
    for (const text of [
      "VERDANT GRID said so.",
      "verdant-grid units",
      "the VerdantGridOS image",
      "visit verdantgrid.example",
      "Verdant\u2019s plan",
      "V\u00e9rdant Grid",
      "Ve\u0301rdant Grid",
    ]) {
      expect(findIdentityLeak(text, names, ["verdantgrid"]), text).not.toBeNull();
    }
    expect(findIdentityLeak("fields of verdant moss", names)).toBe("verdant");
    expect(findIdentityLeak("green fields and technologies", names)).toBeNull();
    // Each word of four letters or more that is not ordinary, wherever it sits in the name.
    expect(findIdentityLeak("Quillmere's team", ["The Quillmere Group"])).toBe("quillmere");
    expect(findIdentityLeak("Quillmere's team", ["Les Industries Quillmere Inc."])).toBe("quillmere");
  });

  test("a form the scrub misses refuses the copy in plain words", () => {
    const result = buildImportBrainCopy(
      input(
        {
          company: { name: "Northern Equity Partners", industry: "manufacturing" },
          identity: { organizations: [], people: [] },
        },
        { clientName: "Northern Equity Partners", companyKey: "northern equity partners", name: "PD.docx" }
      ),
      "The Northern ------- Equity ------- Partners team (seven hyphens apart) built a kiln."
    );
    expect(result).toMatchObject({
      ok: false,
      code: "names_left",
      reason: 'The Brain copy would still name the company ("northern equity partners"), so it was not made. The final PD still goes on the company\'s page.',
    });
  });

  test("camel parts split at inner capitals and digits", () => {
    expect(camelParts("VerdantGridOS").map((p) => p.text)).toEqual(["Verdant", "Grid", "OS"]);
    expect(camelParts("JRTNurseries").map((p) => p.text)).toEqual(["JRT", "Nurseries"]);
    expect(camelParts("Acme2").map((p) => p.text)).toEqual(["Acme", "2"]);
  });
});

describe("review fixes: every distinctive word, numbers, addresses, people, accents, acronyms", () => {
  test.each([
    "The Quillmere Group",
    "Advanced Quillmere Technologies",
    "Blue Quillmere Labs",
    "Les Industries Quillmere Inc.",
  ])("a distinctive word anywhere in %s is hidden alone", (name) => {
    const result = copyFor(name, "Quillmere's team ran the kiln. QUILLMERE logged it.");
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.fields.content).toBe("[redacted]'s team ran the kiln. [redacted] logged it.");
  });

  test("Business Numbers, a postal code and its address are hidden; other numbers stay", () => {
    const text = [
      "BN 123456789 RC0001 and 987654321 are on file; 123 456 789 RT 0001 too.",
      "Quillmere Analytics Ltd.",
      "12 Main Street",
      "Ottawa, ON K1A 0B1",
      `The lab, at 400 Bank Road, Kanata, ON K2K 3J4, ran ${"long ".repeat(30)}trials.`,
      "Serial 1234567890 and 0.123456789 and 555-123-456 stay.",
    ].join("\n");
    const result = copyFor("Quillmere Analytics Ltd.", text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.fields.content.split("\n");
    expect(lines[0]).toBe("BN [redacted number] and [redacted number] are on file; [redacted number] too.");
    expect(lines.slice(1, 4)).toEqual(["[redacted]", "[redacted address]", "[redacted address]"]);
    expect(lines[4]).toMatch(/^The lab, at \[redacted address\], ran long /);
    expect(lines[5]).toBe("Serial 1234567890 and 0.123456789 and 555-123-456 stay.");
  });

  test("a two-word name's initials are hidden in a project code and in CamelCase", () => {
    const result = copyFor("Quillmere Mira Inc.", "Project 2024-QM-07 ran on QMCloud. QA and PD stayed.");
    expect(result.ok && result.fields.content).toBe("Project 2024-[redacted]-07 ran on [redacted]Cloud. QA and PD stayed.");
  });

  test("people named next to a title, a role or a cue are hidden, with their surname", () => {
    const text = [
      "Dr. Anjali Verma, CTO, led the work. Verma signed it.",
      "CTO Raj Patel and Mei Tanaka (Director) reviewed it.",
      "The trial was led by Tomas Lindqvist; we spoke with Ines Moreau.",
      "The Quality Control Manager and Senior Engineer stayed.",
    ].join("\n");
    const result = copyFor("Quillmere Analytics", text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.content).toBe(
      [
        "Dr. [redacted], CTO, led the work. [redacted] signed it.",
        "CTO [redacted] and [redacted] (Director) reviewed it.",
        "The trial was led by [redacted]; we spoke with [redacted].",
        "The Quality Control Manager and Senior Engineer stayed.",
      ].join("\n")
    );
  });

  test("words the person approving adds are hidden and checked too (product names are not detected)", () => {
    const text = "The Kilnwise controller and KilnWise app shipped.";
    expect(copyFor("Quillmere Analytics", text).ok && (copyFor("Quillmere Analytics", text) as { fields: { content: string } }).fields.content).toBe(text);
    const removed = copyFor("Quillmere Analytics", text, { alsoRemove: ["Kilnwise"] });
    expect(removed.ok && removed.fields.content).toBe("The [redacted] controller and [redacted] app shipped.");
  });

  test("a short Also remove entry is hidden as a whole word in any case and accent, and checked (Greptile P2)", () => {
    const text = "Dr. Li ran the kiln. LI and li signed; L\u00ed too. LiDAR, Lithium and Lin stay.";
    const li = copyFor("Quillmere Analytics", text, { alsoRemove: ["Li"] });
    expect(li).toMatchObject({ ok: true });
    expect(li.ok && li.fields.content).toBe(
      "Dr. [redacted] ran the kiln. [redacted] and [redacted] signed; [redacted] too. LiDAR, Lithium and Lin stay."
    );

    const ab = copyFor("Quillmere Analytics", "AB built it; ab, A.B. and Ab too. ABC and Lab stay.", { alsoRemove: ["AB"] });
    expect(ab.ok && ab.fields.content).toBe("[redacted] built it; [redacted], [redacted]. and [redacted] too. ABC and Lab stay.");

    // A phrase is hidden as a phrase: "Li" on its own is not what was typed.
    const drLi = copyFor("Quillmere Analytics", "Dr Li and dr. li met; Li stayed.", { alsoRemove: ["  Dr Li "] });
    expect(drLi.ok && drLi.fields.content).toBe("[redacted] and [redacted] met; Li stayed.");
  });

  test("an Also remove entry with a symbol at an edge is matched as typed, never as its bare word", () => {
    const text = "Written in C++ and C# on .NET; section C and net savings stay.";
    const typed = copyFor("Quillmere Analytics", text, { alsoRemove: ["C++", "C#", ".NET"] });
    expect(typed.ok && typed.fields.content).toBe("Written in [redacted] and [redacted] on [redacted]; section C and net savings stay.");
    expect(findAlsoRemoveLeak("Built on C++ here.", ["C++"])).toBe("C++");
    expect(findAlsoRemoveLeak("Section C here.", ["C++"])).toBeNull();
  });

  test("the Also remove check finds a typed entry the scrub left, whole words only", () => {
    expect(findAlsoRemoveLeak("Dr. Li ran it.", ["Li"])).toBe("Li");
    expect(findAlsoRemoveLeak("A.B. ran it.", ["AB"])).toBe("AB");
    expect(findAlsoRemoveLeak("Dr Li ran it.", ["Dr Li"])).toBe("Dr Li");
    expect(findAlsoRemoveLeak("LiDAR and Lithium.", ["Li"])).toBeNull();
    expect(findAlsoRemoveLeak("Dr. Lin and Li-ion.", ["Dr Li"])).toBeNull();
    // The copy's own markers are not words.
    expect(findAlsoRemoveLeak("[redacted] and [redacted number].", ["redacted", "number"])).toBeNull();
  });

  test("an Also remove phrase wrapped across lines or columns is still hidden (Greptile on #44)", () => {
    const text = "Interview with Dr\n        Li of the plant, and Dr.\n\tLi again.";
    const copy = copyFor("Quillmere Analytics", text, { alsoRemove: ["Dr Li"] });
    expect(copy.ok).toBe(true);
    expect(copy.ok && copy.fields.content).not.toMatch(/Li/);
    // The leak check reads words, not gaps, so it still flags the words
    // however they are spaced: the safe direction.
    expect(findAlsoRemoveLeak("Dr ------- Li", ["Dr Li"])).toBe("Dr Li");
  });

  test("an Also remove entry of only spaces or punctuation is refused in plain words; a blank one is no entry", () => {
    for (const entry of ["   ", "--", "(.)"]) {
      expect(copyFor("Quillmere Analytics", "Kiln work.", { alsoRemove: ["Kilnwise", entry] })).toMatchObject({
        ok: false,
        code: "also_remove_no_word",
        reason: IMPORT_BRAIN_REFUSALS.also_remove_no_word,
      });
    }
    expect(copyFor("Quillmere Analytics", "Kiln work.", { alsoRemove: [""] })).toMatchObject({ ok: true });
  });

  test("accents and composed or decomposed text are matched both ways and replaced as written", () => {
    const one = copyFor("Verdane Robotics", "V\u00e9rdane built it; VERDANE too.");
    expect(one.ok && one.fields.content).toBe("[redacted] built it; [redacted] too.");
    const decomposed = copyFor("Verdane Robotics", "Ve\u0301rdane built it.");
    expect(decomposed.ok && decomposed.fields.content).toBe("[redacted] built it.");
    const record = copyFor("Societe Boreale Inc.", "La Soci\u00e9t\u00e9 Bor\u00e9ale a fini.");
    expect(record.ok && record.fields.content).toBe("La [redacted] a fini.");
  });

  test("common acronyms in a name are never hidden, and the fixed title is not checked", () => {
    const ai = copyFor("Verdant AI Inc.", "Verdant used AI and IoT; the QA team agreed.");
    expect(ai.ok && ai.fields.content).toBe("[redacted] used AI and IoT; the QA team agreed.");
    const iot = copyFor("Quillmere IoT", "Quillmere IoT sensors; IoT devices.");
    expect(iot.ok && iot.fields.content).toBe("[redacted] sensors; IoT devices.");
    const folder = buildImportBrainCopy(
      input({}, { clientName: "Quillmere (QA)" }),
      "Quillmere ran QA."
    );
    expect(folder.ok && folder.fields.content).toBe("[redacted] ran QA.");
    const pd = copyFor("PD Systems Inc.", "PD Systems wrote this PD.");
    expect(pd).toMatchObject({ ok: true, fields: { title: "Past PD, FY2024", content: "[redacted] wrote this PD." } });
  });
});

describe("the copy's fields", () => {
  test("the title is neutral: never the client or the file name", () => {
    expect(importBrainTitle(2024)).toBe("Past PD, FY2024");
    expect(importBrainTitle(undefined)).toBe("Past PD");
    const result = buildImportBrainCopy(input(), PD);
    expect(result.ok && result.fields.title).toBe("Past PD, FY2024");
    const noYear = buildImportBrainCopy(input({}, { fiscalYear: undefined, fiscalYearEnd: Date.UTC(2023, 11, 31) }), PD);
    expect(noYear.ok && noYear.fields.title).toBe("Past PD, FY2023");
  });

  test("the file name's client part is hidden too", () => {
    const result = buildImportBrainCopy(
      input(
        { company: { name: "Harrowfield Farms Inc.", industry: "life-sciences" }, identity: { organizations: [], people: [] } },
        { name: "04 BrightAcre 2024-03-31 T2.DW.PN Soil Probe.docx", clientName: "Harrowfield Farms Inc.", companyKey: "harrowfield farms inc." }
      ),
      "BrightAcre and Bright Acre are the old trade names of Harrowfield Farms."
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fields.content).toBe("[redacted] and [redacted] are the old trade names of [redacted].");
  });

  test("industry: the company's, else the one picked for a new company, else a refusal", () => {
    const own = buildImportBrainCopy(input(), PD);
    expect(own.ok && own.fields.industry).toBe("software");
    const picked = buildImportBrainCopy(input({ company: null, identity: { organizations: [], people: [] }, newCompanyIndustry: "manufacturing" }), PD);
    expect(picked.ok && picked.fields.industry).toBe("manufacturing");
    const none = buildImportBrainCopy(input({ company: { name: "Quillmere Analytics Ltd." } }), PD);
    expect(none).toMatchObject({ ok: false, code: "no_industry", reason: "Pick an industry for this company." });
    const newWithout = buildImportBrainCopy(input({ company: null, identity: { organizations: [], people: [] } }), PD);
    expect(newWithout.ok).toBe(false);
    if (!newWithout.ok) expect(newWithout.reason).toBe(IMPORT_BRAIN_REFUSALS.no_industry);
  });

  test("writer tier: the writer's when set, 0.7 when not (2026-11-18), clamped to 0..1", () => {
    const unset = buildImportBrainCopy(input({ writer: { name: "Dana Whitlock" } }), PD);
    expect(unset.ok && unset.fields.writerTier).toBe(IMPORT_BRAIN_DEFAULT_WRITER_TIER);
    expect(IMPORT_BRAIN_DEFAULT_WRITER_TIER).toBe(0.7);
    expect(unset.ok && unset.fields.writerName).toBe("Dana Whitlock");
    const gold = buildImportBrainCopy(input({ writer: { name: "Dana Whitlock", tier: 1 } }), PD);
    expect(gold.ok && gold.fields.writerTier).toBe(1);
    const over = buildImportBrainCopy(input({ writer: { tier: 3 } }), PD);
    expect(over.ok && over.fields.writerTier).toBe(1);
    const none = buildImportBrainCopy(input({ writer: null }, { writerName: undefined }), PD);
    expect(none.ok && "writerName" in none.fields).toBe(false);
  });

  test("the other fields: doc type, science code, fiscal year and the import links", () => {
    const result = buildImportBrainCopy(input({}, { scienceCode: "2.02.09" }), PD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields).toMatchObject({
      kind: "pd_pair",
      docType: "pd",
      fiscalYear: 2024,
      importItemId: itemId,
      importContentHash: "bytes-hash-1",
    });
  });

  test("only a final PD with a company and text gets a copy", () => {
    expect(buildImportBrainCopy(input({}, { category: "draft" }), PD)).toMatchObject({ ok: false, code: "not_final_pd" });
    expect(buildImportBrainCopy(input({}, { companyKey: undefined, clientName: undefined }), PD)).toMatchObject({ ok: false, code: "no_company" });
    expect(buildImportBrainCopy(input(), "   ")).toMatchObject({ ok: false, code: "no_text" });
  });
});
