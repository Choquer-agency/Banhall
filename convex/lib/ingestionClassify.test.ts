import { describe, expect, it } from "vitest";
import { dashboardCompanyKey } from "../../shared/dashboardProjection";
import {
  classify,
  fiscalYearEndFromLabel,
  labelsForItemPath,
  readLabelFiscalYearEnd,
  type Classified,
} from "./ingestionClassify";

const FY = "Cedarline Systems/2025 - Mar 31";
const PD_FIELDS = [
  "pdNumber",
  "versionCode",
  "versionNumber",
  "writerInitials",
  "reviewerInitials",
  "pdTitle",
] as const;

function category(folders: string, fileName = "notes.docx") {
  return classify(folders, fileName).category;
}

function expectNoPdFields(c: Classified) {
  for (const key of PD_FIELDS) expect(c[key], key).toBeUndefined();
}

describe("classify category", () => {
  it("gives each category for a typical path", () => {
    expect(category(`${FY}/To be submitted`)).toBe("final_pd");
    expect(category(`${FY}/Submitted`, "pd.doc")).toBe("final_pd");
    expect(category(`${FY}/Drafts`)).toBe("draft");
    expect(category(`${FY}/Work in progress`)).toBe("draft");
    expect(category(`${FY}/WIP`)).toBe("draft");
    expect(category(`${FY}/In Review`)).toBe("review_copy");
    expect(category(`${FY}/WIP/Technical/Audio`, "interview.txt")).toBe("transcript");
    expect(category(`${FY}/Financials`, "budget.pdf")).toBe("supporting");
    expect(category(FY, "timesheet.pdf")).toBe("supporting");
    expect(category("Cedarline Systems", "glossary.docx")).toBe("company_file");
    expect(category("", "loose.docx")).toBe("unknown");
  });

  it("calls a file at the client level, or under a folder with no year, a company file", () => {
    expect(category("Halden Foods", "glossary.docx")).toBe("company_file");
    expect(category("Halden Foods/Glossary", "terms.docx")).toBe("company_file");
    expect(category("Halden Foods/Company documents/Contracts", "nda.pdf")).toBe("company_file");
    // A stage folder at the client level does not make it a draft or review copy.
    expect(category("Halden Foods/Drafts", "notes.docx")).toBe("company_file");
    expect(category("Halden Foods/In Review", "notes.docx")).toBe("company_file");
  });

  it("calls a path with no client folder unknown", () => {
    expect(category("", "loose.docx")).toBe("unknown");
    expect(category("///", "loose.pdf")).toBe("unknown");
    expect(classify("", "loose.docx")).toMatchObject({ category: "unknown", docKind: "unknown" });
  });

  it("needs a Word file for a final PD, as docKind does", () => {
    expect(category(`${FY}/To be submitted`, "pd.pdf")).toBe("supporting");
    expect(category(`${FY}/To be submitted`, "pd.txt")).toBe("supporting");
    expect(category(`${FY}/To be submitted`, "pd.DOCX")).toBe("final_pd");
  });
});

