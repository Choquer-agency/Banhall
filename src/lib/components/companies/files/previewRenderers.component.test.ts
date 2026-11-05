import { describe, expect, it } from "vitest";
import {
  firstSheetTable,
  previewKind,
  readEmail,
  renderPdfPages,
  sanitizeWordHtml,
  wordToSafeHtml,
} from "./previewRenderers";
import { richWordFile, textPdf } from "../../../../../convex/ai/testFiles.fixture";

/**
 * The Files preview's readers of a company file's original (2026-11-04),
 * in a real browser: PDF pages drawn by pdf.js with its bundled worker, a
 * Word file as HTML with only plain formatting kept, a spreadsheet's first
 * sheet, and an email's headers and body. Every name and line is made up.
 */
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("previewKind", () => {
  it("reads the kind from the file type, the name and the type", () => {
    expect(previewKind({ fileName: "a.pdf", fileType: "pdf", mimeType: null })).toBe("pdf");
    expect(previewKind({ fileName: "a.docx", fileType: "docx", mimeType: null })).toBe("word");
    expect(previewKind({ fileName: "a.xlsx", fileType: "xlsx", mimeType: null })).toBe("sheet");
    expect(previewKind({ fileName: "a.msg", fileType: "msg", mimeType: null })).toBe("email");
    expect(previewKind({ fileName: "a.eml", fileType: "eml", mimeType: null })).toBe("email");
    expect(previewKind({ fileName: "a.png", fileType: "image", mimeType: "image/png" })).toBe("image");
    expect(previewKind({ fileName: "Website: example.com", fileType: "txt", mimeType: null })).toBe("text");
  });
});

describe("Word files", () => {
  it("keep headings, emphasis, lists, tables and web links, and lose scripts, images, styles and handlers", () => {
    const html = sanitizeWordHtml(
      '<h1 style="color:red" onclick="alert(1)">Plan</h1><p>The seal <strong>held</strong><img src="x" onerror="alert(2)"></p>' +
        '<script>alert(3)</script><a href="javascript:alert(4)">bad</a><a href="https://example.com">good</a>' +
        '<table><tr><td colspan="2" class="x">cell</td></tr></table><custom-tag>kept text</custom-tag><iframe src="https://evil.test"></iframe>'
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("h1")?.textContent).toBe("Plan");
    expect(host.querySelector("h1")?.attributes.length).toBe(0);
    expect(host.querySelector("strong")?.textContent).toBe("held");
    expect(host.querySelector("img, script, iframe, custom-tag")).toBeNull();
    expect(html).not.toMatch(/alert|onerror|onclick|style=|class=/);
    const links = [...host.querySelectorAll("a")];
    expect(links[0]!.hasAttribute("href")).toBe(false);
    expect(links[1]!.getAttribute("href")).toBe("https://example.com");
    expect(links[1]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(host.querySelector("td")?.getAttribute("colspan")).toBe("2");
    expect(host.textContent).toContain("kept text");
  });

  it("reads a real Word file into safe HTML", async () => {
    const html = await wordToSafeHtml(buffer(await richWordFile()));
    expect(html).toContain("<h1>Seal trials</h1>");
    expect(html).toContain("<strong>held</strong>");
    expect(html).toContain("<table>");
  });
});

describe("spreadsheets", () => {
  it("show the first sheet's rows as text cells", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Week", "Hours"], ["1", 38], ["2", 41.5]]), "Time logs");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Other"]]), "Second");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const sheet = await firstSheetTable(bytes);
    expect(sheet.sheetName).toBe("Time logs");
    expect(sheet.rows).toEqual([["Week", "Hours"], ["1", "38"], ["2", "41.5"]]);
    expect(sheet.moreRows).toBe(false);
  });
});

describe("emails", () => {
  it("show an .eml file's sender, recipients, date, subject and body", async () => {
    const raw = [
      "From: Marc Teo <marc@cedarline.example>",
      "To: Dana Whitlock <dana@cedarline.example>",
      "Subject: Re: frost sensor test plan",
      "Date: Tue, 9 Sep 2025 16:12:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Dana,",
      "",
      "Agreed on running the sensor in both test rooms.",
    ].join("\r\n");
    const email = await readEmail(buffer(new TextEncoder().encode(raw)), "plan.eml");
    expect(email.subject).toBe("Re: frost sensor test plan");
    expect(email.from).toBe("Marc Teo <marc@cedarline.example>");
    expect(email.to).toBe("Dana Whitlock <dana@cedarline.example>");
    expect(email.date).toContain("2025");
    expect(email.body).toBe("Dana,\n\nAgreed on running the sensor in both test rooms.");
  });
});

describe("PDFs", () => {
  it("draw each page with pdf.js's bundled worker", async () => {
    const host = document.createElement("div");
    host.style.width = "33.75rem";
    document.body.append(host);
    const result = await renderPdfPages(buffer(textPdf(["Trial one held.", "Trial two failed."])), host);
    expect(result).toEqual({ pageCount: 2, drawn: 2 });
    const pages = host.querySelectorAll("canvas[data-pdf-page]");
    expect(pages).toHaveLength(2);
    expect((pages[0] as HTMLCanvasElement).width).toBeGreaterThan(0);
    host.remove();
  });
});
