// Review round 2 (2026-11-17) probe inputs for the Brain copy scrub, one
// test each, with the exact copy expected. Companies and people are made
// up. Inputs the scrub does not cover are pinned too, so a change to them is
// a decision; the Approve screen's note names them (IMPORT_BRAIN_NOT_COVERED).
import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  IMPORT_BRAIN_LEAK_LOG_REASON,
  IMPORT_BRAIN_NOT_COVERED,
  buildImportBrainCopy,
  companyNameVariants,
  peopleNamedByCues,
  type ImportBrainCopyInput,
} from "./importBrainCopy";

type Options = { fileName?: string; clientName?: string; website?: string; orgs?: string[]; people?: string[]; alsoRemove?: string[] };

function run(company: string, text: string, opts: Options = {}) {
  const input: ImportBrainCopyInput = {
    item: {
      _id: "ingestionItems:probe" as unknown as Id<"ingestionItems">,
      name: opts.fileName ?? "report.docx",
      clientName: opts.clientName ?? company,
      companyKey: "k",
      category: "final_pd",
      contentHash: "h",
      fiscalYear: 2024,
    },
    company: { name: company, industry: "software", ...(opts.website ? { website: opts.website } : {}) },
    identity: { organizations: opts.orgs ?? [company], people: opts.people ?? [] },
    writer: null,
    ...(opts.alsoRemove ? { alsoRemove: opts.alsoRemove } : {}),
  };
  return buildImportBrainCopy(input, text);
}

function copy(company: string, text: string, opts: Options = {}): string {
  const result = run(company, text, opts);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.fields.content;
}

const Q = "Quillmere Analytics Ltd.";

describe("probe p1: company name forms", () => {
  test.each([
    ["article and possessive", "The Quillmere Group Inc.", "The Quillmere Group's team and Quillmere's lab. QG built it. The QQG.", "[redacted]'s team and [redacted]'s lab. [redacted] built it. The QQG."],
    ["hyphenated name", "Brandt-Holloway Systems Ltd.", "Brandt-Holloway tested. Brandt Holloway also. BrandtHolloway. BHS did it. Holloway alone. Brandt alone.", "[redacted] tested. [redacted] also. [redacted]. [redacted] did it. [redacted] alone. [redacted] alone."],
    ["ampersand", "Fenwick & Marlow Ltd.", "Fenwick & Marlow built it. F&M did it. FM did it. Fenwick and Marlow. Marlow's team.", "[redacted] built it. [redacted] did it. [redacted] did it. [redacted] and [redacted]. [redacted]'s team."],
    ["numbered company", "1234567 Ontario Inc.", "1234567 Ontario Inc. developed. The company (1234567) did. 1234567 ONTARIO.", "[redacted] developed. The company ([redacted]) did. [redacted]."],
    ["short number is not a name word", "123 Ontario Ltd.", "123 Ontario Ltd. developed. Measured 123 samples.", "[redacted] developed. Measured 123 samples."],
    ["French name with accents", "Les Technologies Vérdane Inc.", "Les Technologies Vérdane a testé. VERDANE et Verdane. LTV.", "[redacted] a testé. [redacted] et [redacted]. LTV."],
    ["ordinary words (known cost: a distinctive word is hidden everywhere)", "Northern Lights Inc.", "Northern Lights Inc. built a sensor. Northern Lights tested. The northern lights were visible. NL did it. Lights failed.", "[redacted] built a sensor. [redacted] tested. The [redacted] were visible. NL did it. [redacted] failed."],
    ["one-word ordinary name", "Apex Inc.", "Apex Inc. built the summit. Apex tested. APEX did.", "[redacted] built the summit. [redacted] tested. [redacted] did."],
    ["ordinary first word without a short form (a warning, see below)", "Apex Robotics Ltd.", "Apex Robotics Ltd. built. Apex built. AR did.", "[redacted] built. Apex built. AR did."],
    ["line break inside the name", Q, "The work at Quillmere\nAnalytics was hard.", "The work at [redacted] was hard."],
    ["all capitals heading", Q, "QUILLMERE ANALYTICS LTD.\nPROJECT DESCRIPTION", "[redacted]\nPROJECT DESCRIPTION"],
  ])("%s", (_label, company, text, expected) => {
    expect(copy(company, text)).toBe(expected);
  });

  test("emails and web addresses", () => {
    expect(copy(Q, "Write name@quillmere.ca, or www.quillmere.com, or quillmere.ca/products, or https://quillmere.com/x.", { website: "quillmere.ca" })).toBe(
      "Write [redacted email], or www.[redacted].com, or [redacted]/products, or https://[redacted].com/x."
    );
  });

  test("a website stem that differs from the name", () => {
    expect(copy("Harbourline Data Corp.", "See hlcorp.com/products and www.hlcorp.com and HLCorp's tool.", { website: "https://hlcorp.com" })).toBe(
      "See [redacted]/products and www.[redacted] and [redacted]'s tool."
    );
  });

  test("the forms of three names", () => {
    expect(companyNameVariants(["Northern Lights Inc."])).toEqual({ phrases: [["northern", "lights"]], joined: ["northernlights"], words: ["lights"], initialisms: ["NLI"] });
    expect(companyNameVariants(["Fenwick & Marlow Ltd."])).toEqual({ phrases: [["fenwick", "marlow"]], joined: ["fenwickmarlow"], words: ["fenwick", "marlow"], initialisms: ["FM"] });
    expect(companyNameVariants(["1234567 Ontario Inc."])).toEqual({ phrases: [["1234567", "ontario"]], joined: ["1234567ontario"], words: ["1234567"], initialisms: [] });
  });
});