describe("classify precedence", () => {
  it("lets the nearest stage folder to the file win", () => {
    expect(category(`${FY}/Drafts/Submitted`)).toBe("final_pd");
    expect(category(`${FY}/Submitted/Drafts`)).toBe("draft");
    expect(category(`${FY}/Drafts/In Review`)).toBe("review_copy");
    expect(category(`${FY}/In Review/Drafts`)).toBe("draft");
    expect(category(`${FY}/In Review/WIP`)).toBe("draft");
    expect(category(`${FY}/WIP/In Review`)).toBe("review_copy");
  });

  it("skips folders that mark no stage when looking for the nearest one", () => {
    expect(category(`${FY}/Drafts/Old versions`)).toBe("draft");
    expect(category(`${FY}/In Review/Round 2/Comments`)).toBe("review_copy");
  });

  it("stops at a nearest submit folder even when it does not make a final PD", () => {
    // Only the file's own folder can make a final PD (docKind "pd").
    expect(category(`${FY}/To be submitted/Old`)).toBe("supporting");
    expect(category(`${FY}/Drafts/To be submitted`, "pd.pdf")).toBe("supporting");
    expect(category(`${FY}/Drafts/To be submitted/Old`)).toBe("supporting");
  });

  it("tries submit before review before draft within one folder name", () => {
    expect(category(`${FY}/Submitted for review`)).toBe("final_pd");
    expect(category(`${FY}/Submitted for review`, "pd.pdf")).toBe("supporting");
    expect(category(`${FY}/Draft review notes`)).toBe("review_copy");
  });

  it("lets an Audio folder win over any stage folder", () => {
    expect(category(`${FY}/In Review/Audio`, "call.txt")).toBe("transcript");
    expect(category(`${FY}/Audio/Drafts`, "call.txt")).toBe("transcript");
    expect(category(`${FY}/Submitted/Audio`, "call.docx")).toBe("transcript");
  });

  it("keeps a transcript or final PD even outside a fiscal year folder, as docKind does", () => {
    expect(category("Cedarline Systems/Audio", "call.vtt")).toBe("transcript");
    expect(category("Cedarline Systems/Submitted", "pd.docx")).toBe("final_pd");
  });

  it("never reads the client or fiscal year folder as a stage folder", () => {
    expect(category("Northgate Review Labs/2025 - Dec 31", "notes.docx")).toBe("supporting");
    expect(category("Draftworks/2025 - Dec 31/Financials", "notes.docx")).toBe("supporting");
    expect(category("Northgate Labs/2025 Drafts", "notes.docx")).toBe("supporting");
  });
});

describe("classify folder name matching", () => {
  it("ignores case, numbering prefixes, punctuation and extra spaces", () => {
    expect(category(`${FY}/2. In Review`)).toBe("review_copy");
    expect(category(`${FY}/02 - REVIEW`)).toBe("review_copy");
    expect(category(`${FY}/01 - Drafts`)).toBe("draft");
    expect(category(`${FY}/3_WIP`)).toBe("draft");
    expect(category(`${FY}/4.wip`)).toBe("draft");
    expect(category(`${FY}/Work-in-Progress`)).toBe("draft");
    expect(category(`${FY}/1) Work  in   progress`)).toBe("draft");
    expect(category(`${FY}/5. To Be Submitted`)).toBe("final_pd");
  });

  it("reads wip and work in progress only as whole words", () => {
    expect(category(`${FY}/Wipe tests`)).toBe("supporting");
    expect(category(`${FY}/Swiped cards`)).toBe("supporting");
    expect(category(`${FY}/Homework in progress`)).toBe("supporting");
  });

  it("matches review, draft and submit at the start of a word", () => {
    expect(category(`${FY}/In Review`)).toBe("review_copy");
    expect(category(`${FY}/Reviewed`)).toBe("review_copy");
    expect(category(`${FY}/Peer-review`)).toBe("review_copy");
    expect(category(`${FY}/2. Drafts`)).toBe("draft");
    expect(category(`${FY}/Drafted 2025`)).toBe("draft");
    // A submit folder stops the walk up the path, so these are not drafts.
    expect(category(`${FY}/Drafts/Submitted`, "pd.pdf")).toBe("supporting");
    expect(category(`${FY}/Drafts/To be submitted`, "pd.pdf")).toBe("supporting");
  });

  it("does not match review, draft or submit inside another word", () => {
    expect(category(`${FY}/Preview images`)).toBe("supporting");
    expect(category(`${FY}/Overdraft facility`)).toBe("supporting");
    expect(category(`${FY}/Redrafts`)).toBe("supporting");
    // Not a stage folder, so the walk goes on to the folder above it.
    expect(category(`${FY}/In Review/Preview images`)).toBe("review_copy");
    expect(category(`${FY}/Drafts/Overdraft facility`)).toBe("draft");
    expect(category(`${FY}/Drafts/Resubmittal`, "pd.pdf")).toBe("draft");
  });

  it("reads a CamelCase folder name as separate words", () => {
    expect(category(`${FY}/InReview`)).toBe("review_copy");
    expect(category(`${FY}/WIPDrafts`)).toBe("draft");
    expect(category(`${FY}/WorkInProgress`)).toBe("draft");
    expect(category(`${FY}/PreviewImages`)).toBe("supporting");
    expect(category(`${FY}/Drafts/ToBeSubmitted`, "pd.pdf")).toBe("supporting");
  });

  it("keeps the final PD test docKind's plain submit substring, as on main", () => {
    // Only the stage walk needs "submit" to start a word; a final PD does not.
    expect(classify(`${FY}/Resubmitted`, "pd.docx")).toMatchObject({ docKind: "pd", category: "final_pd" });
    expect(classify(`${FY}/ToBeSubmitted`, "pd.docx")).toMatchObject({ docKind: "pd", category: "final_pd" });
  });

  it("keeps the Audio test exactly as docKind has it", () => {
    // docKind looks for a folder named exactly Audio, in any case; so does category.
    expect(category(`${FY}/AUDIO`, "call.txt")).toBe("transcript");
    expect(category(`${FY}/3. Audio`, "call.txt")).toBe("supporting");
  });
});

