import { CAP_TRUNCATION_MARKER, normalizeExtractedText } from "../../shared/documentStatus";

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
