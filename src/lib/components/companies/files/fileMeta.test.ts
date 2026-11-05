import { describe, expect, it } from "vitest";
import { describeFile, draggedTypeLabel, fiscalYearOf, fiscalYearOptions, groupFiles, type ListedCompanyFile } from "./fileMeta";
import { uniqueNames } from "./downloadOriginals";
import { uploadStatus } from "./uploads";

/** The Files tab's words and groups (2026-11-04). */
function file(id: string, overrides: Partial<ListedCompanyFile> = {}): ListedCompanyFile {
  return {
    _id: id as ListedCompanyFile["_id"],
    fileName: `${id}.txt`,
    fileType: "txt",
    category: null,
    sizeChars: 10,
    wordCount: 2,
    archived: false,
    processingStatus: "ready",
    textFormat: null,
    hasFile: true,
    url: null,
    mimeType: null,
    createdAt: 0,
    addedBy: null,
    fromWebsite: false,
    bytes: null,
    labels: null,
    ...overrides,
  };
}

const label = (fiscalYear: number | null, documentType = "meeting notes") => ({ documentType, fiscalYear, title: "t", summary: "s" });

describe("fiscalYearOf", () => {
  it("takes the year a person picked, a person's 'none', else the AI label's year", () => {
    expect(fiscalYearOf(file("a", { fiscalYear: 2026, labels: label(2024) }))).toBe(2026);
    expect(fiscalYearOf(file("a", { fiscalYear: null, labels: label(2024) }))).toBeNull();
    expect(fiscalYearOf(file("a", { labels: label(2024) }))).toBe(2024);
    expect(fiscalYearOf(file("a"))).toBeNull();
  });
});

describe("groupFiles", () => {
  it("puts unread files first, then years newest first, then no year, keeping the list's order", () => {
    const groups = groupFiles([
      file("a", { labels: label(2025) }),
      file("b", { processingStatus: "could_not_read", labels: label(2026) }),
      file("c", { fiscalYear: 2026 }),
      file("d"),
      file("e", { labels: label(2025) }),
    ]);
    expect(groups.map((group) => [group.label, group.files.map((entry) => entry._id)])).toEqual([
      ["Could not read", ["b"]],
      ["FY 2026", ["c"]],
      ["FY 2025", ["a", "e"]],
      ["No fiscal year", ["d"]],
    ]);
  });
});

describe("words", () => {
  it("names a file by a person's category, else the AI's kind, else its type", () => {
    expect(describeFile(file("a", { category: "previous_pd", labels: label(null) }))).toBe("Prior SR&ED report");
    expect(describeFile(file("a", { labels: label(null, "test or lab results") }))).toBe("Test or lab results");
    expect(describeFile(file("a", { fileType: "xlsx" }))).toBe("Spreadsheet");
  });

  it("offers next year back ten years, plus a file's own older year", () => {
    const years = fiscalYearOptions(new Date("2026-11-04T12:00:00Z"), 2009);
    expect(years[0]).toBe(2027);
    expect(years).toContain(2016);
    expect(years.at(-1)).toBe(2009);
  });

  it("names dragged files by type only", () => {
    expect(draggedTypeLabel("application/pdf").label).toBe("PDF file");
    expect(draggedTypeLabel("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").label).toBe("Excel file");
    expect(draggedTypeLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document").label).toBe("Word file");
    expect(draggedTypeLabel("").label).toBe("File");
  });

  it("says each step of a file being added, and refuses one too large in plain words", () => {
    expect(uploadStatus({ phase: "uploading", fraction: 0.64, error: null })).toBe("Uploading, 64%");
    expect(uploadStatus({ phase: "too_large", fraction: 0, error: null })).toBe("Too large, up to 50 MB");
    expect(uploadStatus({ phase: "failed", fraction: 0, error: "Network lost" })).toBe("Network lost");
  });
});

describe("uniqueNames", () => {
  it("keeps two files of the same name apart in a zip", () => {
    expect(uniqueNames(["a.pdf", "A.pdf", "a.pdf", "notes"])).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf", "notes"]);
  });
});