describe("classify fiscal year end", () => {
  it("reads the month and day from the label", () => {
    expect(classify("Cedarline Systems/2025 - Mar 31", "a.pdf")).toMatchObject({
      fiscalYear: 2025,
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      fiscalYearEndAssumed: false,
    });
    expect(classify("Halden Foods/2024 - September 30/Drafts", "a.docx")).toMatchObject({
      fiscalYearEnd: Date.UTC(2024, 8, 30),
      fiscalYearEndAssumed: false,
    });
    // Dec 31 written in the label is read, not assumed.
    expect(classify("Halden Foods/2024 - Dec 31", "a.pdf")).toMatchObject({
      fiscalYearEnd: Date.UTC(2024, 11, 31),
      fiscalYearEndAssumed: false,
    });
  });

  it("assumes Dec 31 and says so when the label has only a year", () => {
    expect(classify("Northgate Labs/2023", "a.pdf")).toMatchObject({
      fiscalYearEnd: Date.UTC(2023, 11, 31),
      fiscalYearEndAssumed: true,
    });
    expect(classify("Northgate Labs/FY2024", "a.pdf")).toMatchObject({
      fiscalYearEnd: Date.UTC(2024, 11, 31),
      fiscalYearEndAssumed: true,
    });
  });

  it("reads a numeric date in the label", () => {
    expect(classify("Northgate Labs/2025-03-31", "a.pdf")).toMatchObject({
      fiscalYear: 2025,
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      fiscalYearEndAssumed: false,
    });
  });

  it("does not take the day out of the year", () => {
    // fiscalYearEndFromLabel gives June 20 and Dec 20 for these (pinned below).
    expect(classify("Northgate Labs/FYE June 2025", "a.pdf")).toMatchObject({
      fiscalYearEnd: Date.UTC(2025, 5, 30),
      fiscalYearEndAssumed: true,
    });
    expect(classify("Northgate Labs/Year ended 31 December 2025", "a.pdf")).toMatchObject({
      fiscalYearEnd: Date.UTC(2025, 11, 31),
      fiscalYearEndAssumed: false,
    });
  });

  it("gives no fiscal year end when there is no year", () => {
    const company = classify("Northgate Labs/Glossary", "terms.docx");
    expect(company.fiscalYearEnd).toBeUndefined();
    expect(company.fiscalYearEndAssumed).toBeUndefined();
    expect(classify("Northgate Labs", "terms.docx").fiscalYearEnd).toBeUndefined();
  });
});

