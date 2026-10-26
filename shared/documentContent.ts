import { CAP_TRUNCATION_MARKER, normalizeExtractedText } from "./documentStatus";

/**
 * How a file's extracted text is capped and laid out, shared by the
 * browser's reader (src/lib/parseDocument.ts) and the server's
 * (convex/ai/fileReader.ts) since 2026-10-26, so both produce the same text
 * from the same file.
 */

/** Keep extracted text safely below the Convex document limit. */
export const MAX_CONTENT_CHARS = 400_000;

export function capContent(content: string): string {
  // Every ingestion path (all parsers, wizard paste, Home transcript handoff)
  // flows through here, so whitespace normalization lives with the cap:
  // Word-exported forms carry page-layout newline runs that read as noise
  // once flattened to text.
  const normalized = normalizeExtractedText(content);
  if (normalized.length <= MAX_CONTENT_CHARS) return normalized;
  return normalized.slice(0, MAX_CONTENT_CHARS) + CAP_TRUNCATION_MARKER;
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
