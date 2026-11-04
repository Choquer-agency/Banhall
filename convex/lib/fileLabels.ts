/**
 * File labels' constants and rules, shared by convex/fileLabels.ts and the
 * label call (convex/ai/fileLabels.ts). 2026-10-26, Phase B4.
 */
import type { Doc } from "../_generated/dataModel";

/** Bumped with any change to the label request; older labels are made again. */
export const FILE_LABELS_PROMPT_VERSION = "file-labels-2";

export const FILE_DOCUMENT_TYPES = [
  "technical report",
  "test or lab results",
  "proposal or plan",
  "meeting notes",
  "email",
  "timesheet or payroll",
  "financial",
  "invoice or contract",
  "presentation",
  "spreadsheet data",
  "prior SR&ED report",
  "other",
] as const;

export const MAX_LABEL_TITLE_CHARS = 120;
export const MAX_LABEL_SUMMARY_CHARS = 300;

/** A claim older than this was stopped; the sweep may claim the file again. */
export const LABEL_CLAIM_MS = 10 * 60_000;
/** Waits before the 2nd, 3rd and 4th try; after the 4th failure the file is left. */
export const LABEL_RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000] as const;
export const LABEL_SWEEP_FILES = 20;
export const LABEL_SWEEP_SPACING_MS = 2_000;
const OPENING_CHARS = 12_000;
const SAMPLE_CHARS = 2_000;

/** Whether a file's labels describe its current text, name and prompt. */
export function labelsCurrent(
  doc: Pick<Doc<"projectDocuments"> | Doc<"companyFiles">, "labels" | "fileName">,
  textHash: string
): boolean {
  return (
    doc.labels !== undefined &&
    doc.labels.textHash === textHash &&
    doc.labels.fileName === doc.fileName &&
    doc.labels.promptVersion === FILE_LABELS_PROMPT_VERSION
  );
}

/**
 * A slice of `text` near [from, to), widened to a line break (within 1,000
 * characters), else to a space, so no name is cut in half before the names
 * are hidden.
 */
function sampleAt(text: string, from: number, to: number): string {
  const widen = (at: number, step: -1 | 1, test: RegExp, limit: number): number => {
    let index = at;
    while (index > 0 && index < text.length && Math.abs(index - at) < limit && !test.test(text[step < 0 ? index - 1 : index]!)) {
      index += step;
    }
    return index;
  };
  let start = Math.max(0, from);
  let end = Math.min(text.length, to);
  const lineStart = widen(start, -1, /\n/, 1_000);
  start = lineStart === 0 || text[lineStart - 1] === "\n" ? lineStart : widen(start, -1, /\s/, 200);
  const lineEnd = widen(end, 1, /\n/, 1_000);
  end = lineEnd >= text.length || text[lineEnd] === "\n" ? lineEnd : widen(end, 1, /\s/, 200);
  return text.slice(start, end);
}

/** The opening of a text and samples from its middle and end, without repeats. */
export function labelSamples(text: string): { opening: string; middle?: string; end?: string } {
  if (text.length <= OPENING_CHARS + SAMPLE_CHARS) return { opening: text };
  const opening = sampleAt(text, 0, OPENING_CHARS);
  const midStart = Math.floor(text.length / 2 - SAMPLE_CHARS / 2);
  const middle = midStart > OPENING_CHARS ? sampleAt(text, midStart, midStart + SAMPLE_CHARS) : undefined;
  const endStart = text.length - SAMPLE_CHARS;
  const end = endStart > Math.max(OPENING_CHARS, midStart + SAMPLE_CHARS) ? sampleAt(text, endStart, text.length) : undefined;
  return { opening, ...(middle ? { middle } : {}), ...(end ? { end } : {}) };
}
