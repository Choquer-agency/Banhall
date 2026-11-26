import { describe, expect, it } from "vitest";
import { formatFolderPath } from "./aiReadFormat";
import {
  detectFileKind,
  fileTypeLabel,
  formatFileSize,
  originalCaption,
  renderDocxPreview,
  renderEmailPreview,
  renderPdfPages,
  renderSpreadsheetPreview,
  SHEET_PREVIEW_MAX_BYTES,
} from "./originalPreview";

describe("originalPreview", () => {
  it("classifies previewable file kinds by extension", () => {
    expect(detectFileKind("PD 4 Label vision check.docx")).toBe("docx");
    expect(detectFileKind("Summary.PDF")).toBe("pdf");
    expect(detectFileKind("Hours.xlsx")).toBe("spreadsheet");
    expect(detectFileKind("Costs.csv")).toBe("spreadsheet");
    expect(detectFileKind("thread.msg")).toBe("email");
    expect(detectFileKind("notes.eml")).toBe("email");
    expect(detectFileKind("diagram.png")).toBe("image");
    expect(detectFileKind("notes.txt")).toBe("text");
    expect(detectFileKind("archive.zip")).toBe("other");
  });

  it("formats readable type labels and original captions", () => {
    expect(fileTypeLabel("PD 4.docx")).toBe("Word file");
    expect(fileTypeLabel("Report.pdf")).toBe("PDF");
    expect(fileTypeLabel("Budget.xlsx")).toBe("Excel file");
    expect(fileTypeLabel("Thread.msg")).toBe("Email");
    expect(originalCaption("PD 4.docx")).toBe("How the file looks in Word");
    expect(originalCaption("Report.pdf")).toBe("Original PDF");
    expect(originalCaption("Thread.msg")).toBe("Original email");
  });

  it("formats byte sizes concisely", () => {
    expect(formatFileSize(undefined)).toBeNull();
    expect(formatFileSize(-1)).toBeNull();
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(217_088)).toBe("212 KB");
    expect(formatFileSize(1_572_864)).toBe("1.5 MB");
    expect(formatFileSize(12_582_912)).toBe("12 MB");
  });

  it("formats folder paths cleanly without repeating the file name", () => {
    expect(formatFolderPath("Cedarline Systems/2025 - Mar 31/Submitted/PD 4.docx", "PD 4.docx")).toBe(
      "Cedarline Systems / 2025 - Mar 31 / Submitted"
    );
    expect(formatFolderPath("PD 4.docx", "PD 4.docx")).toBe("");
    expect(formatFolderPath("Submitted")).toBe("Submitted");
  });

  it("exposes shared preview renderers and size cap", () => {
    expect(typeof renderDocxPreview).toBe("function");
    expect(typeof renderSpreadsheetPreview).toBe("function");
    expect(typeof renderEmailPreview).toBe("function");
    expect(typeof renderPdfPages).toBe("function");
    expect(SHEET_PREVIEW_MAX_BYTES).toBeGreaterThan(0);
  });
});
