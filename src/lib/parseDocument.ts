"use client";

export type ParsedFileType =
  | "txt"
  | "md"
  | "pdf"
  | "docx"
  | "msg"
  | "eml"
  | "other";

export interface ParsedDocument {
  fileName: string;
  fileType: ParsedFileType;
  content: string;
}

/**
 * BNH-33: the single source of truth for which file extensions we can actually
 * parse. Anything outside this list is flagged in the UI before generation so a
 * writer never hits a silent failure mid-generate (e.g. .msg used to error).
 * Email exports: .msg (Outlook), .eml (RFC822 — Apple Mail / Thunderbird / Gmail
 * "show original" / Outlook "save as"), .mbox (Gmail / Thunderbird bulk export).
 */
export const SUPPORTED_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "pdf",
  "docx",
  "msg",
  "eml",
  "mbox",
] as const;

/** Human-friendly list for `accept` attributes and warning copy. */
export const SUPPORTED_ACCEPT = ".txt,.md,.markdown,.pdf,.docx,.msg,.eml,.mbox";

/** For warning copy — keep in sync with SUPPORTED_EXTENSIONS. */
export const SUPPORTED_LABEL = "PDF, Word (.docx), email (.eml/.msg/.mbox), .txt, .md";

export function getFileExtension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function isSupportedFile(name: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(
    getFileExtension(name)
  );
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
    return { fileName: name, fileType: "txt", content: await file.text() };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return { fileName: name, fileType: "md", content: await file.text() };
  }

  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { fileName: name, fileType: "docx", content: result.value.trim() };
  }

  if (lower.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    // Same-origin worker (copied into /public) — reliable, no CDN/CORS.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({
      data: arrayBuffer,
      useSystemFonts: true,
    }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      text += strings + "\n\n";
    }
    return { fileName: name, fileType: "pdf", content: text.trim() };
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
    return { fileName: name, fileType: "eml", content };
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
      content += `\n\n[${chunks.length - MAX} more message(s) in this mailbox were not included]`;
    }
    return { fileName: name, fileType: "eml", content };
  }

  // Fallback — try to read as text.
  try {
    return { fileName: name, fileType: "other", content: await file.text() };
  } catch {
    return { fileName: name, fileType: "other", content: "" };
  }
}
