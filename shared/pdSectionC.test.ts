import { describe, expect, it } from "vitest";
import {
  cleanDocumentClientNames,
  clientNamesForRedaction,
  clientNamesFromSectionC,
  initialsOfClientName,
  matchClientInitials,
  parseSectionCPersonName,
} from "./pdSectionC";

describe("parseSectionCPersonName", () => {
  it("cleans honorifics, credentials, parenthetical titles, and quoted nicknames", () => {
    expect(parseSectionCPersonName("Dr. Samira Haddad, Ph.D.")).toBe("Samira Haddad");
    expect(parseSectionCPersonName("Mr. Ben Mercer - VP Engineering")).toBe("Ben Mercer");
    expect(parseSectionCPersonName("Jean-Luc Picard (CTO)")).toBe("Jean-Luc Picard");
    expect(parseSectionCPersonName('William "Bill" Mercer')).toBe('William "Bill" Mercer');
    expect(parseSectionCPersonName("William \u201CBill\u201D Mercer")).toBe('William "Bill" Mercer');
    expect(parseSectionCPersonName("SAMIRA HADDAD")).toBe("Samira Haddad");
    expect(parseSectionCPersonName("Jan van Dijk")).toBe("Jan van Dijk");
  });

  it("rejects form placeholders, qualifications prose, emails, and company names", () => {
    expect(parseSectionCPersonName("Name")).toBeNull();
    expect(parseSectionCPersonName("Employee")).toBeNull();
    expect(parseSectionCPersonName("Job Title; Qualifications")).toBeNull();
    expect(parseSectionCPersonName("B.Sc. Computer Science, 10 years experience")).toBeNull();
    expect(parseSectionCPersonName("Senior Software Developer")).toBeNull();
    expect(parseSectionCPersonName("Northgate Labs Inc.")).toBeNull();
    expect(parseSectionCPersonName("samira@northgate.example")).toBeNull();
    expect(parseSectionCPersonName("N/A")).toBeNull();
    expect(parseSectionCPersonName("SH")).toBeNull();
  });
});

describe("clientNamesFromSectionC", () => {
  it("extracts contacts from lines 254, 256, and the 260/261 key individuals table", () => {
    const text = `
Section B - Project Descriptions
242
We investigated thermal drift in cold-chain sensors.

Section C - Additional project information
253
Employee directly involved in the project

254
Name
Dr. Samira Haddad, Ph.D.

255
Other employee of the claimant

256
Name\u00a0Ben Mercer

260
List the key individuals directly involved in the project and indicate their qualifications/experience

260
Names

261
Qualifications/experience

William \u201CBill\u201D Mercer

VP Engineering, P.Eng., 15 years industrial controls experience

Jean-Luc Picard

M.Sc. Physics, Lead Firmware Architect

Samira Haddad

Chief Scientist, Ph.D. Chemical Engineering

265
Was any work performed outside Canada?
No
`;
    expect(clientNamesFromSectionC(text)).toEqual([
      { name: "Samira Haddad", source: "section_c" },
      { name: "Ben Mercer", source: "section_c" },
      { name: 'William "Bill" Mercer', source: "section_c" },
      { name: "Jean-Luc Picard", source: "section_c" },
    ]);
  });

  it("handles inline 254/256 rows and tab-separated 260/261 tables", () => {
    const text = `
Section C
254 Name: Nadia O'Connor
256 Name - Omar Al-Mansoor
260\t261
Nadia O'Connor\tDirector of R&D, 12 years experience
Klara Novak\tPrincipal Chemist, PhD
265 Evidence retained
`;
    expect(clientNamesFromSectionC(text)).toEqual([
      { name: "Nadia O'Connor", source: "section_c" },
      { name: "Omar Al-Mansoor", source: "section_c" },
      { name: "Klara Novak", source: "section_c" },
    ]);
  });

  it("ignores blank template placeholders and non-PD text", () => {
    const blankTemplate = `
Section C
253 Employee
254 Name
Employee
256 Name
Details
260 Names
261 Qualifications/experience
Job Title; Years of Experience
265 Evidence
`;
    expect(clientNamesFromSectionC(blankTemplate)).toEqual([]);
    expect(clientNamesFromSectionC("Meeting notes with no CRA schedule.")).toEqual([]);
  });
});

describe("initialsOfClientName and matchClientInitials", () => {
  it("matches standard, hyphenated, 3-word, and quoted nickname initials", () => {
    expect(initialsOfClientName("Samira Haddad")).toEqual(["SH"]);
    expect(initialsOfClientName("Jean-Luc Picard")).toEqual(expect.arrayContaining(["JP", "JLP"]));
    expect(initialsOfClientName("Samira K. Haddad")).toEqual(expect.arrayContaining(["SH", "SKH"]));
    expect(initialsOfClientName('William "Bill" Mercer')).toEqual(expect.arrayContaining(["WM", "BM"]));
  });

  it("returns an unambiguous match and null on ambiguity or company-name collisions", () => {
    const contacts = cleanDocumentClientNames([
      { name: "Samira Haddad", source: "section_c" },
      { name: 'William "Bill" Mercer', source: "section_c" },
      { name: "Jordan Taylor", source: "section_c" },
      { name: "Jamie Torres", source: "section_c" },
    ]);
    expect(matchClientInitials(contacts, "sh")).toEqual({ name: "Samira Haddad", source: "section_c" });
    expect(matchClientInitials(contacts, "BM")).toEqual({ name: 'William "Bill" Mercer', source: "section_c" });
    expect(matchClientInitials(contacts, "WM")).toEqual({ name: 'William "Bill" Mercer', source: "section_c" });
    // Ambiguous: both Jordan Taylor and Jamie Torres match JT
    expect(matchClientInitials(contacts, "JT")).toBeNull();
    // Company name collision excluded
    expect(
      matchClientInitials([{ name: "Cedar Line", source: "section_c" }], "CL", {
        companyName: "Cedar Line Systems",
      })
    ).toBeNull();
  });

  it("emits exact, curly-quote, parenthesized, nickname-free, and nickname+surname variants for PII redaction", () => {
    expect(
      clientNamesForRedaction([
        { name: 'William "Bill" Mercer', source: "section_c" },
        { name: "Samira Haddad", source: "section_c" },
      ])
    ).toEqual([
      'William "Bill" Mercer',
      "William Mercer",
      "William \u201CBill\u201D Mercer",
      "William (Bill) Mercer",
      "Bill Mercer",
      "Samira Haddad",
    ]);
  });
});
