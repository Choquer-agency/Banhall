import { describe, expect, it } from "vitest";
import { fileNameTerms, fileNameWords, searchQueryWords } from "./fileNameTerms";

describe("file name search words (2026-11-18, review P2-1)", () => {
  it("splits a name with no spaces at letters and digits and at capitals", () => {
    expect(fileNameWords("AcmeFY2021T661.pdf")).toEqual(["acmefy2021t661", "acme", "fy", "2021", "t", "661", "pdf"]);
  });

  it("splits at punctuation and keeps a run of capitals before a word", () => {
    expect(fileNameWords("PDFFile_v2-final (copy).docx")).toEqual(["pdffile", "pdf", "file", "v2", "v", "2", "final", "copy", "docx"]);
  });

  it("keeps accented and other letters, lowercase, each word once", () => {
    expect(fileNameWords("Rapport Équipe ÉTÉ 2024 rapport.pdf")).toEqual(["rapport", "équipe", "été", "2024", "pdf"]);
  });

  it("joins the words with spaces for the stored field", () => {
    expect(fileNameTerms("Website: example.com")).toBe("website example com");
    expect(fileNameTerms("...")).toBe("");
  });

  it("asks the server for the parts of a query only, at most 16, keeping the last", () => {
    expect(searchQueryWords("fy2021")).toEqual(["fy", "2021"]);
    expect(searchQueryWords("T661")).toEqual(["t", "661"]);
    expect(searchQueryWords("  ")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `w${String.fromCharCode(97 + i)}`).join(" ");
    expect(searchQueryWords(many)).toHaveLength(16);
    expect(searchQueryWords(many).at(-1)).toBe("wt");
  });
});
