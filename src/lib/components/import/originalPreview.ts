/**
 * Helpers for the Import document preview panel (Paper Files 7 and Files 8):
 * file type labels, byte size formatting, and thin delegation to the shared
 * company-file preview renderers (`companies/files/previewRenderers.ts`) so
 * Import and Company files share one sanitizer, one pdf.js renderer, one
 * bounded spreadsheet reader, and one email reader.
 */
import {
  firstSheetTable,
  readEmail,
  renderPdfPages,
  SHEET_PREVIEW_MAX_BYTES,
  wordToSafeHtml,
  type EmailPreview,
  type SheetPreview,
} from "$lib/components/companies/files/previewRenderers";

export type { EmailPreview, SheetPreview };
export { renderPdfPages, SHEET_PREVIEW_MAX_BYTES };

export type PreviewFileKind = "docx" | "pdf" | "spreadsheet" | "email" | "image" | "text" | "other";

function extensionOf(fileName: string): string {
  const clean = fileName.trim().toLowerCase();
  const dot = clean.lastIndexOf(".");
  if (dot <= 0 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1);
}

/** Classifies how the Original tab should render a file. */
export function detectFileKind(fileName: string): PreviewFileKind {
  switch (extensionOf(fileName)) {
    case "docx":
      return "docx";
    case "pdf":
      return "pdf";
    case "xlsx":
    case "xls":
    case "csv":
      return "spreadsheet";
    case "msg":
    case "eml":
      return "email";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "image";
    case "txt":
    case "md":
      return "text";
    default:
      return "other";
  }
}

/** Human-readable file type shown next to size ("212 KB, Word file"). */
export function fileTypeLabel(fileName: string): string {
  const ext = extensionOf(fileName);
  switch (ext) {
    case "docx":
    case "doc":
      return "Word file";
    case "pdf":
      return "PDF";
    case "xlsx":
    case "xls":
      return "Excel file";
    case "csv":
      return "CSV file";
    case "msg":
    case "eml":
      return "Email";
    case "pptx":
    case "ppt":
      return "PowerPoint file";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "Image";
    case "txt":
    case "md":
      return "Text file";
    case "rtf":
      return "Rich text file";
    default:
      return ext ? `${ext.toUpperCase()} file` : "File";
  }
}

/** Short toolbar caption shown beside the segmented switch on the Original view. */
export function originalCaption(fileName: string): string {
  switch (detectFileKind(fileName)) {
    case "docx":
      return "How the file looks in Word";
    case "pdf":
      return "Original PDF";
    case "spreadsheet":
      return "Original spreadsheet";
    case "email":
      return "Original email";
    case "image":
      return "Original image";
    case "text":
      return "Original text file";
    default:
      return "Original file";
  }
}

/** Compact byte size for the Details pane ("212 KB", "1.4 MB"). */
export function formatFileSize(bytes?: number | null): string | null {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** Converts a .docx buffer to safe HTML via the shared preview renderer. */
export async function renderDocxPreview(buffer: ArrayBuffer): Promise<string> {
  return wordToSafeHtml(buffer);
}

/** Reads the first sheet into a bounded table via the shared preview renderer. */
export async function renderSpreadsheetPreview(buffer: ArrayBuffer): Promise<SheetPreview> {
  return firstSheetTable(buffer);
}

/** Parses an .msg or .eml buffer via the shared preview renderer. */
export async function renderEmailPreview(buffer: ArrayBuffer, fileName: string): Promise<EmailPreview> {
  return readEmail(buffer, fileName);
}
