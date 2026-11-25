import { describe, expect, it } from "vitest";
import {
  detectFileKind,
  fileTypeLabel,
  formatFileSize,
  formatFolderPath,
  originalCaption,
  sanitizeDocumentHtml,
} from "./originalPreview";

describe("originalPreview", () => {
  it("classifies previewable file kinds by extension", () => {
    expect(detectFileKind("PD 4 Label vision check.docx")).toBe("docx");
    expect(detectFileKind("Summary.PDF")).toBe("pdf");
    expect(detectFileKind("Hours.xlsx")).toBe("spreadsheet");
    expect(detectFileKind("Costs.csv")).toBe("spreadsheet");
    expect(detectFileKind("diagram.png")).toBe("image");
    expect(detectFileKind("notes.txt")).toBe("text");
    expect(detectFileKind("archive.zip")).toBe("other");
  });

  it("formats readable type labels and original captions", () => {
    expect(fileTypeLabel("PD 4.docx")).toBe("Word file");
    expect(fileTypeLabel("Report.pdf")).toBe("PDF");
    expect(fileTypeLabel("Budget.xlsx")).toBe("Excel file");
    expect(originalCaption("PD 4.docx")).toBe("How the file looks in Word");
    expect(originalCaption("Report.pdf")).toBe("Original PDF");
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
    expect(formatFolderPath("PD 4.docx", "PD 4.docx")).toBe("PD 4.docx");
  });

  it("strips unsafe tags and attributes when sanitizing HTML", () => {
    const clean = sanitizeDocumentHtml(
      '<p>Hello</p><script>alert(1)</script><a href="javascript:alert(2)">Bad</a><a href="https://example.com">Good</a>'
    );
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("Hello");
    expect(clean).toContain("Good");
  });
});
