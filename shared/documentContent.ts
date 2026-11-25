import { CAP_TRUNCATION_MARKER, normalizeExtractedText } from "./documentStatus";

/**
 * How a file's extracted text is capped and laid out, shared by the
 * browser's reader (src/lib/parseDocument.ts) and the server's
 * (convex/ai/fileReader.ts) since 2026-10-26, so both produce the same text
 * from the same file.
 */

/** Keep extracted text safely below the Convex document limit. */
export const MAX_CONTENT_CHARS = 400_000;

export function capContent(content: string, maxChars = MAX_CONTENT_CHARS): string {
  // Every ingestion path (all parsers, wizard paste, Home transcript handoff)
  // flows through here, so whitespace normalization lives with the cap:
  // Word-exported forms carry page-layout newline runs that read as noise
  // once flattened to text.
  const normalized = normalizeExtractedText(content);
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars) + CAP_TRUNCATION_MARKER;
}

/**
 * Where each page's text starts in the final (normalized, capped) content.
 * Normalization only trims line ends and collapses blank-line runs, so each
 * page's own normalized text is found in order; a page with no text starts
 * where the previous one ended.
 */
export function locatePageOffsets(content: string, pages: readonly string[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const page of pages) {
    const text = normalizeExtractedText(page);
    if (!text) {
      offsets.push(Math.min(cursor, content.length));
      continue;
    }
    const probe = text.slice(0, 40);
    const index = content.indexOf(probe, cursor);
    if (index < 0) {
      offsets.push(Math.min(cursor, content.length));
      continue;
    }
    offsets.push(index);
    cursor = index + text.length;
  }
  return offsets;
}

/**
 * Joins pdf.js page text items while preserving line boundaries indicated by
 * `hasEOL` or baseline Y-coordinate changes. Keeps single-line pages identical
 * to space-joining so existing page-offset and search behavior stays intact.
 */
export function joinPdfTextItems(
  items: readonly { str?: string; hasEOL?: boolean; transform?: readonly number[] }[]
): string {
  const lines: string[] = [];
  let current: string[] = [];
  let lastY: number | null = null;
  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    const y = Array.isArray(item.transform) && typeof item.transform[5] === "number" ? item.transform[5] : null;
    if (str && lastY !== null && y !== null && Math.abs(y - lastY) > 2 && current.length > 0) {
      lines.push(current.join(" ").trim());
      current = [];
    }
    if (str) {
      current.push(str);
      if (y !== null) lastY = y;
    }
    if (item.hasEOL) {
      if (current.length > 0) {
        lines.push(current.join(" ").trim());
        current = [];
      }
      lastY = null;
    }
  }
  if (current.length > 0) lines.push(current.join(" ").trim());
  return lines.filter(Boolean).join("\n");
}