describe("readLabelFiscalYearEnd", () => {
  /** [label, fiscal year, expected [year, month index, day], assumed]. */
  const cases: Array<[string | undefined, number, [number, number, number], boolean]> = [
    // A month name with a day next to it: that day, read from the label.
    ["2025 - Mar 31", 2025, [2025, 2, 31], false],
    ["Mar 31 2025", 2025, [2025, 2, 31], false],
    ["March 31, 2025", 2025, [2025, 2, 31], false],
    ["31 March 2025", 2025, [2025, 2, 31], false],
    ["31 Mar 2025", 2025, [2025, 2, 31], false],
    ["Year ended 31 December 2025", 2025, [2025, 11, 31], false],
    ["2025 - Dec 31", 2025, [2025, 11, 31], false],
    // A range names two months: the year end is the last one.
    ["2025 (Apr 1 - Mar 31)", 2025, [2025, 2, 31], false],
    ["Jan 1 - Dec 31 2025", 2025, [2025, 11, 31], false],
    ["2024 - September 5", 2024, [2024, 8, 5], false],
    ["2024 Sept. 5", 2024, [2024, 8, 5], false],
    ["FYE 31-Dec-2025", 2025, [2025, 11, 31], false],
    ["2025 Mar 31st", 2025, [2025, 2, 31], false],
    ["2024 - Feb 29", 2024, [2024, 1, 29], false],
    // A numeric date, year first, in the fiscal year.
    ["2025-03-31", 2025, [2025, 2, 31], false],
    ["2025.03.31", 2025, [2025, 2, 31], false],
    ["2025_03_31", 2025, [2025, 2, 31], false],
    ["FYE 2025-6-30", 2025, [2025, 5, 30], false],
    // A month with no day: the last day of that month, assumed.
    ["FYE June 2025", 2025, [2025, 5, 30], true],
    ["2025 June", 2025, [2025, 5, 30], true],
    ["Year ended December 2025", 2025, [2025, 11, 31], true],
    ["FY Feb 2024", 2024, [2024, 1, 29], true],
    ["FY Feb 2025", 2025, [2025, 1, 28], true],
    // A day the month does not have is not a day.
    ["2025 - Feb 30", 2025, [2025, 1, 28], true],
    ["2025 - Apr 31", 2025, [2025, 3, 30], true],
    // A day is never part of a longer number.
    ["2025 - Mar 123", 2025, [2025, 2, 31], true],
    ["FY24 Dec", 2024, [2024, 11, 31], true],
    // Only a year, or nothing that reads as a date: Dec 31, assumed.
    ["2025", 2025, [2025, 11, 31], true],
    ["FY 2025", 2025, [2025, 11, 31], true],
    ["FY2024", 2024, [2024, 11, 31], true],
    [undefined, 2023, [2023, 11, 31], true],
    ["Marine 2025", 2025, [2025, 11, 31], true],
    ["Decision 2025", 2025, [2025, 11, 31], true],
    ["2025-02-30", 2025, [2025, 11, 31], true],
    ["2025-13-01", 2025, [2025, 11, 31], true],
    ["2025-03_31", 2025, [2025, 11, 31], true],
    // A numeric date in another year than the fiscal year is not read.
    ["FY2025 (2024-12-31)", 2025, [2025, 11, 31], true],
  ];

  it.each(cases)("reads %j in %i", (label, fiscalYear, [year, month, day], assumed) => {
    const end = readLabelFiscalYearEnd(label, fiscalYear);
    expect(end.fiscalYearEnd).toBe(Date.UTC(year, month, day));
    expect(end.assumed).toBe(assumed);
  });

  it("names the label's month when it assumed only the day", () => {
    expect(readLabelFiscalYearEnd("FYE June 2025", 2025).month).toBe(5);
    expect(readLabelFiscalYearEnd("2025", 2025).month).toBeUndefined();
    expect(readLabelFiscalYearEnd("2025 - Mar 31", 2025).month).toBeUndefined();
  });
});

