import { describe, expect, it } from "vitest";
import {
  bandName,
  bandSections,
  bandStatusWords,
  fileCells,
  fileDisplayName,
  filesFromCompaniesText,
  firstPageSize,
  fiscalYearText,
  fiscalYearTooltip,
  plural,
  reasonSummary,
  reloadSize,
  sectionNote,
  searchFoundText,
  searchText,
  showMoreText,
  showSectionText,
  versionText,
  yearSplitText,
  type SheetFileRow,
} from "./importFormat";

const MAR_31_2025 = Date.UTC(2025, 2, 31);
const DEC_31_2024 = Date.UTC(2024, 11, 31);

function row(extra: Partial<SheetFileRow> = {}): SheetFileRow {
  return {
    _id: "row" as SheetFileRow["_id"],
    name: "04 CedarlineSystems 2025-03-31 T2.DW.PN RoutePlanning.docx",
    category: "final_pd",
    status: "pending_review",
    editedLabels: [],
    needsCheck: false,
    checkReasons: [],
    size: 2048,
    ...extra,
  };
}

describe("plural and the page note", () => {
  it("counts with the right word and thousands separators", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(223, "file")).toBe("223 files");
    expect(plural(1204, "file")).toBe("1,204 files");
    expect(plural(1, "company", "companies")).toBe("1 company");
    expect(plural(7, "company", "companies")).toBe("7 companies");
  });

  it("says how many files from how many companies, beside the title", () => {
    expect(filesFromCompaniesText({ files: 556, companies: 7, complete: true })).toBe("556 files from 7 companies");
    expect(filesFromCompaniesText({ files: 1, companies: 1, complete: true })).toBe("1 file from 1 company");
    // Only files with no company yet.
    expect(filesFromCompaniesText({ files: 6, companies: 0, complete: true })).toBe("6 files");
    expect(filesFromCompaniesText({ files: 0, companies: 0, complete: true })).toBeNull();
    expect(filesFromCompaniesText({ files: 9000, companies: 1000, complete: false })).toBe(
      "More than 9,000 files from 1,000 companies"
    );
  });
});

describe("company bands", () => {
  it("names the band for files with no company", () => {
    expect(bandName({ companyKey: "", displayName: "" })).toBe("No company yet");
    expect(bandName({ companyKey: "cedarline systems", displayName: "Cedarline Systems" })).toBe("Cedarline Systems");
    expect(bandName({ companyKey: "halden foods", displayName: " " })).toBe("halden foods");
  });

  it("shows the status words on the review tab, leaving zeros out, with only to check in amber", () => {
    expect(bandStatusWords({ beingRead: 38, ready: 77, needsCheck: 12 }, "review")).toEqual([
      { text: "38 being read", tone: "muted" },
      { text: "77 ready", tone: "muted" },
      { text: "12 to check", tone: "amber" },
    ]);
    expect(bandStatusWords({ beingRead: 0, ready: 0, needsCheck: 98 }, "review")).toEqual([
      { text: "98 to check", tone: "amber" },
    ]);
    expect(bandStatusWords({ beingRead: 0, ready: 49, needsCheck: 0 }, "review")).toEqual([
      { text: "49 ready", tone: "muted" },
    ]);
    expect(bandStatusWords({ beingRead: 0, ready: 1204, needsCheck: 0 }, "approved")).toEqual([]);
  });

  it("lists the sections in their fixed order, without empty ones, and Not sorted yet only with files", () => {
    const categories = {
      company_file: { total: 4, needsCheck: 0, fiscalYears: { none: 4 } },
      supporting: { total: 102, needsCheck: 3, fiscalYears: { "2025": 61, "2024": 41 } },
      final_pd: { total: 24, needsCheck: 12, fiscalYears: { "2025": 13, "2024": 11 } },
      draft: { total: 0, needsCheck: 0, fiscalYears: {} },
    };
    expect(bandSections({ categories }, false).map((s) => [s.label, s.count])).toEqual([
      ["Final PDs", 24],
      ["Supporting files", 102],
      ["Company files", 4],
    ]);
    // To check on: only the sections with files to check, counting those.
    expect(bandSections({ categories }, true).map((s) => [s.label, s.count])).toEqual([
      ["Final PDs", 12],
      ["Supporting files", 3],
    ]);
    const unsorted = { unknown: { total: 21, needsCheck: 21, fiscalYears: { none: 21 } } };
    expect(bandSections({ categories: unsorted }, false).map((s) => s.label)).toEqual(["Not sorted yet"]);
  });

  it("with New on, lists only the sections with New files, counting those (2026-11-12)", () => {
    const categories = {
      final_pd: { total: 24, needsCheck: 12, fiscalYears: { "2025": 24 }, newFiles: 4, newFiscalYears: { "2025": 3, "2024": 1 } },
      draft: { total: 45, needsCheck: 0, fiscalYears: { "2025": 45 } },
      unknown: { total: 21, needsCheck: 0, fiscalYears: { "2025": 21 }, newFiles: 21, newFiscalYears: { "2025": 21 } },
    };
    expect(bandSections({ categories }, false, true).map((s) => [s.label, s.count])).toEqual([
      ["Final PDs", 4],
      ["Not sorted yet", 21],
    ]);
    // New wins over To check: the page never sends both.
    expect(bandSections({ categories }, true, true).map((s) => s.count)).toEqual([4, 21]);
  });
});

