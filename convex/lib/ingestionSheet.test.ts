import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { dashboardCompanyKey } from "../../shared/dashboardProjection";
import { classifyItemPath, INGESTION_CATEGORIES } from "./ingestionClassify";
import {
  addShare,
  countShareOf,
  emptyImportCounts,
  fiscalYearBucket,
  type CountedRow,
} from "./importCompanyCounts";
import {
  approvedPathFields,
  changedFields,
  checkReasonsFor,
  derivedFields,
  docKindForCategory,
  fieldsForLabels,
  followsRememberedWriter,
  initialsWriterFields,
  initialsWriterStep,
  labelPatchFields,
  mergeEditedLabels,
  normalizePdNumber,
  pairGroupsTouched,
  pathFieldsFor,
  pickWriterFields,
  previewScienceCode,
  settleItem,
  sheetSectionFor,
  sheetTabForStatus,
  sortKeyFor,
  takesInitialsWriter,
  writerBeforePickFields,
  writerInitialsKey,
  writerSetByPerson,
  type IngestionItemFields,
} from "./ingestionSheet";

const FY = "Cedarline Systems/2025 - Mar 31";
const PD_NAME = "04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift.docx";

/** A stored row for a path, as the write path builds it before settling. */
function rowAt(path: string, extra: Partial<IngestionItemFields> = {}): IngestionItemFields {
  const name = path.split("/").pop()!;
  return {
    driveItemId: `drive-${path}`,
    path,
    name,
    docKind: "unknown",
    size: 100,
    lastModifiedAt: 1,
    contentHash: "h",
    pairGroupKey: "?::?",
    status: "pending_review",
    updatedAt: 1,
    ...pathFieldsFor(path, name),
    ...extra,
  } as IngestionItemFields;
}

describe("sheetTabForStatus", () => {
  it("puts each status on its tab", () => {
    expect(sheetTabForStatus("discovered")).toBe("review");
    expect(sheetTabForStatus("fetched")).toBe("review");
    expect(sheetTabForStatus("pending_review")).toBe("review");
    expect(sheetTabForStatus("failed")).toBe("review");
    expect(sheetTabForStatus("approved")).toBe("approved");
    expect(sheetTabForStatus("rejected")).toBe("deleted");
    expect(sheetTabForStatus("deleted")).toBe("deleted");
  });
});

describe("docKindForCategory", () => {
  it("maps every category to the docKind pairing and approval read", () => {
    expect(docKindForCategory("final_pd")).toBe("pd");
    expect(docKindForCategory("transcript")).toBe("transcript");
    expect(docKindForCategory("unknown")).toBe("unknown");
    for (const category of ["draft", "review_copy", "supporting", "company_file"] as const) {
      expect(docKindForCategory(category)).toBe("supporting");
    }
  });

  it("agrees with classify wherever classify gives pd, transcript or a client folder", () => {
    for (const path of [
      `${FY}/To be submitted/${PD_NAME}`,
      `${FY}/WIP/Technical/Audio/call.txt`,
      `${FY}/Drafts/notes.docx`,
      `${FY}/In Review/notes.docx`,
      `${FY}/Financials/budget.pdf`,
      "Halden Foods/Glossary/terms.docx",
      "loose.docx",
    ]) {
      const c = classifyItemPath(path, path.split("/").pop()!);
      expect(docKindForCategory(c.category), path).toBe(c.docKind);
    }
    // The one difference from classify: a file at the client level, with no
    // fiscal year folder at all, is a company file and so "supporting".
    expect(classifyItemPath("Halden Foods/glossary.docx", "glossary.docx").docKind).toBe("unknown");
    expect(docKindForCategory("company_file")).toBe("supporting");
  });
});