describe("fiscalYearEndFromLabel is unchanged from main", () => {
  // Porting reads this. Literal results from main (e0d9d717), known gaps
  // included: it can take the day out of the year and does not check that
  // the day fits the month.
  const cases: Array<[string | undefined, number, [number, number, number]]> = [
    ["2025 - Dec 31", 2025, [2025, 11, 31]],
    ["2024 - Jun 30", 2024, [2024, 5, 30]],
    ["2024 - September 5", 2024, [2024, 8, 5]],
    ["2024 Sept. 5", 2024, [2024, 8, 5]],
    ["2025 - Mar 31", 2025, [2025, 2, 31]],
    ["Mar 31 2025", 2025, [2025, 2, 31]],
    ["FY2024", 2024, [2024, 11, 31]],
    ["2025", 2025, [2025, 11, 31]],
    [undefined, 2023, [2023, 11, 31]],
    ["2025-03-31", 2025, [2025, 11, 31]],
    ["FYE June 2025", 2025, [2025, 5, 20]],
    ["Year ended 31 December 2025", 2025, [2025, 11, 20]],
    ["31 March 2025", 2025, [2025, 2, 20]],
    ["Marine 2025", 2025, [2025, 2, 20]],
    ["2025 - Feb 30", 2025, [2025, 2, 2]],
  ];

  it.each(cases)("gives the same result for %j in %i", (label, fiscalYear, [year, month, day]) => {
    expect(fiscalYearEndFromLabel(label, fiscalYear)).toBe(Date.UTC(year, month, day));
  });
});

describe("classify fiscal year end from a final PD's file name", () => {
  const SUBMITTED = "Northgate Labs/2025/To be submitted";

  it("uses the name's date when the label has only the year", () => {
    expect(classify(SUBMITTED, "04 NorthgateLabs 2025-03-31 T2.DW.PN Title.docx")).toMatchObject({
      category: "final_pd",
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      fiscalYearEndAssumed: false,
    });
    // The name's date fills in the day when the label names only the month.
    expect(
      classify("Northgate Labs/FYE June 2025/Submitted", "04 NorthgateLabs 2025-06-30 T2.DW Title.docx")
    ).toMatchObject({ fiscalYearEnd: Date.UTC(2025, 5, 30), fiscalYearEndAssumed: false });
  });

  it("keeps the folder's assumed date when the name's year differs", () => {
    expect(classify(SUBMITTED, "04 NorthgateLabs 2024-03-31 T2.DW.PN Title.docx")).toMatchObject({
      fiscalYearEnd: Date.UTC(2025, 11, 31),
      fiscalYearEndAssumed: true,
    });
  });

  it("keeps the folder's assumed date when the name's month differs from the label's", () => {
    expect(
      classify("Northgate Labs/FYE June 2025/Submitted", "04 NorthgateLabs 2025-03-31 T2.DW Title.docx")
    ).toMatchObject({ fiscalYearEnd: Date.UTC(2025, 5, 30), fiscalYearEndAssumed: true });
  });

  it("lets a label that states the day win over the name", () => {
    expect(
      classify("Northgate Labs/2025 - Mar 31/Submitted", "04 NorthgateLabs 2025-06-30 T2.DW Title.docx")
    ).toMatchObject({ fiscalYearEnd: Date.UTC(2025, 2, 31), fiscalYearEndAssumed: false });
  });

  it("ignores a name with no date, a date that is not real, or a name that does not parse", () => {
    for (const name of [
      "04 NorthgateLabs T2.DW.PN Title.docx",
      "04 NorthgateLabs 2025-02-30 T2.DW.PN Title.docx",
      "Final report 2025-03-31.docx",
    ]) {
      expect(classify(SUBMITTED, name), name).toMatchObject({
        fiscalYearEnd: Date.UTC(2025, 11, 31),
        fiscalYearEndAssumed: true,
      });
    }
  });

  it("reads the date only from a final PD's name", () => {
    const name = "04 NorthgateLabs 2025-03-31 R2.DW.PN Title.docx";
    for (const folders of ["Northgate Labs/2025/In Review", "Northgate Labs/2025/Drafts", "Northgate Labs/2025/Financials"]) {
      expect(classify(folders, name), folders).toMatchObject({
        fiscalYearEnd: Date.UTC(2025, 11, 31),
        fiscalYearEndAssumed: true,
      });
    }
  });
});

