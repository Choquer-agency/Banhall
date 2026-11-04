"use node";

/**
 * Reading a file's text on the server (2026-10-26, context pipeline plan
 * Phase B2; decision "2026-10-26" part 2). The same rules as the browser's
 * reader (src/lib/parseDocument.ts), through the same shared helpers, so a
 * file reads the same wherever it is read: text and Markdown as they are,
 * Word with mammoth, PDFs page by page with pdf.js, spreadsheets as CSV per
 * sheet, emails as headers and body. Pictures hold no text here; scans wait
 * for OCR (Phase B3). No AI writes any of this text.
 *
 * Node runtime: pdf.js runs with its worker in the same thread, as the
 * chat's page count does (convex/ai/chatPdfPages.ts).
 */

import mammoth from "mammoth";
import { safeErrorDetails } from "../lib/safeErrorDetails";
import {
  getFileExtension,
  isImageFile,
  mboxOverflowMarker,
  normalizeExtractedText,
  pdfPageStopMarker,
} from "../../shared/documentStatus";
import { capContent, locatePageOffsets, MAX_CONTENT_CHARS } from "../../shared/documentContent";
import { spreadsheetText } from "../../shared/spreadsheetText";
import { emailToText, emlToText, fmtPerson, MAX_MBOX_MESSAGES, splitMbox } from "../../shared/emailText";
import { wordToMarkdown } from "../../shared/wordMarkdown";

import { SERVER_READER_VERSION } from "../lib/serverReading";

/** Recorded with every server reading, so a better reader can read again. */
export { SERVER_READER_VERSION };

/** pdf.js stops reading a PDF after this long; the pages read so far are kept. */
export const SERVER_PDF_TIMEOUT_MS = 240_000;

export type ServerFileType = "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "xlsx" | "image" | "other";

export type ServerReading = {
  fileType: ServerFileType;
  /** The cleaned text, capped like the browser's (MAX_CONTENT_CHARS). */
  text: string;
  /** PDFs only. */
  pageCount?: number;
  /** PDFs only: where each page read starts in `text`. */
  pageOffsets?: number[];
  /** Why there is no text, or why it stops early. Never file text. */
  note?: string;
  /** The reader failed (a damaged file, or a library that did not load): not a real empty reading. */
  failed?: true;
  /** Word files read as Markdown (shared/wordMarkdown.ts). */
  textFormat?: "markdown";
  reader: typeof SERVER_READER_VERSION;
};

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsLoad: Promise<PdfJs> | null = null;

/** pdf.js with its worker set up in this thread, loaded once per instance. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoad ??= (async () => {
    // A static specifier, so the bundler includes the worker module.
    // @ts-expect-error pdfjs-dist ships no type declarations for its worker module.
    const worker: unknown = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  })().catch((error: unknown) => {
    pdfjsLoad = null;
    throw error;
  });
  return pdfjsLoad;
}

class ReadTimeout extends Error {
  constructor() {
    super("read timeout");
  }
}

function before<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const ms = deadline - Date.now();
  if (ms <= 0) {
    void promise.catch(() => {});
    return Promise.reject(new ReadTimeout());
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ReadTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const utf8 = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

async function readPdf(bytes: Uint8Array, timeoutMs: number, maxChars: number): Promise<ServerReading> {
  const pdfjs = await loadPdfJs();
  const deadline = Date.now() + timeoutMs;
  // pdf.js takes the buffer over; give it a copy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let text = "";
  let stoppedAtPage = 0;
  let pageCount = 0;
  const pages: string[] = [];
  try {
    const pdf = await before(task.promise, deadline);
    pageCount = pdf.numPages;
    for (let index = 1; index <= pdf.numPages; index += 1) {
      try {
        const page = await before(pdf.getPage(index), deadline);
        const content = await before(page.getTextContent(), deadline);
        const strings = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
        text += `${strings}\n\n`;
        pages.push(strings);
      } catch (error) {
        if (!(error instanceof ReadTimeout)) throw error;
        stoppedAtPage = index;
        break;
      }
      if (text.length > maxChars) {
        stoppedAtPage = index + 1;
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof ReadTimeout)) throw error;
  } finally {
    void task.destroy().catch(() => {});
  }
  if (stoppedAtPage > 0) text += pdfPageStopMarker(stoppedAtPage);
  const content = capContent(text.trim(), maxChars);
  return {
    fileType: "pdf",
    text: content,
    pageCount,
    pageOffsets: locatePageOffsets(content, pages),
    ...(normalizeExtractedText(content) ? {} : { note: "The PDF has no text layer; a scan needs OCR." }),
    reader: SERVER_READER_VERSION,
  };
}

async function readMsg(bytes: Uint8Array): Promise<string> {
  const { default: MsgReader } = await import("@kenjiuno/msgreader");
  const reader = new MsgReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const data = reader.getFileData() as {
    subject?: string;
    senderName?: string;
    senderEmail?: string;
    recipients?: { name?: string; email?: string }[];
    body?: string;
  };
  const to = (data.recipients ?? []).map((r) => fmtPerson(r.name, r.email)).filter(Boolean).join(", ");
  return emailToText({ subject: data.subject, from: fmtPerson(data.senderName, data.senderEmail), to, body: data.body });
}

async function readMbox(raw: string): Promise<string> {
  const chunks = splitMbox(raw);
  const parts: string[] = [];
  for (const chunk of chunks.slice(0, MAX_MBOX_MESSAGES)) {
    try {
      const text = await emlToText(chunk);
      if (text) parts.push(text);
    } catch {
      // A message that will not parse is skipped, as in the browser.
    }
  }
  let content = parts.join("\n\n———\n\n");
  if (chunks.length > MAX_MBOX_MESSAGES) content += mboxOverflowMarker(chunks.length - MAX_MBOX_MESSAGES);
  return content;
}

/**
 * The text of one stored file, read on the server. Never throws for a file
 * it cannot read: the reading comes back empty with a note (a damaged file,
 * a picture, an unsupported type), so callers store what they have.
 */