describe("checkReasonsFor", () => {
  const base = {
    status: "pending_review" as const,
    category: "final_pd" as const,
    companyKey: "cedarline systems",
    fiscalYearEnd: Date.UTC(2025, 2, 31),
    scienceCode: "2.02.09",
    writerName: "Dana Whitlock",
    writerInitials: "DW",
    text: "Extracted text",
  };
  const noWriter = { writerName: undefined, writerInitials: undefined };

  it("gives nothing for a complete final PD", () => {
    expect(checkReasonsFor(base)).toEqual([]);
  });

  it("flags a read file that gave no text, from its preview and stored text", () => {
    // A PDF that is only a scan: read, with a note, and no text.
    expect(checkReasonsFor({ ...base, text: undefined })).toEqual(["no_text"]);
    expect(checkReasonsFor({ ...base, text: "  \n " })).toEqual(["no_text"]);
    // The full text in storage is text, even with an empty preview.
    expect(checkReasonsFor({ ...base, text: undefined, textStorageId: "kg2abc" as never })).toEqual([]);
    // Only once read: a file still being read has no text yet, and one that
    // failed is "could_not_read" alone.
    for (const status of ["discovered", "fetched"] as const) {
      expect(checkReasonsFor({ ...base, status, text: undefined }), status).toEqual([]);
    }
    expect(checkReasonsFor({ ...base, status: "failed", text: undefined })).toEqual(["could_not_read"]);
    // Off the review tab nothing is flagged.
    for (const status of ["approved", "rejected", "deleted"] as const) {
      expect(checkReasonsFor({ ...base, status, text: undefined }), status).toEqual([]);
    }
    // With other reasons, in the fixed order.
    expect(checkReasonsFor({ ...base, text: undefined, companyKey: undefined, ...noWriter })).toEqual([
      "no_company",
      "no_text",
      "no_writer",
    ]);
  });

  it("gives each reason on its own", () => {
    expect(checkReasonsFor({ ...base, companyKey: undefined })).toEqual(["no_company"]);
    expect(checkReasonsFor({ ...base, category: "unknown", fiscalYearEnd: undefined })).toEqual([
      "unknown_category",
    ]);
    expect(checkReasonsFor({ ...base, status: "failed" })).toEqual(["could_not_read"]);
    expect(checkReasonsFor({ ...base, fiscalYearEnd: undefined })).toEqual(["no_fiscal_year"]);
    expect(checkReasonsFor({ ...base, scienceCode: undefined })).toEqual(["no_science_code"]);
    expect(checkReasonsFor({ ...base, ...noWriter })).toEqual(["no_writer"]);
    expect(checkReasonsFor({ ...base, writerName: undefined })).toEqual(["unmatched_initials"]);
  });

  it("takes a writer's name; initials alone need a person to say who they are (2026-11-12)", () => {
    expect(checkReasonsFor({ ...base, writerInitials: undefined })).toEqual([]);
    expect(checkReasonsFor({ ...base, writerName: undefined, writerInitials: "KT" })).toEqual(["unmatched_initials"]);
    // Something that is not initials is no writer at all.
    expect(checkReasonsFor({ ...base, writerName: undefined, writerInitials: "K" })).toEqual(["no_writer"]);
  });

  it("asks for a fiscal year on every category but company files and unknown", () => {
    for (const category of INGESTION_CATEGORIES) {
      const reasons = checkReasonsFor({
        ...base,
        category,
        fiscalYearEnd: undefined,
      });
      expect(reasons.includes("no_fiscal_year"), category).toBe(
        category !== "company_file" && category !== "unknown"
      );
    }
  });

  it("asks for a science code and writer on final PDs only", () => {
    const reasons = checkReasonsFor({ ...base, category: "draft", scienceCode: undefined, ...noWriter });
    expect(reasons).toEqual([]);
    expect(checkReasonsFor({ ...base, category: "draft", writerName: undefined })).toEqual([]);
  });

  it("asks for nothing while the file is still being read", () => {
    for (const status of ["discovered", "fetched"] as const) {
      expect(checkReasonsFor({ ...base, status, scienceCode: undefined })).toEqual([]);
      // The row shows only "Being read", so there is nothing to pick yet.
      expect(checkReasonsFor({ ...base, status, ...noWriter })).toEqual([]);
      expect(checkReasonsFor({ ...base, status, writerName: undefined })).toEqual([]);
      expect(
        checkReasonsFor({ ...base, status, companyKey: undefined, fiscalYearEnd: undefined, category: "unknown" })
      ).toEqual([]);
    }
    // A file that could not be read will not get one from reading.
    expect(checkReasonsFor({ ...base, status: "failed", scienceCode: undefined })).toEqual([
      "could_not_read",
      "no_science_code",
    ]);
  });

  it("flags nothing on the approved and deleted tabs", () => {
    const empty = { status: "approved" as const, category: "unknown" as const };
    expect(checkReasonsFor(empty)).toEqual([]);
    expect(checkReasonsFor({ ...empty, status: "rejected" })).toEqual([]);
    expect(checkReasonsFor({ ...empty, status: "deleted" })).toEqual([]);
  });
});