describe("probe p2: numbers, addresses, phones, people, signatures", () => {
  test("Business Number forms", () => {
    expect(
      copy(Q, ["BN 123456789", "BN: 123456789RC0001", "BN 123 456 789", "BN 123-456-789", "BN 123456789 RC 0001", "BN 123-456-789-RC-0001", "123456789RC0001", "Business number 12345 6789"].join("\n"))
    ).toBe(
      ["BN [redacted number]", "BN: [redacted number]", "BN [redacted number]", "BN [redacted number]", "BN [redacted number]", "BN [redacted number]", "[redacted number]", "Business number 12345 6789"].join("\n")
    );
  });

  test("Canadian addresses (a US address and one with no postal code are not covered)", () => {
    expect(
      copy(Q, [
        "Head office: 1200 Rue Sainte-Catherine Ouest, Montréal, QC H3B 1K9",
        "12 Main St.",
        "Ottawa, ON K1A0B1",
        "Suite 400, 55 King St W, Toronto ON M5K 1E7, Canada",
        "Our US office: 400 Market St, San Francisco, CA 94105",
        "Plant at 88 Industrial Rd, Guelph, Ontario",
        "Box 12, Moncton NB E1C-4B2",
        "The k1a 0b1 lower-case code",
      ].join("\n"))
    ).toBe(
      [
        "[redacted address]",
        "[redacted address]",
        "[redacted address]",
        "[redacted address]",
        "Our US office: 400 Market St, San Francisco, CA 94105",
        "Plant at 88 Industrial Rd, Guelph, Ontario",
        "[redacted address]",
        "[redacted address]",
      ].join("\n")
    );
  });

  test("phone numbers (a bare ten-digit run and a non-North-American number are not covered)", () => {
    expect(copy(Q, "Call 613-555-0134, (613) 555 0134, +1 613 555 0134, 613.555.0134, 6135550134, 1-800-555-0199 ext. 22, +44 20 7946 0958.")).toBe(
      "Call [redacted phone], [redacted phone], [redacted phone], [redacted phone], 6135550134, [redacted phone] ext. 22, +44 20 7946 0958."
    );
  });

  test("people with titles, roles, middle initials and cues (a name with none is not covered)", () => {
    expect(
      copy(Q, [
        "Dr. Anjali R. Verma, CTO, led the work.",
        "Mary-Kate O'Neil-Barros, Lead Engineer, ran tests.",
        "Hélène Côté-Tremblay, the project manager, ran tests.",
        "José Núñez, Director",
        "Our engineer Tomasz Wiśniewski built the rig.",
        "Tomasz ran trials after Wiśniewski calibrated.",
        "Raj K. Patel and Siobhan Fitzgerald built the parser.",
        "Interviews with Kenji Oduya covered the design.",
        "Bob Marlowe wrote the firmware.",
      ].join("\n"), { people: ["Siobhan Fitzgerald"] })
    ).toBe(
      [
        "Dr. [redacted], CTO, led the work.",
        "[redacted], Lead Engineer, ran tests.",
        "[redacted], the project manager, ran tests.",
        "[redacted], Director",
        "Our engineer [redacted] built the rig.",
        "[redacted] ran trials after [redacted] calibrated.",
        "[redacted] and [redacted] built the parser.",
        "Interviews with [redacted] covered the design.",
        "Bob Marlowe wrote the firmware.",
      ].join("\n")
    );
  });

  test("signatures after a closing", () => {
    expect(
      copy(Q, ["The work concluded in March.", "", "Sincerely,", "", "Gwendolyn Ashcombe", "Vice President, Engineering", "Quillmere", "gwen@quillmere.ca | 416-555-0123"].join("\n"))
    ).toBe(["The work concluded in March.", "", "Sincerely,", "", "[redacted]", "Vice President, Engineering", "[redacted]", "[redacted email] | [redacted phone]"].join("\n"));
    expect(copy(Q, ["Thank you,", "Gwendolyn Ashcombe", "VP Engineering"].join("\n"))).toBe(["Thank you,", "[redacted]", "VP Engineering"].join("\n"));
    expect(copy(Q, ["Regards,", "Thaddeus Okonkwo-Bell"].join("\n"))).toBe(["Regards,", "[redacted]"].join("\n"));
  });

  test("roles with qualifiers find the person, not the role", () => {
    expect(peopleNamedByCues("Quality Control Manager reviewed. Project Lead Jane Doe. The Sensor Team Lead noted. Principal Investigator Rowan Thale.")).toEqual(["Jane Doe", "Rowan Thale"]);
  });
});