export async function readFileOnServer(
  bytes: Uint8Array,
  fileName: string,
  /** `word: "plain"` keeps mammoth's plain text (the OneDrive import, whose text feeds the Brain). */
  options: { pdfTimeoutMs?: number; maxChars?: number; word?: "markdown" | "plain" } = {}
): Promise<ServerReading> {
  const ext = getFileExtension(fileName);
  // The browser's cap unless the caller keeps more (the OneDrive import).
  const cap = (text: string) => capContent(text, options.maxChars ?? MAX_CONTENT_CHARS);
  const reading = (fileType: ServerFileType, text: string, note?: string): ServerReading => ({
    fileType,
    text,
    ...(note ? { note } : {}),
    reader: SERVER_READER_VERSION,
  });
  try {
    switch (ext) {
      case "txt":
      case "vtt":
        return reading("txt", cap(utf8(bytes)));
      case "md":
      case "markdown":
        return reading("md", cap(utf8(bytes)));
      case "docx": {
        if (options.word === "plain") {
          const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
          return reading("docx", cap(result.value.trim()));
        }
        // Owner, 2026-10-26: Word files as Markdown, the same as the browser.
        const markdown = await wordToMarkdown(mammoth, { buffer: Buffer.from(bytes) });
        return { ...reading("docx", cap(markdown.trim())), textFormat: "markdown" };
      }
      case "pdf":
        return await readPdf(bytes, options.pdfTimeoutMs ?? SERVER_PDF_TIMEOUT_MS, options.maxChars ?? MAX_CONTENT_CHARS);
      case "xlsx":
      case "xls":
        return reading("xlsx", spreadsheetText(bytes));
      case "csv":
        return reading("xlsx", cap(utf8(bytes)));
      case "msg":
        return reading("msg", cap(await readMsg(bytes)));
      case "eml":
        return reading("eml", cap(await emlToText(utf8(bytes))));
      case "mbox":
        return reading("eml", cap(await readMbox(utf8(bytes))));
      case "doc":
        return reading("other", "", "A legacy .doc file; save it as .docx to read its text.");
      default:
        if (isImageFile(fileName)) return reading("image", "", "A picture holds no text until OCR reads it.");
        return reading("other", "", `Files of type .${ext || "unknown"} are not read.`);
    }
  } catch (error) {
    console.warn("A stored file could not be read on the server", safeErrorDetails(error));
    return {
      ...reading(ext === "pdf" ? "pdf" : "other", "", "The file could not be read; it may be damaged or protected."),
      failed: true,
    };
  }
}