describe("sortKeyFor", () => {
  const key = (name: string, extra: Partial<IngestionItemFields> = {}) =>
    sortKeyFor({ category: "final_pd", name, ...extra });

  it("orders final PDs by number, then letter, then version, then name", () => {
    const rows = [
      key("b.docx", { pdNumber: "12" }),
      key("a.docx", { pdNumber: "4a" }),
      key("z.docx", { pdNumber: "4", versionCode: "S", versionNumber: 1 }),
      key("y.docx", { pdNumber: "4", versionCode: "R", versionNumber: 2 }),
      key("x.docx", { pdNumber: "4", versionCode: "R", versionNumber: 10 }),
      key("w.docx", { pdNumber: "4", versionCode: "T", versionNumber: 3 }),
      key("v.docx", { pdNumber: "4" }),
      key("u.docx", { pdNumber: "3" }),
      key("A first.docx"),
    ];
    const sorted = [...rows].sort();
    expect(sorted).toEqual([
      key("u.docx", { pdNumber: "3" }),
      key("y.docx", { pdNumber: "4", versionCode: "R", versionNumber: 2 }),
      key("x.docx", { pdNumber: "4", versionCode: "R", versionNumber: 10 }),
      key("w.docx", { pdNumber: "4", versionCode: "T", versionNumber: 3 }),
      key("z.docx", { pdNumber: "4", versionCode: "S", versionNumber: 1 }),
      key("v.docx", { pdNumber: "4" }),
      key("a.docx", { pdNumber: "4a" }),
      key("b.docx", { pdNumber: "12" }),
      key("A first.docx"),
    ]);
  });

  it("orders drafts and review copies the same way", () => {
    for (const category of ["draft", "review_copy"] as const) {
      expect(sortKeyFor({ category, name: "b", pdNumber: "2" }) < sortKeyFor({ category, name: "a", pdNumber: "10" })).toBe(
        true
      );
    }
  });

  it("puts the newest fiscal year first, then files with no year, before the PD number (live QA fixes)", () => {
    const FY2025 = Date.UTC(2025, 2, 31);
    const FY2024 = Date.UTC(2024, 11, 31);
    for (const category of ["final_pd", "draft", "review_copy"] as const) {
      const at = (name: string, extra: Partial<IngestionItemFields>) => sortKeyFor({ category, name, ...extra });
      const rows = [
        at("none-1.docx", { pdNumber: "1" }),
        at("2024-pd1.docx", { pdNumber: "1", fiscalYearEnd: FY2024 }),
        at("2025-pd2.docx", { pdNumber: "2", fiscalYearEnd: FY2025 }),
        at("2024-pd1-s1.docx", { pdNumber: "1", fiscalYearEnd: FY2024, versionCode: "S", versionNumber: 1 }),
        at("2025-pd1.docx", { pdNumber: "1", fiscalYearEnd: FY2025 }),
      ];
      expect([...rows].sort(), category).toEqual([
        at("2025-pd1.docx", { pdNumber: "1", fiscalYearEnd: FY2025 }),
        at("2025-pd2.docx", { pdNumber: "2", fiscalYearEnd: FY2025 }),
        at("2024-pd1-s1.docx", { pdNumber: "1", fiscalYearEnd: FY2024, versionCode: "S", versionNumber: 1 }),
        at("2024-pd1.docx", { pdNumber: "1", fiscalYearEnd: FY2024 }),
        at("none-1.docx", { pdNumber: "1" }),
      ]);
    }
    // A plain string: the year part is four digits, 9999 less the year.
    expect(sortKeyFor({ category: "final_pd", name: "A.docx", pdNumber: "4", fiscalYearEnd: FY2025 })).toBe("7974 0004- ~ a.docx");
    // Only the year counts: two year ends in one year sort by number.
    expect(
      sortKeyFor({ category: "final_pd", name: "z", pdNumber: "1", fiscalYearEnd: Date.UTC(2025, 11, 31) }) <
        sortKeyFor({ category: "final_pd", name: "a", pdNumber: "2", fiscalYearEnd: FY2025 })
    ).toBe(true);
  });

  it("orders everything else by the lower-cased name", () => {
    for (const category of ["transcript", "supporting", "company_file", "unknown"] as const) {
      expect(sortKeyFor({ category, name: "Budget 2025.PDF", pdNumber: "4", fiscalYearEnd: Date.UTC(2025, 2, 31) })).toBe(
        "budget 2025.pdf"
      );
    }
  });
});

describe("pathFieldsFor", () => {
  it("gives the client and fiscal year folders with the labels", () => {
    expect(pathFieldsFor(`${FY}/To be submitted/${PD_NAME}`, PD_NAME)).toMatchObject({
      clientName: "Cedarline Systems",
      fiscalYearLabel: "2025 - Mar 31",
      category: "final_pd",
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      pdNumber: "4",
      versionCode: "T",
      versionNumber: 2,
    });
  });

  it("keeps each label a person set, and only those", () => {
    const kept = {
      editedLabels: ["company", "category", "fiscalYearEnd", "pdNumber", "version"] as const,
      clientName: "Northgate Labs",
      category: "draft" as const,
      fiscalYearEnd: Date.UTC(2023, 5, 30),
      fiscalYearEndAssumed: false,
      pdNumber: "9",
      versionCode: "R" as const,
      versionNumber: 5,
    };
    const fields = pathFieldsFor(`${FY}/To be submitted/${PD_NAME}`, PD_NAME, {
      ...kept,
      editedLabels: [...kept.editedLabels],
    });
    expect(fields).toMatchObject({
      clientName: "Northgate Labs",
      category: "draft",
      // The folder's label stays: only the old page shows it.
      fiscalYearLabel: "2025 - Mar 31",
      fiscalYearEnd: Date.UTC(2023, 5, 30),
      pdNumber: "9",
      versionCode: "R",
      versionNumber: 5,
      // Not settable, so still from the path.
      writerInitials: "DW",
      pdTitle: "Cold Chain Sensor Drift",
    });
    const pathOnly = pathFieldsFor(`${FY}/To be submitted/${PD_NAME}`, PD_NAME, {
      ...kept,
      editedLabels: ["pdNumber"],
    });
    expect(pathOnly).toMatchObject({ clientName: "Cedarline Systems", category: "final_pd", pdNumber: "9", versionCode: "T" });
  });
});

describe("pathFieldsFor with a category a person set", () => {
  it("reads the file name for that category", () => {
    const path = `${FY}/Background/${PD_NAME}`;
    expect(pathFieldsFor(path, PD_NAME).pdNumber).toBeUndefined();
    expect(
      pathFieldsFor(path, PD_NAME, { editedLabels: ["category"], category: "final_pd" })
    ).toMatchObject({ category: "final_pd", pdNumber: "4", versionCode: "T", writerInitials: "DW" });
  });
});

