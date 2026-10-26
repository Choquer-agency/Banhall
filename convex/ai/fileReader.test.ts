/**
 * 2026-10-26 (Phase B2): the server reads a stored file the way the browser
 * does (src/lib/parseDocument.ts), through the same shared helpers. The
 * files here are built in the test: a PDF with a text layer on each page, a
 * workbook written with SheetJS, a Word file zipped by hand, emails.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { readFileOnServer, SERVER_READER_VERSION } from "./fileReader";
import { textPdf } from "./testFiles.fixture";
import { spreadsheetText } from "../../shared/spreadsheetText";
import { emlToText } from "../../shared/emailText";
import { MAX_CONTENT_CHARS } from "../../shared/documentContent";

/** A Word file with one paragraph per line. */
async function docx(paragraphs: readonly string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`
  );
  return await zip.generateAsync({ type: "uint8array" });
}

const EML = [
  "From: Dana Whitfield <dana@example.com>",
  "To: Priya Shah <priya@example.com>",
  "Subject: Seal trial results",
  "Date: Tue, 06 Oct 2026 14:00:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "The seal held at 4.2 bar in the third trial.",
].join("\r\n");

describe("reading a stored file on the server", () => {
  it("reads a PDF page by page, with where each page starts", async () => {
    const reading = await readFileOnServer(textPdf(["Trial one held at 4.2 bar.", "Trial two failed at 3.1 bar."]), "trials.pdf");
    expect(reading.fileType).toBe("pdf");
    expect(reading.reader).toBe(SERVER_READER_VERSION);
    expect(reading.pageCount).toBe(2);
    expect(reading.text).toContain("Trial one held at 4.2 bar.");
    expect(reading.text).toContain("Trial two failed at 3.1 bar.");
    expect(reading.pageOffsets).toHaveLength(2);
    expect(reading.text.slice(reading.pageOffsets![1]!)).toMatch(/^Trial two/);
    expect(reading.note).toBeUndefined();
  });

  it("says a PDF with no text layer needs OCR, and stops a slow PDF where the browser would", async () => {
    const empty = await readFileOnServer(textPdf([""]), "scan.pdf");
    expect(empty).toMatchObject({ text: "", pageCount: 1 });
    expect(empty.note).toMatch(/OCR/);
    // Out of time before the file opened: nothing read, as the browser.
    const slow = await readFileOnServer(textPdf(["Page one.", "Page two."]), "slow.pdf", { pdfTimeoutMs: 0 });
    expect(slow.text).toBe("");
  });

  it("reads Word, spreadsheets, CSV, text and Markdown as the browser does", async () => {
    expect((await readFileOnServer(await docx(["First paragraph.", "Second paragraph."]), "notes.docx")).text).toBe(
      "First paragraph.\n\nSecond paragraph."
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Trial", "Bar"], [1, 4.2], [2, 3.1]]), "Trials");
    const xlsx = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const sheet = await readFileOnServer(xlsx, "trials.xlsx");
    expect(sheet).toMatchObject({ fileType: "xlsx", text: spreadsheetText(xlsx) });
    expect(sheet.text).toBe("## Sheet: Trials\nTrial,Bar\n1,4.2\n2,3.1");
    expect((await readFileOnServer(new TextEncoder().encode("a,b\r\n1,2\r\n"), "data.csv")).text).toBe("a,b\n1,2");
    expect((await readFileOnServer(new TextEncoder().encode("Notes  \r\n\r\n\r\n\r\nMore"), "notes.txt")).text).toBe("Notes\n\nMore");
    expect((await readFileOnServer(new TextEncoder().encode("# Title\n\nBody"), "notes.md")).fileType).toBe("md");
  });

  it("reads an email and a mailbox with the shared email text", async () => {
    const eml = await readFileOnServer(new TextEncoder().encode(EML), "results.eml");
    expect(eml.text).toBe(await emlToText(EML));
    expect(eml.text).toContain("Subject: Seal trial results");
    expect(eml.text).toContain("The seal held at 4.2 bar in the third trial.");
    const mbox = await readFileOnServer(new TextEncoder().encode(`From x\n${EML}\nFrom y\n${EML.replace("third", "fourth")}`), "box.mbox");
    expect(mbox.text).toContain("third trial");
    expect(mbox.text).toContain("fourth trial");
  });

  it("never throws: pictures, old Word files, unknown types and damaged files come back empty with a note", async () => {
    for (const [name, note] of [
      ["photo.png", /OCR/],
      ["old.doc", /\.docx/],
      ["data.bin", /not read/],
      ["broken.docx", /could not be read/],
      ["broken.pdf", /could not be read|no text layer/],
    ] as const) {
      const reading = await readFileOnServer(new TextEncoder().encode("not really a file"), name);
      expect(reading.text, name).toBe("");
      expect(reading.note, name).toMatch(note);
    }
  });

  it("caps the text at the browser's limit", async () => {
    const long = "x".repeat(MAX_CONTENT_CHARS + 10);
    const reading = await readFileOnServer(new TextEncoder().encode(long), "long.txt");
    expect(reading.text.length).toBeGreaterThan(MAX_CONTENT_CHARS);
    expect(reading.text.startsWith("x".repeat(MAX_CONTENT_CHARS))).toBe(true);
    expect(reading.text.length).toBeLessThan(MAX_CONTENT_CHARS + 200);
  });
});