describe("classify PD file name fields", () => {
  it("reads every field from a final PD whose name follows the scheme", () => {
    const c = classify(
      `${FY}/To be submitted`,
      "04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift.docx"
    );
    expect(c).toMatchObject({
      category: "final_pd",
      docKind: "pd",
      pdNumber: "4",
      versionCode: "T",
      versionNumber: 2,
      writerInitials: "DW",
      reviewerInitials: "PN",
      pdTitle: "Cold Chain Sensor Drift",
    });
  });

  it("reads S and R versions and a name with no reviewer", () => {
    expect(
      classify(`${FY}/Submitted`, "11 CedarlineSystems 2025-03-31 S1.SO Title.docx")
    ).toMatchObject({ versionCode: "S", versionNumber: 1, writerInitials: "SO" });
    const review = classify(`${FY}/Submitted`, "3 CedarlineSystems 2025-03-31 R12.dw.so Title.docx");
    expect(review).toMatchObject({ versionCode: "R", versionNumber: 12, reviewerInitials: "SO" });
    expect(classify(`${FY}/Submitted`, "11 CedarlineSystems S1.SO Title.docx").reviewerInitials).toBeUndefined();
  });

  it("keeps only what a partly scheme-named file gives", () => {
    const c = classify(`${FY}/To be submitted`, "3 CedarlineSystems 2025-03-31 ColdChain.docx");
    expect(c).toMatchObject({ pdNumber: "3", pdTitle: "Cold Chain" });
    expect(c.versionCode).toBeUndefined();
    expect(c.versionNumber).toBeUndefined();
    expect(c.writerInitials).toBeUndefined();
  });

  it("sets none of the fields when a final PD's name does not parse", () => {
    const c = classify(`${FY}/To be submitted`, "Final report.docx");
    expect(c.category).toBe("final_pd");
    expectNoPdFields(c);
  });

  it("reads every field from a review copy or draft whose name carries a version token", () => {
    const name = "04 CedarlineSystems 2025-03-31 R2.DW.PN ColdChainSensorDrift.docx";
    for (const [folders, expected] of [
      [`${FY}/In Review`, "review_copy"],
      [`${FY}/Drafts`, "draft"],
    ] as const) {
      expect(classify(folders, name), folders).toMatchObject({
        category: expected,
        pdNumber: "4",
        versionCode: "R",
        versionNumber: 2,
        writerInitials: "DW",
        reviewerInitials: "PN",
        pdTitle: "Cold Chain Sensor Drift",
      });
    }
    expect(
      classify(`${FY}/WIP`, "7 CedarlineSystems T3.SO ColdChain.pdf")
    ).toMatchObject({ category: "draft", pdNumber: "7", versionCode: "T", versionNumber: 3, writerInitials: "SO" });
  });

  it("reads nothing from a review copy or draft whose name has no version token", () => {
    for (const folders of [`${FY}/In Review`, `${FY}/Drafts`]) {
      const c = classify(folders, "3 CedarlineSystems 2025-03-31 ColdChain.docx");
      expect(c.category).not.toBe("final_pd");
      expectNoPdFields(c);
    }
  });

  it("reads nothing from a supporting file, transcript or company file", () => {
    const name = "04 CedarlineSystems 2025-03-31 R2.DW.PN ColdChainSensorDrift.docx";
    for (const [folders, expected] of [
      [`${FY}/Financials`, "supporting"],
      [FY, "supporting"],
      [`${FY}/In Review/Audio`, "transcript"],
      ["Cedarline Systems", "company_file"],
      ["", "unknown"],
    ] as const) {
      const c = classify(folders, name);
      expect(c.category, folders).toBe(expected);
      expectNoPdFields(c);
    }
  });

  it("never reads the file extension as initials", () => {
    expect(classify(`${FY}/Submitted`, "03 CedarlineSystems 2025-12-31 T1.doc")).toMatchObject({
      category: "final_pd",
      pdNumber: "3",
      versionCode: "T",
      versionNumber: 1,
    });
    expect(classify(`${FY}/Submitted`, "03 CedarlineSystems 2025-12-31 T1.doc").writerInitials).toBeUndefined();
    const review = classify(`${FY}/In Review`, "03 CedarlineSystems 2025-12-31 R4.DW.pdf");
    expect(review).toMatchObject({ category: "review_copy", versionCode: "R", versionNumber: 4, writerInitials: "DW" });
    expect(review.reviewerInitials).toBeUndefined();
  });
});