describe("derivedFields and settleItem", () => {
  it("keeps the invariants for rows from many paths", () => {
    for (const path of [
      `${FY}/To be submitted/${PD_NAME}`,
      `${FY}/WIP/Technical/Audio/call.txt`,
      `${FY}/Drafts/notes.docx`,
      "Halden Foods/glossary.docx",
      "Halden Foods/Glossary/terms.docx",
      "loose.docx",
    ]) {
      const row = settleItem(rowAt(path));
      expect(row.docKind, path).toBe(docKindForCategory(row.category!));
      expect(row.companyKey, path).toBe(row.clientName === undefined ? undefined : dashboardCompanyKey(row.clientName));
      expect(row.fiscalYear, path).toBe(
        row.fiscalYearEnd === undefined ? undefined : new Date(row.fiscalYearEnd).getUTCFullYear()
      );
      expect(row.pairGroupKey, path).toBe(`${row.companyKey ?? "?"}::${row.fiscalYear ?? "?"}`);
      expect(row.sheetTab).toBe("review");
      expect(row.needsCheck).toBe(row.checkReasons!.length > 0);
      expect(row.sortKey).toBe(sortKeyFor(row));
    }
  });

  it("agrees with classify on the client, year and pairing key of a path", () => {
    const path = `${FY}/Drafts/notes.docx`;
    const c = classifyItemPath(path, "notes.docx");
    expect(settleItem(rowAt(path))).toMatchObject({
      clientName: c.clientName,
      fiscalYearLabel: c.fiscalYearLabel,
      fiscalYear: c.fiscalYear,
      pairGroupKey: c.pairGroupKey,
    });
  });

  it("fills the labels from the path on a row that has none", () => {
    const path = `${FY}/To be submitted/${PD_NAME}`;
    const row = rowAt(path);
    const bare = { ...row, category: undefined, companyKey: undefined, fiscalYearEnd: undefined, pdNumber: undefined };
    expect(settleItem(bare)).toMatchObject({ category: "final_pd", companyKey: "cedarline systems", pdNumber: "4" });
  });

  it("follows a person's company and year, whatever the folder label says", () => {
    const row = settleItem({
      ...rowAt(`${FY}/Drafts/notes.docx`),
      clientName: "Northgate Labs",
      fiscalYearEnd: Date.UTC(2024, 11, 31),
    });
    expect(row).toMatchObject({
      companyKey: "northgate labs",
      fiscalYear: 2024,
      fiscalYearLabel: "2025 - Mar 31",
      pairGroupKey: "northgate labs::2024",
    });
    // Another spelling of the company keeps the key.
    expect(settleItem({ ...row, clientName: "NORTHGATE  labs" }).pairGroupKey).toBe("northgate labs::2024");
  });

  it("drops the science code source when there is no code", () => {
    const row = rowAt(`${FY}/Drafts/notes.docx`, { scienceCodeSource: "document" });
    expect(derivedFields(row as IngestionItemFields & { category: "draft" }).scienceCodeSource).toBeUndefined();
  });

  it("drops the writer name source when there is no name", () => {
    const row = rowAt(`${FY}/Drafts/notes.docx`, { writerNameSource: "initials" });
    expect(derivedFields(row as IngestionItemFields & { category: "draft" }).writerNameSource).toBeUndefined();
  });
});