describe("probe p3: invisible characters, marks, short forms, first names", () => {
  test.each([
    ["soft hyphen", Q, "Quill­mere built the rig.", "[redacted] built the rig."],
    ["zero-width space and joiner", Q, "Quill​mere built the rig. Quill‍mere too.", "[redacted] built the rig. [redacted] too."],
    ["word joiner and byte order mark", Q, "Quill⁠mere and Quill﻿mere.", "[redacted] and [redacted]."],
    ["word broken at a line end", Q, "The team at Quill-\nmere's lab built the rig.", "The team at [redacted]'s lab built the rig."],
    ["trademark sign", Q, "Quillmere™ built the rig.", "[redacted]™ built the rig."],
    ["registered sign", Q, "Quillmere® built the rig.", "[redacted]® built the rig."],
    ["short form the PD defines", "Apex Robotics Ltd.", "Apex Robotics Ltd. (Apex) built the arm. Apex's engineers tested.", "[redacted] ([redacted]) built the arm. [redacted]'s engineers tested."],
    ["ordinary first word with 's (a warning, see below)", "Summit Precision Machining Inc.", "Summit's machinists tuned. SPM did it.", "Summit's machinists tuned. [redacted] did it."],
    ["initials joined by &", "Fenwick & Marlow Ltd.", "F&M built it. F & M also.", "[redacted] built it. [redacted] also."],
    ["a person's first name and surname on their own", Q, "Dr. Anjali Verma led. Anjali then ran trials. Verma reported.", "Dr. [redacted] led. [redacted] then ran trials. [redacted] reported."],
    ["file name client part", Q, "BrightPath built it. Bright Path.", "[redacted] built it. [redacted]."],
  ])("%s", (label, company, text, expected) => {
    const opts: Options = label === "file name client part" ? { fileName: "04 BrightPath 2024-03-31 T2.DW.PN Sensor.docx", clientName: "BrightPath Inc." } : {};
    expect(copy(company, text, opts)).toBe(expected);
  });

  test("a product name only when the person approving adds it", () => {
    expect(copy(Q, "The QuillSense™ unit and QuillSense® unit failed. QuillSense v2.", { alsoRemove: ["QuillSense"] })).toBe(
      "The [redacted]™ unit and [redacted]® unit failed. [redacted] v2."
    );
  });

  test("a known person's first name and surname, and an initial", () => {
    expect(copy(Q, "Siobhan ran trials; Fitzgerald reviewed. S. Fitzgerald signed.", { people: ["Siobhan Fitzgerald"] })).toBe(
      "[redacted] ran trials; [redacted] reviewed. S. [redacted] signed."
    );
  });

  test("spaced capitals are not covered", () => {
    expect(copy(Q, "Q U I L L M E R E built it.")).toBe("Q U I L L M E R E built it.");
  });
});