describe("classify companyKey", () => {
  it("uses the same key the app groups companies by", () => {
    expect(classify("Cedarline  Systems/2025", "a.pdf").companyKey).toBe("cedarline systems");
    expect(classify("HALDEN FOODS", "a.pdf").companyKey).toBe(dashboardCompanyKey("Halden Foods"));
    const c = classify("Northgate Labs/2025 - Dec 31/Drafts", "a.docx");
    expect(c.companyKey).toBe(dashboardCompanyKey(c.clientName!));
  });

  it("gives no key when there is no client folder", () => {
    expect(classify("", "a.pdf").companyKey).toBeUndefined();
  });
});

describe("classify docKind", () => {
  it("is unchanged from main for a table of paths", () => {
    // Literal results from main (e0d9d717).
    const cases: Array<[string, string, Classified["docKind"]]> = [
      ["", "loose.docx", "unknown"],
      ["Cedarline Systems", "glossary.docx", "unknown"],
      ["Cedarline Systems/Glossary", "terms.docx", "supporting"],
      ["Cedarline Systems/Audio", "call.txt", "transcript"],
      ["Cedarline Systems/Submitted", "pd.docx", "pd"],
      [FY, "timesheet.pdf", "supporting"],
      [`${FY}/To be submitted`, "04 CedarlineSystems 2025-03-31 T2.DW.PN Title.docx", "pd"],
      [`${FY}/To be submitted`, "pd.pdf", "supporting"],
      [`${FY}/To be submitted`, "pd.doc", "pd"],
      [`${FY}/To be submitted`, "pd.DOCX", "pd"],
      [`${FY}/To be submitted/Old`, "pd.docx", "supporting"],
      [`${FY}/Submitted for review`, "pd.docx", "pd"],
      [`${FY}/Drafts/Submitted`, "pd.docx", "pd"],
      [`${FY}/Submitted/Drafts`, "pd.docx", "supporting"],
      [`${FY}/Resubmitted`, "pd.docx", "pd"],
      [`${FY}/ToBeSubmitted`, "pd.docx", "pd"],
      [`${FY}/Resubmittal`, "pd.pdf", "supporting"],
      [`${FY}/2. In Review`, "pd.docx", "supporting"],
      [`${FY}/In Review/Drafts`, "pd.docx", "supporting"],
      [`${FY}/Preview images`, "pd.docx", "supporting"],
      [`${FY}/Overdraft facility`, "pd.docx", "supporting"],
      [`${FY}/WIP/Technical/Audio`, "interview.txt", "transcript"],
      [`${FY}/WIP/Technical/AUDIO`, "interview.vtt", "transcript"],
      [`${FY}/3. Audio`, "interview.txt", "supporting"],
      [`${FY}/In Review/Audio`, "call.docx", "transcript"],
      [`${FY}/Submitted/Audio`, "call.docx", "transcript"],
      [`${FY}/Work-in-Progress`, "notes.docx", "supporting"],
      [`${FY}/Financials`, "budget.pdf", "supporting"],
      ["Northgate Labs/2025-03-31/Submitted", "pd.docx", "pd"],
      ["Northgate Labs/FY2024", "notes.txt", "supporting"],
      ["Halden Foods/Drafts", "notes.docx", "supporting"],
    ];
    for (const [folders, fileName, expected] of cases) {
      expect(classify(folders, fileName).docKind, `${folders} | ${fileName}`).toBe(expected);
    }
  });

  it("keeps clientName, fiscalYearLabel and fiscalYear as before", () => {
    expect(classify(`${FY}/Drafts`, "a.docx")).toMatchObject({
      clientName: "Cedarline Systems",
      fiscalYearLabel: "2025 - Mar 31",
      fiscalYear: 2025,
    });
  });

  it("builds the pairing key from the company key and the fiscal year number", () => {
    expect(classify(`${FY}/Drafts`, "a.docx").pairGroupKey).toBe("cedarline systems::2025");
    expect(classify("", "a.docx").pairGroupKey).toBe("?::?");
    expect(classify("Halden Foods", "a.docx").pairGroupKey).toBe("halden foods::?");
    expect(classify("Halden Foods/Contracts", "a.docx").pairGroupKey).toBe("halden foods::?");
    // Folders spelled differently for one company and year share a group.
    const keys = [
      classify("Cedarline Systems/2025 - Mar 31/To be submitted", "pd.docx"),
      classify("CEDARLINE  SYSTEMS/FY2025/WIP/Technical/Audio", "call.vtt"),
      classify("cedarline systems/Fiscal 2025 (March 31)/Financials", "budget.pdf"),
    ].map((c) => c.pairGroupKey);
    expect(new Set(keys)).toEqual(new Set(["cedarline systems::2025"]));
  });
});