describe("writers from initials (2026-11-12, 2026-11-16)", () => {
  const read = { status: "pending_review" as const, category: "final_pd" as const, editedLabels: [] };
  const kim = { id: "writer-kim" as Id<"pdWriters">, label: "Kim Tran" };
  const facts = { hasPick: false, initialsChanged: false };

  it("keys initials as the file names give them, upper case, two or three letters", () => {
    expect(writerInitialsKey("kt")).toBe("KT");
    expect(writerInitialsKey(" DWo ")).toBe("DWO");
    for (const value of [undefined, null, "", "K", "KTDW", "K1", "K.T"]) expect(writerInitialsKey(value), String(value)).toBeNull();
  });

  it("knows a writer a person set on the file, before the source existed too", () => {
    expect(writerSetByPerson({ writerNameSource: "person" })).toBe(true);
    expect(writerSetByPerson({ editedLabels: ["writerName"] })).toBe(true);
    expect(writerSetByPerson({ writerNameSource: "initials", editedLabels: ["category"] })).toBe(false);
    expect(writerSetByPerson({})).toBe(false);
  });

  it("fills a writer only while a file has none, then keeps it: the freeze rule", () => {
    expect(initialsWriterStep({ ...read, writerInitials: "KT" }, facts)).toBe("fill");
    const frozen = { ...read, writerInitials: "KT", writerId: kim.id, writerName: "KT", writerNameSource: "initials" as const };
    expect(initialsWriterStep(frozen, facts)).toBe("keep");
    // Its initials changed (a rename): the check runs again.
    expect(initialsWriterStep(frozen, { ...facts, initialsChanged: true })).toBe("fill");
    // An old row with a name from initials but no writer record: filled.
    expect(initialsWriterStep({ ...frozen, writerId: undefined }, facts)).toBe("fill");
  });

  it("follows a pick whatever writer the file had, and when the pick goes the check fills it again", () => {
    const frozen = { ...read, writerInitials: "KT", writerId: kim.id, writerName: "KT", writerNameSource: "initials" as const };
    expect(initialsWriterStep(frozen, { ...facts, hasPick: true })).toBe("pick");
    expect(initialsWriterStep({ ...frozen, writerNameSource: "pick" as const }, facts)).toBe("fill");
  });

  it("drops a writer from initials a file no longer takes, and never touches one a person set or an approved file", () => {
    const moved = { ...read, category: "transcript" as const, writerInitials: "KT", writerId: kim.id, writerName: "Kim Tran", writerNameSource: "initials" as const };
    expect(takesInitialsWriter(moved)).toBe(false);
    expect(initialsWriterStep(moved, facts)).toBe("clear");
    expect(initialsWriterStep({ ...read, category: "transcript" as const, writerInitials: "KT" }, facts)).toBe("none");
    expect(takesInitialsWriter({ category: "draft", writerInitials: "KT" })).toBe(true);
    const person = { ...read, writerInitials: "KT", writerName: "Jordan Ellis", writerNameSource: "person" as const };
    expect(followsRememberedWriter(person)).toBe(false);
    expect(initialsWriterStep(person, { hasPick: true, initialsChanged: true })).toBe("none");
    const before = { ...read, writerInitials: "KT", writerName: "Jordan Ellis", editedLabels: ["writerName" as const] };
    expect(initialsWriterStep(before, { ...facts, hasPick: true })).toBe("none");
    const approved = { ...read, status: "approved" as const, writerInitials: "KT" };
    expect(initialsWriterStep(approved, { ...facts, hasPick: true })).toBe("none");
    // A file with no initials and no writer from them has nothing to follow.
    expect(followsRememberedWriter({ ...read })).toBe(false);
    // Deleted files follow too, so a file put back shows the writer.
    expect(followsRememberedWriter({ ...read, status: "deleted", writerInitials: "KT" })).toBe(true);
  });

  it("gives the writer fields of a writer from initials, or takes them away", () => {
    expect(initialsWriterFields(kim, "pick")).toEqual({ writerId: kim.id, writerName: "Kim Tran", writerNameSource: "pick" });
    expect(initialsWriterFields(null, "initials")).toEqual({ writerId: undefined, writerName: undefined, writerNameSource: undefined });
  });

  it("remembers the writer a file had when it starts to follow a pick, and gives exactly that back on Undo", () => {
    const sam = { id: "writer-sam" as Id<"pdWriters">, label: "Sam Okafor" };
    const frozen = { writerId: kim.id, writerName: "KT", writerNameSource: "initials" as const };
    const picked = pickWriterFields(frozen, sam, false);
    expect(picked).toEqual({ writerId: sam.id, writerName: "Sam Okafor", writerNameSource: "pick", writerBeforePick: frozen });
    // A second pick keeps what the file had before the first.
    const jordan = { id: "writer-jordan" as Id<"pdWriters">, label: "Jordan Ellis" };
    expect(pickWriterFields({ ...frozen, ...picked }, jordan, false).writerBeforePick).toEqual(frozen);
    // A file with no writer remembers none; one whose initials just changed forgets.
    expect(pickWriterFields({}, sam, false).writerBeforePick).toEqual({});
    expect(pickWriterFields({ ...frozen, ...picked }, jordan, true).writerBeforePick).toEqual({});
    // Undo: exactly the writer, name and source it had; none remembered means the check fills it.
    expect(writerBeforePickFields({ ...picked }, false)).toEqual({ ...frozen, writerBeforePick: undefined });
    expect(writerBeforePickFields({ writerNameSource: "pick", writerBeforePick: {} }, false)).toBeNull();
    expect(writerBeforePickFields({ ...picked }, true)).toBeNull();
    // Only a file following a pick keeps what it remembered.
    const row = rowAt(`${FY}/To be submitted/${PD_NAME}`);
    expect(settleItem({ ...row, status: "pending_review", ...picked }).writerBeforePick).toEqual(frozen);
    expect(settleItem({ ...row, status: "pending_review", ...picked, writerNameSource: "person" }).writerBeforePick).toBeUndefined();
  });

  it("settles a writer from initials with no check, and keeps an approved file's writer with no stored name", () => {
    const row = rowAt(`${FY}/To be submitted/${PD_NAME}`);
    const unmatched = settleItem({ ...row, status: "pending_review", scienceCode: "2.02.09" });
    expect(unmatched.writerInitials).toBe("DW");
    expect(unmatched.checkReasons).toContain("unmatched_initials");
    const dana = { id: "writer-dana" as Id<"pdWriters">, label: "Dana Whitlock" };
    const matched = settleItem({ ...unmatched, ...initialsWriterFields(dana, "initials") });
    expect(matched).toMatchObject({ writerId: dana.id, writerName: "Dana Whitlock", writerNameSource: "initials" });
    expect(matched.checkReasons).not.toContain("unmatched_initials");
    // The writer goes with its name, except on an approved file.
    expect(settleItem({ ...matched, writerName: undefined }).writerId).toBeUndefined();
    expect(settleItem({ ...matched, status: "approved", writerName: undefined }).writerId).toBe(dana.id);
  });
});

describe("approved rows staged before the labels", () => {
  /** An approved PD from main: no labels, and main moved its path without changing its client or year. */
  function oldApproved(path: string): IngestionItemFields {
    return {
      driveItemId: "drive-approved",
      path,
      name: path.split("/").pop()!,
      clientName: "Cedarline Systems",
      fiscalYearLabel: "2025 - Mar 31",
      fiscalYear: 2025,
      docKind: "pd",
      size: 100,
      lastModifiedAt: 1,
      contentHash: "h",
      pairGroupKey: "Cedarline Systems::2025 - Mar 31",
      status: "approved",
      updatedAt: 1,
    } as IngestionItemFields;
  }

  it("get their labels from the path when it was not moved", () => {
    const row = oldApproved(`${FY}/To be submitted/${PD_NAME}`);
    expect(approvedPathFields(row)).toEqual(pathFieldsFor(row.path, row.name));
  });

  it("keep the client, year and kind they were approved as when main moved the path", () => {
    const row = settleItem(oldApproved(`Halden Foods/2024 - Dec 31/Drafts/${PD_NAME}`));
    expect(row).toMatchObject({
      clientName: "Cedarline Systems",
      companyKey: "cedarline systems",
      fiscalYearLabel: "2025 - Mar 31",
      fiscalYear: 2025,
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      // The Drafts folder alone would make it a draft; it was approved as a PD.
      category: "final_pd",
      docKind: "pd",
      pairGroupKey: "cedarline systems::2025",
      sheetTab: "approved",
      pdNumber: "4",
    });
  });

  it("are filled from the path like any other row when not approved", () => {
    const row = settleItem({ ...oldApproved(`Halden Foods/2024 - Dec 31/Drafts/${PD_NAME}`), status: "pending_review" });
    expect(row).toMatchObject({ clientName: "Halden Foods", fiscalYear: 2024, category: "draft", docKind: "supporting" });
  });
});

