"use client";

import {
  mboxOverflowMarker,
  pdfPageStopMarker,
} from "../../shared/documentStatus";

/**
 * The pure registry (whitelist, extension helpers) and the truncation markers
 * moved to `shared/documentStatus.ts` so Convex can derive processing status
 * without importing this file — its pdfjs/xlsx/mammoth dynamic imports are
 * browser-only. Re-exported here so existing importers are unaffected, and so
 * the marker text a parser writes and the detector that reads it can't drift.
 */
export {
  SUPPORTED_EXTENSIONS,
  IMAGE_EXTENSIONS,
  SUPPORTED_ACCEPT,
  SUPPORTED_LABEL,
  getFileExtension,
  isSupportedFile,
  isImageFile,
  normalizeExtractedText,
} from "../../shared/documentStatus";
import { isImageFile, normalizeExtractedText } from "../../shared/documentStatus";

export type ParsedFileType =
  | "txt"
  | "md"
  | "pdf"
  | "docx"
  | "msg"
  | "eml"
  | "xlsx"
  | "image"
  | "other";

export interface ParsedDocument {
  fileName: string;
  fileType: ParsedFileType;
  content: string;
  /** PDFs only: the document's page count. */
  pageCount?: number;
  /** PDFs only: where each page read starts in `content` (character offset). */
  pageOffsets?: number[];
}

/** Reading progress for New project's supporting-document cards (E1): PDFs
 * report pages read over total; spreadsheets pass their worker phases
 * through; everything else is indeterminate. Only "pages" is measurable. */
export type ParseProgress =
  | { kind: "pages"; done: number; total: number }
  | { kind: "indeterminate" }
  | SpreadsheetProgress;

export interface ParseOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ParseProgress) => void;
}

import { capContent, MAX_CONTENT_CHARS } from "./documentContent";
import { parseSpreadsheet } from "./spreadsheetClient";
import type { SpreadsheetProgress } from "./spreadsheetProtocol";
import { locatePageOffsets } from "../../shared/documentContent";
import { emailToText, emlToText, fmtPerson, MAX_MBOX_MESSAGES, splitMbox } from "../../shared/emailText";
export { capContent } from "./documentContent";
export { locatePageOffsets } from "../../shared/documentContent";

function parseAborted(): DOMException {
  return new DOMException("Document extraction canceled", "AbortError");
}

/** Whole-file budget for PDF text extraction — engineering-drawing PDFs
 * (huge vector pages) can stall pdf.js indefinitely; partial text beats a
 * hung upload that leaves the wizard spinning forever. */
const PDF_PARSE_TIMEOUT_MS = 60_000;

class ParseTimeout extends Error {
  constructor() {
    super("parse timeout");
  }
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const ms = deadline - Date.now();
  if (ms <= 0) {
    // Work already started before this call; observe late rejection without
    // waiting for it after the shared deadline has expired.
    void promise.catch(() => {});
    return Promise.reject(new ParseTimeout());
  }
  // Release the timer as soon as the race settles: the deadline is shared by
  // the document load and every page, so without this a successful N-page
  // parse leaves 2N+1 callbacks alive for the rest of the minute.
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ParseTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Email helpers (shared by .msg, .eml, .mbox) live in shared/emailText.ts
// since 2026-10-26, so the server reads emails the same way.

/**
 * Extract plain text from an uploaded file entirely in the browser.
 * Supports .txt / .md (read directly), .docx (mammoth), and .pdf (pdf.js).
 * Anything else is read as text on a best-effort basis.
 */
export async function parseFileToText(file: File, options: ParseOptions = {}): Promise<ParsedDocument> {
  const name = file.name;
  const lower = name.toLowerCase();
  const { signal, onProgress } = options;
  if (signal?.aborted) throw parseAborted();
  if (!lower.endsWith(".pdf")) onProgress?.({ kind: "indeterminate" });

  if (lower.endsWith(".txt")) {
    return { fileName: name, fileType: "txt", content: capContent(await file.text()) };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return { fileName: name, fileType: "md", content: capContent(await file.text()) };
  }

  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { fileName: name, fileType: "docx", content: capContent(result.value.trim()) };
  }