describe("labelsForItemPath", () => {
  it("reads the folders from a stored path that ends in the file name", () => {
    const name = "04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift.docx";
    expect(labelsForItemPath(`${FY}/To be submitted/${name}`, name)).toEqual({
      category: "final_pd",
      companyKey: "cedarline systems",
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      fiscalYearEndAssumed: false,
      pdNumber: "4",
      versionCode: "T",
      versionNumber: 2,
      writerInitials: "DW",
      reviewerInitials: "PN",
      pdTitle: "Cold Chain Sensor Drift",
    });
  });

  it("gives the same labels as classify on the folder path", () => {
    for (const [folders, fileName] of [
      [`${FY}/2. In Review`, "a.docx"],
      ["Halden Foods", "glossary.docx"],
      ["", "loose.pdf"],
    ]) {
      const path = folders ? `${folders}/${fileName}` : fileName;
      const c = classify(folders, fileName);
      expect(labelsForItemPath(path, fileName)).toMatchObject({
        category: c.category,
        companyKey: c.companyKey,
        fiscalYearEnd: c.fiscalYearEnd,
      });
    }
  });

  it("names every label key, undefined when it does not apply, so a patch clears it", () => {
    const labels = labelsForItemPath("Halden Foods/glossary.docx", "glossary.docx");
    expect(Object.keys(labels).sort()).toEqual(
      [
        "category",
        "companyKey",
        "fiscalYearEnd",
        "fiscalYearEndAssumed",
        "pdNumber",
        "pdTitle",
        "reviewerInitials",
        "versionCode",
        "versionNumber",
        "writerInitials",
      ].sort()
    );
    expect(labels).toMatchObject({ category: "company_file", companyKey: "halden foods" });
    expect(labels.pdNumber).toBeUndefined();
    expect(labels.fiscalYearEnd).toBeUndefined();
  });
});