describe("previewScienceCode", () => {
  const read = {
    category: "final_pd" as const,
    status: "pending_review" as const,
    text: "Field of science or technology: 2.02.09",
  };

  it("reads the code from the stored preview of a final PD waiting for review", () => {
    expect(previewScienceCode(read)).toEqual({ scienceCode: "2.02.09", scienceCodeSource: "document" });
  });

  it("reads nothing for other rows", () => {
    expect(previewScienceCode({ ...read, category: "draft" })).toEqual({});
    for (const status of ["discovered", "fetched", "failed", "approved", "rejected", "deleted"] as const) {
      expect(previewScienceCode({ ...read, status }), status).toEqual({});
    }
    expect(previewScienceCode({ ...read, scienceCode: "1.02.01", scienceCodeSource: "document" })).toEqual({});
    expect(previewScienceCode({ ...read, editedLabels: ["scienceCode"] })).toEqual({});
    expect(previewScienceCode({ ...read, scienceCodeSource: "person" })).toEqual({});
    expect(previewScienceCode({ ...read, text: undefined })).toEqual({});
    expect(previewScienceCode({ ...read, text: "Code 2.02.09 somewhere" })).toEqual({});
  });
});

describe("changedFields", () => {
  it("names the keys that changed, with undefined for a cleared one", () => {
    expect(
      changedFields(
        { name: "a", checkReasons: ["no_company"], pdNumber: "4" },
        { name: "a", checkReasons: ["no_company"], pdNumber: undefined, sortKey: "a" }
      )
    ).toEqual({ pdNumber: undefined, sortKey: "a" });
    expect(changedFields({ checkReasons: ["no_company"] }, { checkReasons: [] })).toEqual({ checkReasons: [] });
  });
});

describe("labelPatchFields", () => {
  it("turns each label into its row fields", () => {
    expect(labelPatchFields({ company: "  Brightwell   Dairy " })).toEqual({
      fields: { clientName: "Brightwell Dairy" },
      labels: ["company"],
    });
    expect(labelPatchFields({ category: "draft" }).fields).toEqual({ category: "draft" });
    // The fiscal year folder label is left as it is.
    expect(labelPatchFields({ fiscalYearEnd: Date.UTC(2024, 5, 30) }).fields).toEqual({
      fiscalYearEnd: Date.UTC(2024, 5, 30),
      fiscalYearEndAssumed: false,
    });
    expect(labelPatchFields({ pdNumber: "04" }).fields).toEqual({ pdNumber: "4" });
    expect(labelPatchFields({ version: { code: "R", number: 3 } }).fields).toEqual({
      versionCode: "R",
      versionNumber: 3,
    });
    expect(labelPatchFields({ writerName: " Priya Nair " })).toEqual({
      fields: { writerName: "Priya Nair", writerNameSource: "person" },
      labels: ["writerName"],
      // A typed name, cleaned, for the server to turn into a writer (2026-11-16).
      writer: { kind: "name", name: "Priya Nair" },
    });
    // A chosen writer: the server sets its id and label.
    const chosen = { kind: "user" as const, userId: "user-priya" as Id<"users"> };
    expect(labelPatchFields({ writer: chosen })).toEqual({
      fields: { writerNameSource: "person" },
      labels: ["writerName"],
      writer: chosen,
    });
    expect(() => labelPatchFields({ writer: { kind: "name", name: "priya@example.com" } })).toThrow(
      "Type the writer's name, not an email address."
    );
    expect(labelPatchFields({ scienceCode: " 2.02.09 " }).fields).toEqual({
      scienceCode: "2.02.09",
      scienceCodeSource: "person",
    });
  });

  it("marks every label it sets", () => {
    const { labels } = labelPatchFields({
      scienceCode: "2.02.09",
      company: "Halden Foods",
      version: { code: "T", number: 1 },
    });
    expect(labels.sort()).toEqual(["company", "scienceCode", "version"]);
  });

  it("refuses values it cannot take, in plain words", () => {
    expect(() => labelPatchFields({})).toThrow("Choose a label to change.");
    expect(() => labelPatchFields({ company: "   " })).toThrow("Type a company name.");
    expect(() => labelPatchFields({ company: "x".repeat(201) })).toThrow(/up to 200/);
    expect(() => labelPatchFields({ fiscalYearEnd: Date.UTC(2024, 5, 30) + 1 })).toThrow(/fiscal year end/);
    expect(() => labelPatchFields({ fiscalYearEnd: Date.UTC(1800, 0, 1) })).toThrow(/fiscal year end/);
    expect(() => labelPatchFields({ fiscalYearEnd: Number.NaN })).toThrow(/fiscal year end/);
    expect(() => labelPatchFields({ pdNumber: "21" })).toThrow(/PD number/);
    expect(() => labelPatchFields({ pdNumber: "4ab" })).toThrow(/PD number/);
    expect(() => labelPatchFields({ version: { code: "R", number: 1.5 } })).toThrow(/version number/);
    expect(() => labelPatchFields({ writerName: " " })).toThrow("Type the writer's name.");
    // The roster falls back to an email address; it is never a writer.
    expect(() => labelPatchFields({ writerName: "dana.whitlock@example.com" })).toThrow(
      "Type the writer's name, not an email address."
    );
    expect(() => labelPatchFields({ scienceCode: "9.99.99" })).toThrow(/not a CRA field of science code/);
  });
});