describe("section words", () => {
  it("splits a section by fiscal year, newest first", () => {
    expect(yearSplitText({ "2024": 11, "2025": 13 })).toBe("13 in FY 2025, 11 in FY 2024");
    expect(yearSplitText({ "2025": 1 })).toBe("1 in FY 2025");
    expect(yearSplitText({ "2025": 61, none: 2, "2024": 41 })).toBe(
      "61 in FY 2025, 41 in FY 2024, 2 with no fiscal year"
    );
    // Company files.
    expect(yearSplitText({ none: 4 })).toBe("No fiscal year");
    expect(yearSplitText({})).toBe("No fiscal year");
  });

  it("sums the check reasons in plain words with the right verb for one or many", () => {
    expect(reasonSummary({ no_writer: 9, no_science_code: 4 })).toBe("9 need a writer, 4 need a science code");
    expect(reasonSummary({ no_writer: 3, no_science_code: 1 })).toBe("3 need a writer, 1 needs a science code");
    expect(reasonSummary({ could_not_read: 3 })).toBe("3 could not be read");
    expect(reasonSummary({ could_not_read: 1 })).toBe("1 could not be read");
    expect(reasonSummary({ no_text: 3 })).toBe("3 with no text");
    expect(reasonSummary({ no_text: 1, could_not_read: 2, no_writer: 1 })).toBe(
      "2 could not be read, 1 with no text, 1 needs a writer"
    );
    expect(reasonSummary({ no_science_code: 2, no_company: 1, unknown_category: 1, no_fiscal_year: 5 })).toBe(
      "1 needs a company, 1 needs a category, 5 need a fiscal year, 2 need a science code"
    );
    expect(reasonSummary({ no_writer: 0 })).toBe("");
    // Initials no person has matched need a writer too, counted with the files that have none (2026-11-12).
    expect(reasonSummary({ unmatched_initials: 9, no_science_code: 4 })).toBe("9 need a writer, 4 need a science code");
    expect(reasonSummary({ unmatched_initials: 6, no_writer: 3 })).toBe("9 need a writer");
    expect(reasonSummary({ unmatched_initials: 1 })).toBe("1 needs a writer");
    expect(reasonSummary({})).toBe("");
  });

  it("notes a section's checks from its band: the reasons when they add up, else how many to check", () => {
    expect(sectionNote({ needsCheck: 12, checkReasons: { no_writer: 9, no_science_code: 4 } })).toBe(
      "9 need a writer, 4 need a science code"
    );
    // A file with two reasons counts under both.
    expect(sectionNote({ needsCheck: 1, checkReasons: { no_company: 1, unknown_category: 1 } })).toBe(
      "1 needs a company, 1 needs a category"
    );
    expect(sectionNote({ needsCheck: 3, checkReasons: { could_not_read: 3 } })).toBe("3 could not be read");
    expect(sectionNote({ needsCheck: 3, checkReasons: { no_text: 3 } })).toBe("3 with no text");
    // A band row from before the reasons were counted, or one that drifted.
    expect(sectionNote({ needsCheck: 4 })).toBe("4 to check");
    expect(sectionNote({ needsCheck: 4, checkReasons: { no_writer: 1 } })).toBe("4 to check");
    expect(sectionNote({ needsCheck: 4, checkReasons: { no_writer: 5 } })).toBe("4 to check");
    expect(sectionNote({ needsCheck: 4, checkReasons: { no_writer: 5, no_science_code: -1 } })).toBe("4 to check");
    // Nothing to check: no note.
    expect(sectionNote({ needsCheck: 0 })).toBeNull();
    expect(sectionNote({ needsCheck: 0, checkReasons: { no_writer: 2 } })).toBeNull();
  });

  it("asks for as many as were listed when To check changes a list, within its first page and the server's limit", () => {
    expect(reloadSize(0, 25, 100)).toBe(25);
    expect(reloadSize(3, 25, 100)).toBe(25);
    expect(reloadSize(60, 25, 100)).toBe(60);
    expect(reloadSize(240, 25, 100)).toBe(100);
    expect(reloadSize(30, 5, 200)).toBe(30);
  });

  it("lists a few files first: five final PDs, three of anything else, all of them when only one or two more", () => {
    expect(firstPageSize("final_pd", 24)).toBe(5);
    expect(firstPageSize("supporting", 102)).toBe(3);
    expect(firstPageSize("final_pd", 7)).toBe(7);
    expect(firstPageSize("draft", 5)).toBe(5);
    expect(firstPageSize("draft", 6)).toBe(3);
    expect(firstPageSize("transcript", 1)).toBe(1);
  });

  it("words the Show more rows honestly about how many one click lists", () => {
    expect(showMoreText("final_pd", 19)).toBe("Show 19 more final PDs");
    expect(showMoreText("final_pd", 1)).toBe("Show 1 more final PD");
    expect(showMoreText("review_copy", 1)).toBe("Show 1 more review copy");
    expect(showMoreText("supporting", 99)).toBe("Show 25 of 99 more supporting files");
    // Not sorted yet holds every kind of file (Paper Files 2).
    expect(showMoreText("unknown", 18)).toBe("Show 18 more");
    expect(showMoreText("unknown", 99)).toBe("Show 25 of 99 more");
    // Only for a caller with no count: a section never shows its row with none left.
    expect(showMoreText("draft", 0)).toBe("Show more drafts");
    expect(showSectionText(45)).toBe("Show 45");
  });
});

