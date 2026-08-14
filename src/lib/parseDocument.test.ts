import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  capContent,
  normalizeExtractedText,
  getFileExtension,
  isImageFile,
  isSupportedFile,
  parseFileToText,
  SUPPORTED_ACCEPT,
  SUPPORTED_EXTENSIONS,
} from "./parseDocument";
import {
  deriveProcessingStatus,
  hasTruncationMarker,
  pdfPageStopMarker,
} from "../../shared/documentStatus";

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

/**
 * PSOS-04 regression: every size-limited path must leave a marker the status
 * derivation can still see at the tail. No parser behaviour changes here —
 * these tests pin the behaviour the receipt depends on.
 */
describe("truncation is detectable by status derivation", () => {
  it("a size-truncated workbook keeps a marker at the tail and derives ready_truncated", async () => {
    const wb = XLSX.utils.book_new();
    // Three sheets, each large enough that the joined content blows the cap:
    // the loop pushes a sheet BEFORE checking the size, so capContent still
    // appends the generic marker and later sheets are silently dropped.
    // Few, wide rows rather than many narrow ones: the cap is measured in
    // characters, and per-cell work is what makes this fixture slow.
    for (const sheet of ["One", "Two", "Three"]) {
      const rows = Array.from({ length: 400 }, (_, i) => [
        `${sheet} row ${i}`,
        "y".repeat(500),
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
    }
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const parsed = await parseFileToText(new File([buf], "huge.xlsx"));
    expect(hasTruncationMarker(parsed.content)).toBe(true);
    expect(deriveProcessingStatus(parsed).status).toBe("ready_truncated");
  });

  it("an over-cap PDF keeps the generic marker after capContent replaces the page marker", () => {
    // The PDF path appends its page-stop marker and then caps: over the cap,
    // the specific marker is cut and the generic one takes its place.
    const content = capContent("p".repeat(500_000) + pdfPageStopMarker(38));
    expect(content).not.toContain("Stopped reading at page");
    expect(hasTruncationMarker(content)).toBe(true);
    expect(
      deriveProcessingStatus({ fileName: "drawings.pdf", content }).status
    ).toBe("ready_truncated");
  });

  it("an under-cap PDF keeps its page-specific marker and still derives ready_truncated", () => {
    const content = capContent("page text" + pdfPageStopMarker(4));
    expect(content).toContain("Stopped reading at page 4");
    expect(
      deriveProcessingStatus({ fileName: "drawings.pdf", content }).status
    ).toBe("ready_truncated");
  });
});

describe("normalizeExtractedText", () => {
  it("collapses Word-export whitespace: CRLF, trailing spaces, newline runs", () => {
    const raw = "Section A \r\n\r\n\r\n\r\n200   \n\nProject title\t\n\n\n\n\nBody text";
    expect(normalizeExtractedText(raw)).toBe(
      "Section A\n\n200\n\nProject title\n\nBody text"
    );
  });

  it("replaces non-breaking spaces and trims the ends", () => {
    expect(normalizeExtractedText("\n\n a\u00A0b \n\n")).toBe("a b");
  });

  it("is idempotent", () => {
    const once = normalizeExtractedText("a\n\n\n\nb  \nc");
    expect(normalizeExtractedText(once)).toBe(once);
  });

  it("capContent normalizes every ingestion path", () => {
    expect(capContent("a\r\n\r\n\r\nb   ")).toBe("a\n\nb");
  });
});