describe("fieldsForLabels", () => {
  it("keeps only the row fields of the labels that apply to one file", () => {
    const { fields } = labelPatchFields({
      category: "final_pd",
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      version: { code: "T", number: 2 },
      writerName: "Priya Nair",
      scienceCode: "2.02.09",
    });
    expect(fieldsForLabels(fields, ["category"])).toEqual({ category: "final_pd" });
    expect(fieldsForLabels(fields, ["fiscalYearEnd", "scienceCode"])).toEqual({
      fiscalYearEnd: Date.UTC(2025, 2, 31),
      fiscalYearEndAssumed: false,
      scienceCode: "2.02.09",
      scienceCodeSource: "person",
    });
    expect(fieldsForLabels(fields, ["version", "writerName"])).toEqual({
      versionCode: "T",
      versionNumber: 2,
      writerName: "Priya Nair",
      writerNameSource: "person",
    });
    expect(fieldsForLabels(fields, [])).toEqual({});
  });
});

describe("normalizePdNumber", () => {
  it("strips leading zeros and keeps a letter", () => {
    expect(normalizePdNumber("04")).toBe("4");
    expect(normalizePdNumber("12a")).toBe("12a");
    expect(normalizePdNumber("20")).toBe("20");
    expect(normalizePdNumber("0")).toBeNull();
    expect(normalizePdNumber("21")).toBeNull();
    expect(normalizePdNumber("PD 4")).toBeNull();
  });
});

describe("mergeEditedLabels", () => {
  it("adds labels once, in a fixed order", () => {
    expect(mergeEditedLabels(["scienceCode"], ["company", "scienceCode"])).toEqual(["company", "scienceCode"]);
    expect(mergeEditedLabels(undefined, ["version"])).toEqual(["version"]);
  });
});

describe("pairGroupsTouched", () => {
  const row = { pairGroupKey: "A::2025", docKind: "pd" as const, status: "pending_review" as const };
  it("names both groups when the group changes, the row's group now first", () => {
    expect(pairGroupsTouched(row, { ...row, pairGroupKey: "B::2025" })).toEqual(["B::2025", "A::2025"]);
  });
  it("names the group when the PD or transcript role or liveness changes", () => {
    expect(pairGroupsTouched(row, { ...row, docKind: "supporting" })).toEqual(["A::2025"]);
    expect(pairGroupsTouched(row, { ...row, status: "rejected" })).toEqual(["A::2025"]);
  });
  it("names none when nothing pairing reads changed", () => {
    expect(pairGroupsTouched(row, { ...row, status: "approved" })).toEqual([]);
    expect(
      pairGroupsTouched({ ...row, docKind: "supporting" }, { ...row, docKind: "unknown" })
    ).toEqual([]);
  });
});

