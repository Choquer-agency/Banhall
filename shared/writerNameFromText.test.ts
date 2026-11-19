import { describe, expect, it } from "vitest";
import {
  cleanDocumentWriterNames,
  initialsOfName,
  MAX_DOCUMENT_WRITER_NAMES,
  nameMatchesInitials,
  sameWriterName,
  writerNameForInitials,
  writerNamesFromText,
} from "./writerNameFromText";

// Who wrote a PD, read from its text (2026-11-16). Made-up names only.

describe("writerNamesFromText", () => {
  it("reads a name after each writer cue, in any case, with or without a colon", () => {
    expect(writerNamesFromText("Prepared by Dana Whitlock")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("PREPARED BY: Dana Whitlock")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Written by Priya Nair.")).toEqual(["Priya Nair"]);
    expect(writerNamesFromText("Authored by Sam Okafor")).toEqual(["Sam Okafor"]);
    expect(writerNamesFromText("Author: Kim Tran")).toEqual(["Kim Tran"]);
    expect(writerNamesFromText("author Kim Tran")).toEqual(["Kim Tran"]);
    expect(writerNamesFromText("Writer:\tJordan Ellis")).toEqual(["Jordan Ellis"]);
  });

  it("ignores the reviewer and every other 'by'", () => {
    expect(writerNamesFromText("Prepared by Dana Whitlock, reviewed by Priya Nair.")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Reviewed by Priya Nair. Approved by Sam Okafor. Prepared for Halden Foods.")).toEqual([]);
    // Not a cue inside a longer word.
    expect(writerNamesFromText("Authorized by Sam Okafor. Co-authored by Kim Tran. Ghostwriter: Jordan Ellis")).toEqual([]);
  });

  it("refuses one word, initials only and lower-case words", () => {
    expect(writerNamesFromText("Prepared by KT.")).toEqual([]);
    expect(writerNamesFromText("Prepared by Dana.")).toEqual([]);
    expect(writerNamesFromText("Prepared by DW PN")).toEqual([]);
    expect(writerNamesFromText("Prepared by the Cedarline team")).toEqual([]);
    expect(writerNamesFromText("Prepared by Dana J. Whitlock")).toEqual([]);
  });

  it("refuses emails and names with digits", () => {
    expect(writerNamesFromText("Prepared by dana.whitlock@example.com")).toEqual([]);
    expect(writerNamesFromText("Prepared by Dana.Whitlock@example.com")).toEqual([]);
    expect(writerNamesFromText("Prepared by Dana Whitlock@example.com")).toEqual([]);
    expect(writerNamesFromText("Prepared by Dana Whitlock2")).toEqual([]);
    expect(writerNamesFromText("Written by User123 Tester")).toEqual([]);
    // An email after the name, apart from it, leaves the name.
    expect(writerNamesFromText("Prepared by Dana Whitlock <dana@example.com>")).toEqual(["Dana Whitlock"]);
  });

  it("keeps hyphens and apostrophes inside names, and stops at a line end", () => {
    expect(writerNamesFromText("Prepared by Mary-Jo O'Neil")).toEqual(["Mary-Jo O'Neil"]);
    expect(writerNamesFromText("Prepared by Mary-Jo O’Neil")).toEqual(["Mary-Jo O’Neil"]);
    expect(writerNamesFromText("Prepared by José Núñez")).toEqual(["José Núñez"]);
    expect(writerNamesFromText("Prepared by Dana\nWhitlock")).toEqual([]);
    expect(writerNamesFromText("Prepared by Dana Whitlock\nCedarline Systems")).toEqual(["Dana Whitlock"]);
    // A form: the label alone on its line, the name on the next, or after one blank line (a Word table's cells).
    expect(writerNamesFromText("Prepared by:\n  Dana Whitlock\nDate: 2025-03-31")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Prepared by:\n\nDana Whitlock\n\nReviewed by:\n\nSam Okafor")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Prepared by\n\nDana Whitlock")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Author:\r\nDana Whitlock")).toEqual(["Dana Whitlock"]);
    // Not after two blank lines, nor when the cue is not alone on its line.
    expect(writerNamesFromText("Prepared by:\n\n\nDana Whitlock")).toEqual([]);
    expect(writerNamesFromText("This was prepared by\nDana Whitlock")).toEqual([]);
  });

  it("ends a name at a tab, two spaces or a line end", () => {
    expect(writerNamesFromText("Written by Priya Nair\tDate: 2025-03-31")).toEqual(["Priya Nair"]);
    expect(writerNamesFromText("Written by Priya Nair  Cedarline Systems")).toEqual(["Priya Nair"]);
    expect(writerNamesFromText("Written by Priya\tNair")).toEqual([]);
    expect(writerNamesFromText("Written by Priya  Nair")).toEqual([]);
  });

  it("refuses team, company and heading words, and a bare Author or Writer heading over the next line", () => {
    expect(writerNamesFromText("Prepared by: Data Warehouse team")).toEqual([]);
    expect(writerNamesFromText("Prepared by: Data Warehouse Team")).toEqual([]);
    expect(writerNamesFromText("Author\nDate Written")).toEqual([]);
    expect(writerNamesFromText("Writer\nDana Whitlock")).toEqual([]);
    for (const word of ["Date", "Team", "Department", "Group", "Systems", "Inc", "Ltd", "Corp", "Company", "Services", "Solutions", "Technologies", "Report", "Project", "Section", "Version", "Draft"]) {
      expect(writerNamesFromText(`Prepared by Halden ${word}`), word).toEqual([]);
      expect(writerNamesFromText(`Prepared by ${word} Halden`), word).toEqual([]);
    }
    expect(writerNamesFromText("Prepared by Research-Group Lead")).toEqual([]);
    // The word after the name only counts when it is one of them.
    expect(writerNamesFromText("Prepared by Dana Whitlock for Halden Foods")).toEqual(["Dana Whitlock"]);
  });

  it("stops at a possessive, and writes a name in capitals in title case", () => {
    expect(writerNamesFromText("Written by Dana Whitlock's team")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Written by Dana Whitlock\u2019s team")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("PREPARED BY: DANA WHITLOCK")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("PREPARED BY: MARY-JO O'NEIL")).toEqual(["Mary-Jo O'Neil"]);
    expect(writerNamesFromText("Prepared by Dana McDonald")).toEqual(["Dana McDonald"]);
    // Short words in capitals are names when they have a vowel; initials stay refused.
    expect(writerNamesFromText("PREPARED BY KIM TRAN")).toEqual(["Kim Tran"]);
    expect(writerNamesFromText("PREPARED BY SAM OKAFOR")).toEqual(["Sam Okafor"]);
    expect(writerNamesFromText("PREPARED BY JO LEE")).toEqual(["Jo Lee"]);
    expect(writerNamesFromText("Prepared by KIM TRAN, reviewed by PN")).toEqual(["Kim Tran"]);
    expect(writerNamesFromText("Prepared by KT.")).toEqual([]);
    expect(writerNamesFromText("PREPARED BY KT.")).toEqual([]);
    expect(writerNamesFromText("PREPARED BY DW PN")).toEqual([]);
    expect(writerNamesFromText("PREPARED BY DANA WHITLOCK FOR HALDEN FOODS")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("PREPARED BY DATA WAREHOUSE TEAM")).toEqual([]);
  });

  it("takes 2 to 4 words, skips a title, and leaves credentials out", () => {
    expect(writerNamesFromText("Prepared by Dana Lee Whitlock")).toEqual(["Dana Lee Whitlock"]);
    expect(writerNamesFromText("Prepared by Ana Maria Lopez Garcia")).toEqual(["Ana Maria Lopez Garcia"]);
    // Five capitalised words: a heading or a company, not a name.
    expect(writerNamesFromText("Prepared by Cedarline Systems Research And Development")).toEqual([]);
    expect(writerNamesFromText("Prepared by Dr. Dana Whitlock")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Prepared by Ms Priya Nair")).toEqual(["Priya Nair"]);
    expect(writerNamesFromText("Prepared by Drew Barry")).toEqual(["Drew Barry"]);
    expect(writerNamesFromText("Prepared by Dana Whitlock PhD")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Prepared by Dana Whitlock MBA")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("Prepared by Dana Whitlock 2025-03-31")).toEqual(["Dana Whitlock"]);
  });

  it("returns each name once, in order, at most a handful", () => {
    const text = [
      "Prepared by Dana Whitlock",
      "Written by Priya Nair",
      "Prepared by DANA WHITLOCK",
      "Author: Sam Okafor",
      "Writer: Kim Tran",
      "Prepared by Jordan Ellis",
      "Prepared by Halden Foods",
    ].join("\n");
    const names = writerNamesFromText(text);
    expect(names).toEqual(["Dana Whitlock", "Priya Nair", "Sam Okafor", "Kim Tran", "Jordan Ellis"]);
    expect(names).toHaveLength(MAX_DOCUMENT_WRITER_NAMES);
    // Capitals and mixed case are one name.
    expect(writerNamesFromText("PREPARED BY DANA WHITLOCK\nPrepared by Dana Whitlock")).toEqual(["Dana Whitlock"]);
    expect(writerNamesFromText("")).toEqual([]);
  });
});

describe("matching a name to file initials", () => {
  it("uses the first letter of each word, in any case", () => {
    expect(initialsOfName("Dana Whitlock")).toEqual(["DW"]);
    expect(nameMatchesInitials("Dana Whitlock", "DW")).toBe(true);
    expect(nameMatchesInitials("Dana Whitlock", "dw")).toBe(true);
    expect(nameMatchesInitials("Dana Whitlock", "DN")).toBe(false);
    expect(nameMatchesInitials("Dana Whitlock", "")).toBe(false);
  });

  it("matches a three-word name to three letters only, never to first and last", () => {
    expect(nameMatchesInitials("Dana Lee Whitlock", "DLW")).toBe(true);
    expect(nameMatchesInitials("Dana Lee Whitlock", "DW")).toBe(false);
  });

  it("matches a hyphenated first name by its first letter, or by each part; an apostrophe never splits", () => {
    expect(initialsOfName("Mary-Jo O'Neil")).toEqual(["MO", "MJO"]);
    expect(nameMatchesInitials("Mary-Jo O'Neil", "MO")).toBe(true);
    expect(nameMatchesInitials("Mary-Jo O'Neil", "MJO")).toBe(true);
    expect(nameMatchesInitials("Mary-Jo O'Neil", "MON")).toBe(false);
    expect(nameMatchesInitials("Priya Nair-Okafor", "PN")).toBe(true);
    expect(nameMatchesInitials("Priya Nair-Okafor", "PNO")).toBe(true);
  });

  it("gives the one matching name, and none when no name or two names match", () => {
    expect(writerNameForInitials(["Dana Whitlock", "Priya Nair"], "DW")).toBe("Dana Whitlock");
    expect(writerNameForInitials(["Dana Whitlock", "Priya Nair"], "PN")).toBe("Priya Nair");
    expect(writerNameForInitials(["Dana Whitlock", "Priya Nair"], "KT")).toBeNull();
    expect(writerNameForInitials(["Dana Whitlock", "Dan Wells"], "DW")).toBeNull();
    // The same name twice is one name.
    expect(writerNameForInitials(["Dana Whitlock", "DANA WHITLOCK"], "DW")).toBe("Dana Whitlock");
    expect(writerNameForInitials(undefined, "DW")).toBeNull();
    // The company's name, or part of it, is not a person.
    expect(writerNameForInitials(["Data Warehouse"], "DW", { companyName: "Data Warehouse Systems" })).toBeNull();
    expect(writerNameForInitials(["Halden Foods"], "HF", { companyName: "Halden Foods" })).toBeNull();
    expect(writerNameForInitials(["Dana Whitlock"], "DW", { companyName: "Halden Foods" })).toBe("Dana Whitlock");
    expect(writerNameForInitials(["Dana Whitlock", "Data Warehouse"], "DW", { companyName: "Data Warehouse Inc." })).toBe("Dana Whitlock");
    expect(writerNameForInitials(["Dana Whitlock"], null)).toBeNull();
  });
});

describe("cleanDocumentWriterNames and sameWriterName", () => {
  it("keeps at most a handful of short names, with no email", () => {
    expect(cleanDocumentWriterNames(["  Dana   Whitlock ", "", "dana@example.com", "x".repeat(121), "dana whitlock", "Priya Nair"])).toEqual([
      "Dana Whitlock",
      "Priya Nair",
    ]);
    expect(cleanDocumentWriterNames(["A b", "C d", "E f", "G h", "I j", "K l"])).toHaveLength(MAX_DOCUMENT_WRITER_NAMES);
    expect(sameWriterName("Dana  Whitlock", "dana whitlock")).toBe(true);
    expect(sameWriterName("Dana Whitlock", "Dana Wells")).toBe(false);
  });
});