describe("probe p4: over-redaction and false people", () => {
  test.each([
    ["catalyst (known cost)", "Catalyst Bio Ltd.", "The catalyst degraded at 400 C. Catalyst loading was 2 wt%. CB-12 failed.", "The [redacted] degraded at 400 C. [redacted] loading was 2 wt%. [redacted]-12 failed."],
    ["harvest (known cost)", "Harvest Moon Brewing Co.", "The harvest moisture and the moon phase. HMB did it. Our hops harvest.", "The [redacted] moisture and the [redacted] phase. [redacted] did it. Our hops [redacted]."],
    ["lights (known cost)", "Northern Lights Inc.", "LED lights flickered under PWM.", "LED [redacted] flickered under PWM."],
    ["kinetic edge (known cost)", "Kinetic Edge Robotics", "The kinetic energy at the edge of the gripper. KER built it.", "The [redacted] energy at the [redacted] of the gripper. [redacted] built it."],
    ["common acronyms stay; VAI counts", "Verdant AI Inc.", "We used AI, ML and NLP. The QA team and the PD. CNC, ERP, IoT. Verdant AI built it. VAI did it.", "We used AI, ML and NLP. The QA team and the PD. CNC, ERP, IoT. [redacted] built it. [redacted] did it."],
    ["an initialism name", "ABC Plastics Inc.", "ABC Plastics molded. ABC tested. The ABC analysis. AB testing.", "[redacted] molded. [redacted] tested. The [redacted] analysis. AB testing."],
    ["a two-letter name", "QM Inc.", "QM built it. The QM team. QMS audit.", "[redacted] built it. The [redacted] team. QMS audit."],
    ["numbers under five digits", "Studio 360 Inc.", "Rotate 360 degrees. Studio 360 built it.", "Rotate 360 degrees. [redacted] built it."],
    [
      "role words and methods are not people",
      Q,
      "Machine Learning Engineer evaluated. Senior Data Scientist reviewed. Contact Angle measurements. According to Fourier Transform analysis. Led by Monte Carlo simulation. Director General approved.",
      "Machine Learning Engineer evaluated. Senior Data Scientist reviewed. Contact Angle measurements. According to Fourier Transform analysis. Led by Monte Carlo simulation. Director General approved.",
    ],
    ["a title line", Q, "Quillmere Sensor Drift Platform\n\nThe work.", "[redacted] Sensor Drift Platform\n\nThe work."],
  ])("%s", (_label, company, text, expected) => {
    expect(copy(company, text)).toBe(expected);
  });

  test("strict cues need a comma, a role or the clause end after the name", () => {
    expect(peopleNamedByCues("Contact Angle measurements were taken. According to Fourier Transform analysis. Led by Monte Carlo simulation. Kalman Filter, Lead Engineer, said.")).toEqual([]);
    expect(peopleNamedByCues("The trial was led by Tomas Lindqvist. Contact: Ines Moreau, Director. According to Mei Tanaka, it held.")).toEqual(
      ["Ines Moreau", "Tomas Lindqvist", "Mei Tanaka"]
    );
  });
});

