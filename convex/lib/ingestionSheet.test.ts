import { describe, expect, it } from "vitest";
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
  labelPatchFields,
  mergeEditedLabels,
  normalizePdNumber,
  pairGroupsTouched,
  pathFieldsFor,
  previewScienceCode,
  settleItem,
  sheetTabForStatus,
  sortKeyFor,
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
    writerInitials: "DW",
  };

  it("gives nothing for a complete final PD", () => {
    expect(checkReasonsFor(base)).toEqual([]);
  });

  it("gives each reason on its own", () => {
    expect(checkReasonsFor({ ...base, companyKey: undefined })).toEqual(["no_company"]);
    expect(checkReasonsFor({ ...base, category: "unknown", fiscalYearEnd: undefined })).toEqual([
      "unknown_category",
    ]);
    expect(checkReasonsFor({ ...base, status: "failed" })).toEqual(["could_not_read"]);
    expect(checkReasonsFor({ ...base, fiscalYearEnd: undefined })).toEqual(["no_fiscal_year"]);
    expect(checkReasonsFor({ ...base, scienceCode: undefined })).toEqual(["no_science_code"]);
    expect(checkReasonsFor({ ...base, writerInitials: undefined })).toEqual(["no_writer"]);
  });

  it("takes a writer's name or initials", () => {
    expect(checkReasonsFor({ ...base, writerInitials: undefined, writerName: "Dana Whitlock" })).toEqual([]);
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
    const reasons = checkReasonsFor({ ...base, category: "draft", scienceCode: undefined, writerInitials: undefined });
    expect(reasons).toEqual([]);
  });

  it("does not ask for a science code while the file is still being read", () => {
    for (const status of ["discovered", "fetched"] as const) {
      expect(checkReasonsFor({ ...base, status, scienceCode: undefined })).toEqual([]);
      // Reading does not fill in a writer, so that is still asked for.
      expect(checkReasonsFor({ ...base, status, writerInitials: undefined })).toEqual(["no_writer"]);
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

  it("orders everything else by the lower-cased name", () => {
    for (const category of ["transcript", "supporting", "company_file", "unknown"] as const) {
      expect(sortKeyFor({ category, name: "Budget 2025.PDF", pdNumber: "4" })).toBe("budget 2025.pdf");
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
    expect(labelPatchFields({ writerName: " Priya Nair " }).fields).toEqual({ writerName: "Priya Nair" });
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
    expect(() => labelPatchFields({ scienceCode: "9.99.99" })).toThrow(/not a CRA field of science code/);
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
    expect(counts).toEqual({
      total: 2,
      needsCheck: 1,
      ready: 1,
      beingRead: 1,
      categories: { final_pd: { total: 2, needsCheck: 1, fiscalYears: { "2025": 1, none: 1 } } },
    });
    counts = addShare(counts, b, -1);
    expect(counts.categories.final_pd.fiscalYears).toEqual({ "2025": 1 });
    counts = addShare(counts, a, -1);
    expect(counts).toEqual(emptyImportCounts());
  });
});
