"use client";

import {
  CAP_TRUNCATION_MARKER,
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
}

/**
 * Hard ceiling on extracted text per document. Convex documents max out at
 * 1 MiB; CAD-exported drawing PDFs can emit megabytes of coordinate-label
 * junk that would make uploadDocument throw. ~400k chars stays safely under
 * the limit and is far more text than any real supporting doc carries.
 */
const MAX_CONTENT_CHARS = 400_000;

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
  if (ms <= 0) return Promise.reject(new ParseTimeout());
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new ParseTimeout()), ms);
    }),
  ]);
}

export function capContent(content: string): string {
  // Every ingestion path (all parsers, wizard paste, Home transcript handoff)
  // flows through here, so whitespace normalization lives with the cap:
  // Word-exported forms carry page-layout newline runs that read as noise
  // once flattened to text.
  const normalized = normalizeExtractedText(content);
  if (normalized.length <= MAX_CONTENT_CHARS) return normalized;
  return normalized.slice(0, MAX_CONTENT_CHARS) + CAP_TRUNCATION_MARKER;
}

// ─── Email helpers (shared by .msg, .eml, .mbox) ────────────────────────────

function fmtPerson(name?: string, email?: string): string {
  const n = (name ?? "").trim();
  const e = (email ?? "").trim();
  if (n && e && e.toLowerCase() !== n.toLowerCase()) return `${n} <${e}>`;
  return n || e;
}

/** Flatten an email into readable text: headers (Subject/From/To/Date) + body. */
function emailToText(e: {
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  body?: string;
}): string {
  const header: string[] = [];
  if (e.subject) header.push(`Subject: ${e.subject}`);
  if (e.from) header.push(`From: ${e.from}`);
  if (e.to) header.push(`To: ${e.to}`);
  if (e.date) header.push(`Date: ${e.date}`);
  const body = (e.body ?? "").replace(/\r\n/g, "\n").trim();
  return [header.join("\n"), body].filter(Boolean).join("\n\n").trim();
}

/** Best-effort HTML → text for emails that only carry an HTML body. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parse one raw RFC822 message (.eml content / mbox chunk) into readable text. */
async function emlToText(raw: string): Promise<string> {
  const { default: PostalMime } = await import("postal-mime");
  const email = await PostalMime.parse(raw);
  const to = (email.to ?? [])
    .map((r) => fmtPerson(r.name, r.address))
    .filter(Boolean)
    .join(", ");
  const body =
    email.text && email.text.trim()
      ? email.text
      : email.html
        ? htmlToText(email.html)
        : "";
  return emailToText({
    subject: email.subject,
    from: fmtPerson(email.from?.name, email.from?.address),
    to,
    date: email.date ? new Date(email.date).toLocaleString() : undefined,
    body,
  });
}

/**
 * Extract plain text from an uploaded file entirely in the browser.
 * Supports .txt / .md (read directly), .docx (mammoth), and .pdf (pdf.js).
 * Anything else is read as text on a best-effort basis.
 */
export async function parseFileToText(file: File): Promise<ParsedDocument> {
  const name = file.name;
  const lower = name.toLowerCase();

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
    });
    let text = "";
    let truncatedAtPage = 0;
    try {
      const pdf = await withDeadline(loadingTask.promise, deadline);
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await withDeadline(pdf.getPage(i), deadline);
          const content = await withDeadline(page.getTextContent(), deadline);
          const strings = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
          text += strings + "\n\n";
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
    return { fileName: name, fileType: "pdf", content: capContent(text.trim()) };
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    // Spreadsheets flatten to CSV per sheet — keeps rows/columns readable for
    // the model without carrying formatting. Client cost/data workbooks are
    // the common case (e.g. hours breakdowns when there's no interview).
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const csv = XLSX.utils
        .sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false })
        .trim();
      if (!csv) continue;
      parts.push(`## Sheet: ${sheetName}\n${csv}`);
      if (parts.join("\n\n").length > MAX_CONTENT_CHARS) break;
    }
    return {
      fileName: name,
      fileType: "xlsx",
      content: capContent(parts.join("\n\n")),
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
    const chunks = raw
      .split(/^From .*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    const MAX = 50;
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