describe("company band counts", () => {
  const counted = (extra: Partial<CountedRow>): CountedRow => ({
    sheetTab: "review",
    companyKey: "halden foods",
    category: "final_pd",
    fiscalYearEnd: Date.UTC(2025, 2, 31),
    needsCheck: false,
    status: "pending_review",
    clientName: "Halden Foods",
    ...extra,
  });

  it("counts nothing for a row that is not on the sheet", () => {
    expect(countShareOf(null)).toBeNull();
    expect(countShareOf(counted({ sheetTab: undefined }))).toBeNull();
    expect(countShareOf(counted({ category: undefined }))).toBeNull();
  });

  it("puts a row with no company in the empty-key band, and no year in the none bucket", () => {
    expect(countShareOf(counted({ companyKey: undefined, fiscalYearEnd: undefined }))).toMatchObject({
      companyKey: "",
      fiscalYear: "none",
    });
    expect(fiscalYearBucket(Date.UTC(2024, 11, 31))).toBe("2024");
  });

  it("adds and takes away shares, removing empty categories and years", () => {
    const a = countShareOf(counted({}))!;
    const b = countShareOf(counted({ needsCheck: true, status: "fetched", fiscalYearEnd: undefined }))!;
    let counts = addShare(addShare(emptyImportCounts(), a, 1), b, 1);
    // b is still being read, so it waits under Not sorted yet ("unknown", 2026-11-12).
    expect(counts).toEqual({
      total: 2,
      needsCheck: 1,
      ready: 1,
      beingRead: 1,
      categories: {
        final_pd: { total: 1, needsCheck: 0, fiscalYears: { "2025": 1 } },
        unknown: { total: 1, needsCheck: 1, fiscalYears: { none: 1 } },
      },
    });
    counts = addShare(counts, b, -1);
    expect(counts.categories.unknown).toBeUndefined();
    expect(counts.categories.final_pd.fiscalYears).toEqual({ "2025": 1 });
    counts = addShare(counts, a, -1);
    expect(counts).toEqual(emptyImportCounts());
  });

  it("counts a file to check once in needsCheck and once under each of its reasons", () => {
    const two = countShareOf(counted({ needsCheck: true, checkReasons: ["no_writer", "no_science_code"] }))!;
    expect(two.checkReasons).toEqual(["no_science_code", "no_writer"]);
    const one = countShareOf(counted({ needsCheck: true, checkReasons: ["no_science_code"] }))!;
    let counts = addShare(addShare(emptyImportCounts(), two, 1), one, 1);
    expect(counts.needsCheck).toBe(2);
    expect(counts.categories.final_pd).toEqual({
      total: 2,
      needsCheck: 2,
      fiscalYears: { "2025": 2 },
      checkReasons: { no_science_code: 2, no_writer: 1 },
    });
    // A reason at zero goes, and the map goes once it is empty.
    counts = addShare(counts, two, -1);
    expect(counts.categories.final_pd.checkReasons).toEqual({ no_science_code: 1 });
    counts = addShare(counts, one, -1);
    expect(counts).toEqual(emptyImportCounts());
    // Reasons count only while the file needs a check.
    expect(countShareOf(counted({ needsCheck: false, checkReasons: ["no_writer"] }))!.checkReasons).toEqual([]);
  });

  it("starts a stored category with no reason map from an empty one", () => {
    const legacy = { total: 1, needsCheck: 1, ready: 0, beingRead: 0, categories: { final_pd: { total: 1, needsCheck: 1, fiscalYears: { "2025": 1 } } } };
    const share = countShareOf(counted({ needsCheck: true, checkReasons: ["no_writer"] }))!;
    expect(addShare(legacy, share, 1).categories.final_pd.checkReasons).toEqual({ no_writer: 1 });
    // Taking away a reason it never counted leaves a negative count for the repair to put right.
    expect(addShare(legacy, share, -1).categories).toEqual({});
    const two = { ...legacy, total: 2, categories: { final_pd: { total: 2, needsCheck: 2, fiscalYears: { "2025": 2 } } } };
    expect(addShare(two, share, -1).categories.final_pd.checkReasons).toEqual({ no_writer: -1 });
  });

  it("counts a New file on To review in its band and section, with its year, and never on another tab", () => {
    const fresh = countShareOf(counted({ isNew: true }))!;
    expect(fresh.isNew).toBe(true);
    expect(countShareOf(counted({ isNew: true, sheetTab: "deleted", status: "deleted" }))!.isNew).toBe(false);
    expect(countShareOf(counted({ isNew: undefined }))!.isNew).toBe(false);
    const old = countShareOf(counted({ fiscalYearEnd: Date.UTC(2024, 2, 31) }))!;
    let counts = addShare(addShare(emptyImportCounts(), fresh, 1), old, 1);
    expect(counts.newFiles).toBe(1);
    expect(counts.categories.final_pd).toEqual({
      total: 2,
      needsCheck: 0,
      fiscalYears: { "2025": 1, "2024": 1 },
      newFiles: 1,
      newFiscalYears: { "2025": 1 },
    });
    // The 24 hours end: the same file, no longer New, moves only the New counts.
    counts = addShare(addShare(counts, fresh, -1), { ...fresh, isNew: false }, 1);
    expect(counts.newFiles).toBeUndefined();
    expect(counts.categories.final_pd).toEqual({ total: 2, needsCheck: 0, fiscalYears: { "2025": 1, "2024": 1 } });
  });
});

describe("the section a file shows in (2026-11-12)", () => {
  it("is Not sorted yet while the file is being read, then its category", () => {
    expect(sheetSectionFor({ status: "discovered", category: "final_pd" })).toBe("unknown");
    expect(sheetSectionFor({ status: "fetched", category: "transcript" })).toBe("unknown");
    expect(sheetSectionFor({ status: "pending_review", category: "final_pd" })).toBe("final_pd");
    expect(sheetSectionFor({ status: "failed", category: "draft" })).toBe("draft");
    // A file still unsorted after reading stays there.
    expect(sheetSectionFor({ status: "pending_review", category: "unknown" })).toBe("unknown");
    expect(sheetSectionFor({ status: "approved", category: "supporting" })).toBe("supporting");
    expect(sheetSectionFor({ status: "discovered", category: undefined })).toBeUndefined();
  });

  it("is settled on every write, so a file moves to its section when reading ends", () => {
    const row = settleItem({
      driveItemId: "local:Halden Foods/2025/Submitted/04 HaldenFoods 2025-06-30 T1.SO Proofing.docx",
      path: "Halden Foods/2025/Submitted/04 HaldenFoods 2025-06-30 T1.SO Proofing.docx",
      name: "04 HaldenFoods 2025-06-30 T1.SO Proofing.docx",
      docKind: "pd",
      size: 10,
      lastModifiedAt: 1,
      contentHash: "h",
      pairGroupKey: "?",
      status: "fetched",
      updatedAt: 1,
    });
    expect(row.category).toBe("final_pd");
    expect(row.sheetSection).toBe("unknown");
    // Being read: no check reasons at all, so being read, ready and to check add up.
    expect(row.checkReasons).toEqual([]);
    expect(settleItem({ ...row, status: "pending_review" }).sheetSection).toBe("final_pd");
  });
});
