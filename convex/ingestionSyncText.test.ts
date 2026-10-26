/**
 * 2026-10-26 (Phase B2): the OneDrive import reads files with the server
 * reader, so a PDF arrives with its text instead of empty.
 */
import { describe, expect, it } from "vitest";
import { extractText } from "./ingestionSync";
import { textPdf } from "./ai/testFiles.fixture";

const bytesOf = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

describe("the OneDrive import's text", () => {
  it("reads a PDF's pages", async () => {
    const { text, note } = await extractText(bytesOf(textPdf(["Seal held at 4.2 bar.", "Second trial."])), "Trials.pdf");
    expect(text).toContain("Seal held at 4.2 bar.");
    expect(text).toContain("Second trial.");
    expect(note).toBeUndefined();
  });

  it("keeps text past the project files' 400,000-character cap, up to its own 700,000", async () => {
    const long = "word ".repeat(120_000).trim();
    const { text } = await extractText(bytesOf(new TextEncoder().encode(long)), "long.txt");
    expect(text).toBe(long);
  });

  it("fails a damaged file, so the item is marked failed as before", async () => {
    await expect(extractText(bytesOf(new TextEncoder().encode("not a zip")), "Broken.docx")).rejects.toThrow(
      /could not be read/
    );
  });

  it("reads text and transcripts, and notes an old Word file", async () => {
    expect((await extractText(bytesOf(new TextEncoder().encode("WEBVTT\n\nHello")), "call.vtt")).text).toBe(
      "WEBVTT\n\nHello"
    );
    const doc = await extractText(bytesOf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), "Old.doc");
    expect(doc.text).toBe("");
    expect(doc.note).toMatch(/\.docx/);
  });
});