describe("file rows", () => {
  it("names a PD-named file by its number and title, anything else by its file name", () => {
    expect(fileDisplayName({ name: "x.docx", pdNumber: "4", pdTitle: "Route planning engine" })).toEqual({
      prefix: "PD 4",
      title: "Route planning engine",
    });
    expect(fileDisplayName({ name: "12a draft.docx", pdNumber: "12a" })).toEqual({ prefix: "PD 12a", title: "12a draft.docx" });
    expect(fileDisplayName({ name: "Whiteboard photo.pdf" })).toEqual({ prefix: null, title: "Whiteboard photo.pdf" });
  });

  it("shows the fiscal year as the year only, with the year end in its tooltip", () => {
    expect(fiscalYearText(MAR_31_2025)).toBe("2025");
    expect(fiscalYearText(undefined)).toBeNull();
    expect(fiscalYearTooltip(MAR_31_2025, false)).toBe("Year ended Mar 31, 2025");
    expect(fiscalYearTooltip(MAR_31_2025, undefined)).toBe("Year ended Mar 31, 2025");
    expect(fiscalYearTooltip(DEC_31_2024, true)).toBe("Year end not in the folder name. Using Dec 31, 2024 for now.");
    expect(fiscalYearTooltip(undefined, false)).toBeNull();
    // A UTC midnight reads as that day wherever the browser is.
    expect(fiscalYearText(Date.UTC(2025, 0, 1))).toBe("2025");
  });

  it("writes the version as its letter and number", () => {
    expect(versionText("T", 2)).toBe("T2");
    expect(versionText("R", undefined)).toBe("R");
    expect(versionText(undefined, 3)).toBe("3");
    expect(versionText(undefined, undefined)).toBeNull();
  });

  it("fills a read final PD's cells, with the AI mark only for a code read from the document", () => {
    const cells = fileCells(
      row({
        pdNumber: "1",
        pdTitle: "Route planning engine",
        fiscalYearEnd: MAR_31_2025,
        fiscalYearEndAssumed: false,
        versionCode: "T",
        versionNumber: 2,
        writerName: "Dana Whitlock",
        writerInitials: "DW",
        scienceCode: "2.02.09",
        scienceCodeSource: "document",
      })
    );
    expect(cells).toEqual({
      isNew: false,
      prefix: "PD 1",
      title: "Route planning engine",
      state: null,
      fiscalYear: { text: "2025", tone: "ink", tooltip: "Year ended Mar 31, 2025" },
      version: "T2",
      writer: { text: "Dana Whitlock", tone: "ink", initials: "DW", remembered: false },
      // No reviewer and no reviewer initials (2026-11-17): quiet, never amber.
      reviewer: { text: "", tone: "muted", initials: null, remembered: false, missing: true },
      craReviewed: false,
      scienceCode: {
        kind: "code",
        code: "2.02.09",
        title: "Software engineering and technology",
        fromDocument: true,
      },
    });
    const byPerson = fileCells(row({ scienceCode: "1.02.02", scienceCodeSource: "person" }));
    expect(byPerson.scienceCode).toEqual({
      kind: "code",
      code: "1.02.02",
      title: "Information technology and bioinformatics",
      fromDocument: false,
    });
  });

  it("shows the reviewer from its initials as plain words, and a missing one quietly, never amber (2026-11-17)", () => {
    const named = fileCells(row({ reviewerName: "Priya Nair", reviewerInitials: "PN", reviewerSource: "initials" }));
    expect(named.reviewer).toEqual({ text: "Priya Nair", tone: "ink", initials: "PN", remembered: true, missing: false });
    expect(fileCells(row({ reviewerName: "Priya Nair", reviewerSource: "person" })).reviewer).toMatchObject({ remembered: false });
    // Initials that could be more than one person: no reviewer, and no check reason.
    expect(fileCells(row({ reviewerInitials: "PN" })).reviewer).toEqual({ text: "PN", tone: "muted", initials: "PN", remembered: false, missing: true });
    // A draft and a review copy take a reviewer; a transcript does not; a file being read shows nothing.
    expect(fileCells(row({ category: "draft", reviewerName: "PN" })).reviewer?.text).toBe("PN");
    expect(fileCells(row({ category: "transcript", reviewerName: "PN" })).reviewer).toBeNull();
    expect(fileCells(row({ status: "fetched", reviewerName: "PN" })).reviewer).toBeNull();
  });

  it("shows Reviewed by CRA on final PDs only (2026-11-17)", () => {
    expect(fileCells(row({ craReviewed: true })).craReviewed).toBe(true);
    expect(fileCells(row({ category: "draft", craReviewed: true })).craReviewed).toBe(false);
    expect(fileCells(row({})).craReviewed).toBe(false);
  });

  it("shows initials no person has matched in amber on a final PD that needs a writer, muted where none is needed", () => {
    // A final PD: the check asks a person who KT is (2026-11-12).
    expect(fileCells(row({ writerInitials: "KT", needsCheck: true, checkReasons: ["unmatched_initials"] })).writer).toEqual({
      text: "KT",
      tone: "amber",
      initials: "KT",
      remembered: false,
    });
    // A draft needs no writer: the initials stay quiet.
    expect(fileCells(row({ category: "draft", writerInitials: "KT" })).writer).toEqual({
      text: "KT",
      tone: "muted",
      initials: "KT",
      remembered: false,
    });
  });

  it("shows a name taken from matched initials in ink, with no AI mark, and knows where it came from", () => {
    expect(fileCells(row({ writerInitials: "KT", writerName: "Kim Tran", writerNameSource: "initials" })).writer).toEqual({
      text: "Kim Tran",
      tone: "ink",
      initials: "KT",
      remembered: true,
    });
    expect(fileCells(row({ writerInitials: "KT", writerName: "Jordan Ellis", writerNameSource: "person" })).writer).toMatchObject({
      text: "Jordan Ellis",
      remembered: false,
    });
  });

  it("marks in amber only what a person must fill in", () => {
    const missing = fileCells(row({ needsCheck: true, checkReasons: ["no_science_code", "no_writer"] }));
    expect(missing.writer).toEqual({ text: "No writer", tone: "amber", initials: null, remembered: false });
    expect(missing.scienceCode).toEqual({ kind: "missing", text: "No science code" });

    const noYear = fileCells(row({ category: "supporting", needsCheck: true, checkReasons: ["no_fiscal_year"] }));
    expect(noYear.fiscalYear).toEqual({ text: "No fiscal year", tone: "amber", tooltip: null });

    // Not applicable: a supporting file has no writer or science code, and a
    // company file no fiscal year. Never amber, and the company file's cell
    // is empty: its section already says "No fiscal year" (live QA fixes).
    const supporting = fileCells(row({ category: "supporting", fiscalYearEnd: MAR_31_2025 }));
    expect([supporting.writer, supporting.scienceCode, supporting.version]).toEqual([null, null, null]);
    expect(fileCells(row({ category: "company_file" })).fiscalYear).toBeNull();
    // An approved final PD with no science code has nothing left to check.
    expect(fileCells(row({ status: "approved" })).scienceCode).toBeNull();
  });

  it("shows a stored value only where the file's category takes it, so a moved file shows what fits it", () => {
    const stored = {
      pdNumber: "3",
      pdTitle: "Batch trace index",
      fiscalYearEnd: MAR_31_2025,
      versionCode: "S" as const,
      versionNumber: 1,
      writerName: "Priya Nair",
      scienceCode: "2.02.09",
      scienceCodeSource: "document" as const,
    };
    // A final PD moved to Drafts keeps its code stored, but a draft shows none.
    const draft = fileCells(row({ ...stored, category: "draft" }));
    expect(draft.scienceCode).toBeNull();
    expect(draft.version).toBe("S1");
    expect(draft.writer).toEqual({ text: "Priya Nair", tone: "ink", initials: null, remembered: false });
    // Moved back, the code shows again.
    expect(fileCells(row({ ...stored, category: "final_pd" })).scienceCode).toMatchObject({ kind: "code", code: "2.02.09" });
    // A transcript takes no version, writer or code; its year stays.
    for (const category of ["transcript", "supporting", "company_file", "unknown"] as const) {
      const cells = fileCells(row({ ...stored, category, writerInitials: "PN" }));
      expect([cells.version, cells.writer, cells.scienceCode], category).toEqual([null, null, null]);
      expect(cells.fiscalYear?.text, category).toBe("2025");
    }
    // The same on a read-only tab.
    expect(fileCells(row({ ...stored, category: "review_copy", status: "approved" })).scienceCode).toBeNull();
  });

  it("shows a file still being read with empty cells, and one that failed in amber", () => {
    for (const status of ["discovered", "fetched"] as const) {
      const cells = fileCells(
        row({ status, category: "unknown", name: "Batch notes, March.docx", fiscalYearEnd: MAR_31_2025, checkReasons: ["no_writer"] })
      );
      expect(cells).toMatchObject({
        title: "Batch notes, March.docx",
        state: { text: "Being read", tone: "muted" },
        fiscalYear: null,
        version: null,
        writer: null,
        scienceCode: null,
      });
    }
    const failed = fileCells(
      row({ status: "failed", category: "supporting", name: "Whiteboard photo.pdf", fiscalYearEnd: MAR_31_2025, checkReasons: ["could_not_read"] })
    );
    expect(failed.state).toEqual({ text: "Could not be read", tone: "amber" });
    expect(failed.fiscalYear?.text).toBe("2025");
    // New (2026-11-12) is carried whatever the state; the row shows it once the file is read.
    expect(fileCells(row({ isNew: true })).isNew).toBe(true);
    expect(fileCells(row({ isNew: true, status: "fetched" })).isNew).toBe(true);
    // Read, but no text came out (a scan): amber after the name, its cells as any read file's.
    const scan = fileCells(
      row({ status: "pending_review", category: "supporting", name: "Signed letter.pdf", fiscalYearEnd: MAR_31_2025, checkReasons: ["no_text"] })
    );
    expect(scan.state).toEqual({ text: "No text could be read", tone: "amber" });
    expect(scan.fiscalYear?.text).toBe("2025");
    // A failed file says it could not be read, even if it also had no text.
    expect(fileCells(row({ status: "failed", checkReasons: ["could_not_read", "no_text"] })).state?.text).toBe("Could not be read");
  });
});

describe("search", () => {
  it("searches from two characters", () => {
    expect(searchText("c")).toBeNull();
    expect(searchText("  c ")).toBeNull();
    expect(searchText(" ce ")).toBe("ce");
  });

  it("says what it found", () => {
    expect(searchFoundText({ companies: [{} as never], files: [{} as never, {} as never] })).toBe("1 company and 2 files");
    expect(searchFoundText({ companies: [], files: [{} as never] })).toBe("1 file");
    expect(searchFoundText({ companies: [], files: [] })).toBe("");
  });
});