describe("probe p5 and p6: brands, numbers, roles, capitals", () => {
  test.each([
    ["three-letter brand", "Zyx Robotics Inc.", "Zyx Robotics Inc. (Zyx) built it. Zyx's arm. ZYX tested.", "[redacted] ([redacted]) built it. [redacted]'s arm. [redacted] tested."],
    ["NEQ and labelled or dashed Business Numbers", Q, "NEQ 1171234567\nBN 123456789-RC-0001\nBusiness Number: 123-456-789\nNuméro d'entreprise 123 456 789", "NEQ [redacted number]\nBN [redacted number]\nBusiness Number: [redacted number]\nNuméro d'entreprise [redacted number]"],
    ["writer cue with credentials", Q, "Prepared by: Odalys Ferrante, P.Eng.\nThe work.", "Prepared by: [redacted], P.Eng.\nThe work."],
    ["lower-case roles", Q, "Our lead engineer, Corwin Ashby, designed it. chief scientist Mirela Dobos approved.", "Our lead engineer, [redacted], designed it. chief scientist [redacted] approved."],
    ["a middle initial without a comma", Q, "Dr. Anjali R. Verma led. Then Anjali R. Verma ran it.", "Dr. [redacted] led. Then [redacted] ran it."],
    ["a writer cue in capitals", Q, "PREPARED BY: ODALYS FERRANTE", "PREPARED BY: [redacted]"],
    ["a name in capitals with a role", Q, "ODALYS FERRANTE, CTO", "[redacted], CTO"],
    ["an accented surname alone and in capitals", Q, "Hélène Côté-Tremblay, Project Manager, ran tests. Later Côté-Tremblay and COTE-TREMBLAY.", "[redacted], Project Manager, ran tests. Later [redacted] and [redacted]."],
    ["a surname in capitals in a reference", Q, "Dr. Anjali Verma led.\nVERMA, A. (2023). Report.", "Dr. [redacted] led.\n[redacted], A. (2023). Report."],
    ["a name of two ordinary words", "Address Point Inc.", "Address Point built it.", "[redacted] built it."],
  ])("%s", (_label, company, text, expected) => {
    expect(copy(company, text)).toBe(expected);
  });
});

describe("warnings, the note for Approve and the log reason", () => {
  test("an ordinary first word still capitalized mid-sentence or with 's is a warning, not a refusal", () => {
    const summit = run("Summit Precision Machining Inc.", "Summit's machinists tuned. We reached the summit.");
    expect(summit).toMatchObject({ ok: true, warnings: ['"Summit" still appears capitalized. If it means the company, add it to Also remove.'] });
    const apex = run("Apex Robotics Ltd.", "Apex Robotics Ltd. built. Then the team at Apex built it.");
    expect(apex.ok && apex.warnings).toEqual(['"Apex" still appears capitalized. If it means the company, add it to Also remove.']);
    const start = run("Apex Robotics Ltd.", "Apex built it. The apex of the curve.");
    expect(start.ok && start.warnings).toEqual([]);
  });

  test("a description in brackets is not a short form, and a common acronym is not one either", () => {
    expect(copy(Q, "Quillmere Analytics (the Company) and (QA) results.")).toBe("[redacted] (the Company) and (QA) results.");
  });

  test("every result carries the note; a refusal's log reason never quotes the word", () => {
    const ok = run(Q, "Quillmere built it.");
    expect(ok.ok && ok.notCovered).toBe(IMPORT_BRAIN_NOT_COVERED);
    expect(IMPORT_BRAIN_NOT_COVERED).toContain("product names");
    const refused = run("Northern Equity Partners", "The Northern ------- Equity ------- Partners team.");
    expect(refused).toMatchObject({ ok: false, code: "names_left", logReason: IMPORT_BRAIN_LEAK_LOG_REASON, notCovered: IMPORT_BRAIN_NOT_COVERED });
    expect(!refused.ok && refused.logReason).not.toMatch(/northern/i);
  });
});
