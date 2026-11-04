/**
 * Emails as readable text (headers, then the body), shared by the browser's
 * reader and the server's (2026-10-26) for .msg, .eml and .mbox files.
 */

export function fmtPerson(name?: string, email?: string): string {
  const n = (name ?? "").trim();
  const e = (email ?? "").trim();
  if (n && e && e.toLowerCase() !== n.toLowerCase()) return `${n} <${e}>`;
  return n || e;
}

/** Flatten an email into readable text: headers (Subject/From/To/Date) + body. */
export function emailToText(e: {
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

/** Best-effort HTML to text for emails that only carry an HTML body. */
export function htmlToText(html: string): string {
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
export async function emlToText(raw: string): Promise<string> {
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

/** Most messages an mbox file is read for; the rest are counted, not read. */
export const MAX_MBOX_MESSAGES = 50;

/** The messages of an mbox file, each starting at a "From " separator line. */
export function splitMbox(raw: string): string[] {
  return raw
    .split(/^From .*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}
