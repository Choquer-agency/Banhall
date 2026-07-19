import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  getFileExtension,
  isImageFile,
  isSupportedFile,
  parseFileToText,
  SUPPORTED_ACCEPT,
  SUPPORTED_EXTENSIONS,
} from "./parseDocument";

describe("supported file registry", () => {
  it("accept attribute covers every supported extension", () => {
    const accepted = SUPPORTED_ACCEPT.split(",").map((s) => s.replace(".", ""));
    for (const ext of SUPPORTED_EXTENSIONS) {
      if (ext === "markdown") continue; // .markdown intentionally listed as .markdown
      expect(accepted, `missing .${ext} in SUPPORTED_ACCEPT`).toContain(ext);
    }
  });

  it("classifies spreadsheets, images, and unknowns", () => {
    expect(isSupportedFile("costs.XLSX")).toBe(true);
    expect(isSupportedFile("data.csv")).toBe(true);
    expect(isSupportedFile("drawing.png")).toBe(true);
    expect(isSupportedFile("archive.zip")).toBe(false);
    expect(isImageFile("photo.JPG")).toBe(true);
    expect(isImageFile("report.pdf")).toBe(false);
    expect(getFileExtension("a.b.tar.gz")).toBe("gz");
    expect(getFileExtension("noext")).toBe("");
  });
});

describe("parseFileToText", () => {
  it("parses xlsx workbooks to per-sheet CSV, skipping empty sheets", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Task", "Hours"],
        ["R&D prototyping", 120],
        ["Field trials", 45],
      ]),
      "Costs"
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Empty");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "workbook.xlsx");

    const parsed = await parseFileToText(file);
    expect(parsed.fileType).toBe("xlsx");
    expect(parsed.content).toContain("## Sheet: Costs");
    expect(parsed.content).toContain("R&D prototyping,120");
    expect(parsed.content).not.toContain("Empty");
  });

  it("passes csv through as text", async () => {
    const file = new File(["col1,col2\na,b\n"], "data.csv");
    const parsed = await parseFileToText(file);
    expect(parsed.fileType).toBe("xlsx");
    expect(parsed.content).toContain("col1,col2");
  });

  it("stores images as reference-only with empty content", async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "drawing.png");
    const parsed = await parseFileToText(file);
    expect(parsed.fileType).toBe("image");
    expect(parsed.content).toBe("");
  });

  it("truncates oversized text at the content cap", async () => {
    const file = new File(["x".repeat(500_000)], "big.txt");
    const parsed = await parseFileToText(file);
    expect(parsed.content.length).toBeLessThan(500_000);
    expect(parsed.content).toContain("[Document truncated");
  });
});