  if (lower.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    // Same-origin worker (copied into /public) — reliable, no CDN/CORS.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const arrayBuffer = await file.arrayBuffer();
    const deadline = Date.now() + PDF_PARSE_TIMEOUT_MS;
    const loadingTask = pdfjs.getDocument({
      data: arrayBuffer,
      useSystemFonts: true,
      // The Content Security Policy has no 'unsafe-eval'; text extraction
      // never needs it, so pdf.js should not try.
      isEvalSupported: false,
    });
    let text = "";
    let truncatedAtPage = 0;
    let pageCount = 0;
    const pages: string[] = [];
    try {
      const pdf = await withDeadline(loadingTask.promise, deadline);
      pageCount = pdf.numPages;
      onProgress?.({ kind: "pages", done: 0, total: pageCount });
      for (let i = 1; i <= pdf.numPages; i++) {
        if (signal?.aborted) throw parseAborted();
        try {
          const page = await withDeadline(pdf.getPage(i), deadline);
          const content = await withDeadline(page.getTextContent(), deadline);
          const strings = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
          text += strings + "\n\n";
          pages.push(strings);
          onProgress?.({ kind: "pages", done: i, total: pageCount });
        } catch (e) {
          if (!(e instanceof ParseTimeout)) throw e;
          truncatedAtPage = i;
          break;
        }
        if (text.length > MAX_CONTENT_CHARS) {
          truncatedAtPage = i + 1;
          break;
        }
      }
    } catch (e) {
      if (!(e instanceof ParseTimeout)) throw e;
      // Whole document timed out before any page was read.
    } finally {
      void loadingTask.destroy().catch(() => {});
    }
    if (truncatedAtPage > 0) {
      text += pdfPageStopMarker(truncatedAtPage);
    }
    const content = capContent(text.trim());
    return {
      fileName: name,
      fileType: "pdf",
      content,
      pageCount,
      pageOffsets: locatePageOffsets(content, pages),
    };
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return {
      fileName: name,
      fileType: "xlsx",
      content: await parseSpreadsheet(file, { signal, onProgress }),
    };
  }

  if (lower.endsWith(".csv")) {
    return { fileName: name, fileType: "xlsx", content: capContent(await file.text()) };
  }

  if (isImageFile(name)) {
    // Reference-only: the original bytes are stored for preview/download, but
    // no text is extracted (drawings/photos). Generation ignores empty docs.
    return {
      fileName: name,
      fileType: "image",
      content: "",
    };
  }

  if (lower.endsWith(".msg")) {
    // Outlook .msg is an OLE compound (MAPI) file — parse it in-browser and
    // flatten the email into readable text (headers + body) for the report.
    const { default: MsgReader } = await import("@kenjiuno/msgreader");
    const arrayBuffer = await file.arrayBuffer();
    const reader = new MsgReader(arrayBuffer);
    const data = reader.getFileData() as {
      subject?: string;
      senderName?: string;
      senderEmail?: string;
      recipients?: { name?: string; email?: string }[];
      body?: string;
    };
    const to = (data.recipients ?? [])
      .map((r) => fmtPerson(r.name, r.email))
      .filter(Boolean)
      .join(", ");
    const content = emailToText({
      subject: data.subject,
      from: fmtPerson(data.senderName, data.senderEmail),
      to,
      body: data.body,
    });
    return { fileName: name, fileType: "msg", content };
  }

  if (lower.endsWith(".eml")) {
    // RFC822 / MIME email export (Apple Mail, Thunderbird, Gmail, Outlook).
    const content = await emlToText(await file.text());
    return { fileName: name, fileType: "eml", content: capContent(content) };
  }

  if (lower.endsWith(".mbox")) {
    // mbox = many emails, each starting with a "From " separator line.
    const raw = await file.text();
    const chunks = splitMbox(raw);
    const MAX = MAX_MBOX_MESSAGES;
    const parts: string[] = [];
    for (const chunk of chunks.slice(0, MAX)) {
      try {
        const t = await emlToText(chunk);
        if (t) parts.push(t);
      } catch {
        /* skip a message that won't parse */
      }
    }
    let content = parts.join("\n\n———\n\n");
    if (chunks.length > MAX) {
      content += mboxOverflowMarker(chunks.length - MAX);
    }
    return { fileName: name, fileType: "eml", content: capContent(content) };
  }

  // Fallback — try to read as text.
  try {
    return { fileName: name, fileType: "other", content: capContent(await file.text()) };
  } catch {
    return { fileName: name, fileType: "other", content: "" };
  }
}
