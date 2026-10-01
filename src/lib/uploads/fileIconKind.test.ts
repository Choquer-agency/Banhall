import { describe, expect, it } from "vitest";
import { fileIconKind } from "./fileIconKind";

describe("fileIconKind", () => {
  it("reads the extension from a file name, ignoring case", () => {
    expect(fileIconKind("Follow-up call, Sep 19.pdf")).toBe("pdf");
    expect(fileIconKind("Interview.DOCX")).toBe("docx");
    expect(fileIconKind("costs.2024.xlsx")).toBe("xlsx");
    expect(fileIconKind("notes.txt")).toBe("txt");
  });

  it("accepts a bare extension with or without the dot", () => {
    expect(fileIconKind("pdf")).toBe("pdf");
    expect(fileIconKind(".xlsx")).toBe("xlsx");
  });

  it("falls back to the neutral icon for anything else", () => {
    expect(fileIconKind("drawings.zip")).toBe("generic");
    expect(fileIconKind("legacy.doc")).toBe("generic");
    expect(fileIconKind("README")).toBe("generic");
    expect(fileIconKind("archive.pdf.zip")).toBe("generic");
    expect(fileIconKind("")).toBe("generic");
    expect(fileIconKind(null)).toBe("generic");
    expect(fileIconKind(undefined)).toBe("generic");
  });
});
