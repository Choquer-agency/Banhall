/**
 * The preview's readers for a company file's original (2026-11-04): PDF
 * pages drawn with pdf.js, Word files as HTML (mammoth) with everything but
 * plain formatting taken out, a spreadsheet's first sheet as a table
 * (SheetJS), and emails (.msg, .eml) as sender, recipients, date, subject
 * and body. Each library loads only when a file of its kind is shown.
 */
import { fmtPerson, htmlToText } from "../../../../../shared/emailText";

export type PreviewKind = "pdf" | "word" | "sheet" | "email" | "image" | "text";

/** How the preview shows a file's original, from its name and type. */
export function previewKind(file: { fileName: string; fileType: string; mimeType: string | null }): PreviewKind {
  const name = file.fileName.toLowerCase();
  if (file.fileType === "pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.fileType === "docx" || name.endsWith(".docx")) return "word";
  if (file.fileType === "xlsx" || name.endsWith(".xlsx") || name.endsWith(".xls")) return "sheet";
  if (file.fileType === "msg" || file.fileType === "eml" || name.endsWith(".msg") || name.endsWith(".eml")) return "email";
  if (file.fileType === "image" || file.mimeType?.startsWith("image/")) return "image";
  return "text";
}

// ─── PDF ────────────────────────────────────────────────────────────────────

/** Pages drawn per PDF; the rest are counted. */
export const PDF_PREVIEW_PAGES = 30;

/**
 * Draws a PDF's pages into `container`, each as wide as the container, and
 * returns how many pages it has. The worker is pdf.js's own build, bundled
 * by Vite, so it always matches the library and needs no copy in static/.
 */
export async function renderPdfPages(
  data: ArrayBuffer,
  container: HTMLElement,
  isCurrent: () => boolean = () => true
): Promise<{ pageCount: number; drawn: number }> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  try {
    const width = container.clientWidth || 540;
    const ratio = window.devicePixelRatio || 1;
    const drawn = Math.min(pdf.numPages, PDF_PREVIEW_PAGES);
    for (let number = 1; number <= drawn; number++) {
      if (!isCurrent()) break;
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = "100%";
      canvas.style.display = "block";
      canvas.setAttribute("data-pdf-page", String(number));
      canvas.setAttribute("aria-label", `Page ${number}`);
      canvas.setAttribute("role", "img");
      const context = canvas.getContext("2d");
      if (!context) break;
      await page.render({ canvasContext: context, viewport }).promise;
      container.append(canvas);
    }
    return { pageCount: pdf.numPages, drawn };
  } finally {
    void pdf.destroy();
  }
}

// ─── Word ───────────────────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S", "SUB", "SUP",
  "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "BR", "A", "BLOCKQUOTE", "PRE", "CODE",
]);
/** Dropped with everything inside them. */
const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE", "NOSCRIPT", "IMG", "LINK", "META", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);
const SAFE_HREF = /^(https?:|mailto:)/i;

/**
 * Keeps only plain formatting: headings, paragraphs, emphasis, lists,
 * tables and links to web or mail addresses. Every other attribute, every
 * image and every script, style or embedded object is taken out; unknown
 * tags keep their text.
 */
export function sanitizeWordHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (DROPPED_TAGS.has(child.tagName)) {
        child.remove();
        continue;
      }
      clean(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attribute of Array.from(child.attributes)) {
        const name = attribute.name.toLowerCase();
        const keep =
          (child.tagName === "A" && name === "href" && SAFE_HREF.test(attribute.value.trim())) ||
          ((child.tagName === "TD" || child.tagName === "TH") && (name === "colspan" || name === "rowspan") && /^\d{1,3}$/.test(attribute.value));
        if (!keep) child.removeAttribute(attribute.name);
      }
      if (child.tagName === "A" && child.hasAttribute("href")) {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

/** A Word file as safe HTML. Images are never read. */
export async function wordToSafeHtml(data: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml(
    { arrayBuffer: data } as Parameters<typeof mammoth.convertToHtml>[0],
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) }
  );
  return sanitizeWordHtml(result.value);
}

// ─── Spreadsheets ───────────────────────────────────────────────────────────

export const SHEET_PREVIEW_ROWS = 200;
export const SHEET_PREVIEW_COLUMNS = 26;
/** Larger workbooks show the text the AI reads instead (parsing blocks the page). */
export const SHEET_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

export type SheetPreview = { sheetName: string; rows: string[][]; moreRows: boolean; moreColumns: boolean };

/** The first sheet's first rows and columns, as text cells. */
export async function firstSheetTable(data: ArrayBuffer): Promise<SheetPreview> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array", sheetRows: SHEET_PREVIEW_ROWS + 1, cellDates: true });
  const sheetName = workbook.SheetNames[0] ?? "";
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) return { sheetName, rows: [], moreRows: false, moreColumns: false };
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  const rows = raw.slice(0, SHEET_PREVIEW_ROWS).map((row) =>
    (Array.isArray(row) ? row : []).slice(0, SHEET_PREVIEW_COLUMNS).map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
  );
  const width = Math.max(0, ...rows.map((row) => row.length));
  return {
    sheetName,
    rows: rows.map((row) => [...row, ...Array<string>(width - row.length).fill("")]),
    moreRows: raw.length > SHEET_PREVIEW_ROWS,
    moreColumns: raw.some((row) => Array.isArray(row) && row.length > SHEET_PREVIEW_COLUMNS),
  };
}

// ─── Email ──────────────────────────────────────────────────────────────────

export type EmailPreview = { subject: string; from: string; to: string; date: string; body: string };

function dateLabel(value: string | Date | undefined | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return date.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** An Outlook .msg or an .eml file's headers and plain body. */
export async function readEmail(data: ArrayBuffer, fileName: string): Promise<EmailPreview> {
  if (fileName.toLowerCase().endsWith(".msg")) {
    const { default: MsgReader } = await import("@kenjiuno/msgreader");
    const message = new MsgReader(data).getFileData() as {
      subject?: string;
      senderName?: string;
      senderEmail?: string;
      recipients?: { name?: string; email?: string }[];
      body?: string;
      messageDeliveryTime?: string;
      clientSubmitTime?: string;
      creationTime?: string;
    };
    return {
      subject: message.subject ?? "",
      from: fmtPerson(message.senderName, message.senderEmail),
      to: (message.recipients ?? []).map((person) => fmtPerson(person.name, person.email)).filter(Boolean).join(", "),
      date: dateLabel(message.messageDeliveryTime ?? message.clientSubmitTime ?? message.creationTime),
      body: (message.body ?? "").replace(/\r\n/g, "\n").trim(),
    };
  }
  const { default: PostalMime } = await import("postal-mime");
  const email = await PostalMime.parse(data);
  return {
    subject: email.subject ?? "",
    from: fmtPerson(email.from?.name, email.from?.address),
    to: (email.to ?? []).map((person) => fmtPerson(person.name, person.address)).filter(Boolean).join(", "),
    date: dateLabel(email.date),
    body: (email.text && email.text.trim() ? email.text : email.html ? htmlToText(email.html) : "").replace(/\r\n/g, "\n").trim(),
  };
}
