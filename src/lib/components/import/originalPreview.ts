/**
 * Helpers for the Import document preview panel (Paper Files 7 and Files 8):
 * file type labels, byte size formatting, folder display, and safe client-side
 * rendering of original .docx / .pdf / .xlsx / image files.
 */

export type PreviewFileKind = "docx" | "pdf" | "spreadsheet" | "image" | "text" | "other";

export type SpreadsheetSheetPreview = {
  name: string;
  rows: string[][];
  truncatedRows: boolean;
  truncatedCols: boolean;
};

const SPREADSHEET_MAX_SHEETS = 5;
const SPREADSHEET_MAX_ROWS = 100;
const SPREADSHEET_MAX_COLS = 20;

const ALLOWED_HTML_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const DROP_SUBTREE_TAGS = new Set(["script", "style", "iframe", "object", "embed", "form", "svg", "math", "template"]);

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

/** Formats a file's folder path cleanly without repeating the filename. */
export function formatFolderPath(path: string, fileName?: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length > 1 && (!fileName || parts[parts.length - 1] === fileName)) {
    return parts.slice(0, -1).join(" / ");
  }
  return parts.join(" / ");
}

function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

function safeImageSrc(value: string): string | null {
  const trimmed = value.trim();
  // Mammoth embeds Word images as base64 data:image/(png|jpeg|gif|webp) URIs.
  // Reject SVG data URIs to avoid embedded scripts.
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function copySafeChildren(source: ParentNode, target: Node, doc: Document): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_SUBTREE_TAGS.has(tag)) continue;
    if (!ALLOWED_HTML_TAGS.has(tag)) {
      copySafeChildren(el, target, doc);
      continue;
    }
    const clean = doc.createElement(tag);
    if (tag === "a") {
      const href = safeHref(el.getAttribute("href") ?? "");
      if (href) {
        clean.setAttribute("href", href);
        clean.setAttribute("target", "_blank");
        clean.setAttribute("rel", "noopener noreferrer");
      }
    } else if (tag === "img") {
      const src = safeImageSrc(el.getAttribute("src") ?? "");
      if (!src) continue;
      clean.setAttribute("src", src);
      const alt = el.getAttribute("alt");
      if (alt) clean.setAttribute("alt", alt);
    } else if (tag === "td" || tag === "th") {
      const colspan = Number.parseInt(el.getAttribute("colspan") ?? "", 10);
      const rowspan = Number.parseInt(el.getAttribute("rowspan") ?? "", 10);
      if (Number.isFinite(colspan) && colspan > 1 && colspan <= 20) clean.setAttribute("colspan", String(colspan));
      if (Number.isFinite(rowspan) && rowspan > 1 && rowspan <= 50) clean.setAttribute("rowspan", String(rowspan));
    }
    copySafeChildren(el, clean, doc);
    target.appendChild(clean);
  }
}

/**
 * Strips scripts, styles, event handlers, and unsafe URLs from HTML returned
 * by Mammoth so original .docx previews render safely inside the sheet.
 */
export function sanitizeDocumentHtml(rawHtml: string): string {
  if (!rawHtml.trim()) return "";
  if (typeof DOMParser === "undefined") {
    return rawHtml.replace(/<[^>]+>/g, "");
  }
  const parser = new DOMParser();
  const parsed = parser.parseFromString(rawHtml, "text/html");
  const outDoc = parsed.implementation.createHTMLDocument("");
  const container = outDoc.createElement("div");
  copySafeChildren(parsed.body, container, outDoc);
  return container.innerHTML;
}

/** Lazy-loads Mammoth to convert a .docx ArrayBuffer into sanitized HTML. */
export async function renderDocxPreview(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const convert = mammoth.convertToHtml ?? mammoth.default?.convertToHtml;
  if (!convert) throw new Error("Word preview is not available.");
  const result = await convert({ arrayBuffer: buffer });
  return sanitizeDocumentHtml(result.value ?? "");
}

/** Lazy-loads SheetJS to turn an .xlsx / .xls / .csv buffer into bounded table previews. */
export async function renderSpreadsheetPreview(buffer: ArrayBuffer): Promise<SpreadsheetSheetPreview[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const names = workbook.SheetNames.slice(0, SPREADSHEET_MAX_SHEETS);
  return names.map((name) => {
    const sheet = workbook.Sheets[name];
    const matrix = sheet
      ? (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][])
      : [];
    const truncatedRows = matrix.length > SPREADSHEET_MAX_ROWS;
    let truncatedCols = false;
    const rows = matrix.slice(0, SPREADSHEET_MAX_ROWS).map((row) => {
      const cells = Array.isArray(row) ? row : [];
      if (cells.length > SPREADSHEET_MAX_COLS) truncatedCols = true;
      return cells.slice(0, SPREADSHEET_MAX_COLS).map((cell) => (cell === null || cell === undefined ? "" : String(cell)));
    });
    return { name, rows, truncatedRows, truncatedCols };
  });
}
