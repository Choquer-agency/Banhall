/**
 * Search pieces of a file's text (2026-10-26, context pipeline plan Phase
 * B4): consecutive ranges that cover the text exactly once, each about 600
 * tokens, cut where the document's own parts start (a PDF page, a sheet, an
 * email message, a Word heading) or else at the weakest break near the
 * target size. Offsets are UTF-16 units into the stored text, as citations
 * use; a piece never splits a surrogate pair, and the text is never changed.
 * Structure markers count only in the kind of file that writes them, so a
 * text file cannot imitate a sheet or a mailbox.
 */

import { quotableFileText, quotableWordText } from "./wordMarkdown";

/** What kind of text this is, which decides the markers that count. */
export type PieceTextKind = "pdf" | "spreadsheet" | "email" | "markdown" | "text";

export type SearchPieceInput = {
  kind: PieceTextKind;
  /** PDF page starts, one per page in order, already checked against this text. */
  pageStarts?: readonly number[];
};

export type SearchPiece = {
  start: number;
  end: number;
  /** The pages the piece covers (1-based), when page starts are known. */
  page?: number;
  pageEnd?: number;
  /** The part the piece sits under: a sheet, an email message, a heading. */
  label?: string;
  /** A spreadsheet piece's header row (the first row of its sheet), searched with it. */
  header?: string;
};

/** Bumped with any change to how pieces are cut or labelled. */
export const SEARCH_PIECES_VERSION = 1;

export const SEARCH_PIECE_TARGET_CHARS = 2_400;
export const SEARCH_PIECE_MAX_CHARS = 3_600;
export const SEARCH_PIECE_MIN_CHARS = 800;
/** At most this many pieces per file; past it, small parts are joined. */
export const MAX_SEARCH_PIECES = 1_000;
const LABEL_CHARS = 120;

const SHEET_LINE = /^## Sheet: (.+)$/gm;
/** The separator the email readers put between messages (shared/emailText.ts), quoted as data. */
const MESSAGE_SEPARATOR = "\n\n———\n\n";
const HEADING_LINE = /^(#{1,6}) +(.+?) *#*$/gm;

type Boundary = { at: number; label?: string; header?: string };

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** `at`, moved back one unit if it would split a surrogate pair. */
function safeCut(text: string, at: number): number {
  if (at <= 0 || at >= text.length) return Math.max(0, Math.min(at, text.length));
  return isHigh(text.charCodeAt(at - 1)) ? at - 1 : at;
}

/** At most `max` UTF-16 units of `text`, never ending inside a surrogate pair. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return isHigh(text.charCodeAt(max - 1)) ? text.slice(0, max - 1) : text.slice(0, max);
}

const clip = (label: string) => clipText(label.replace(/\s+/g, " ").trim(), LABEL_CHARS);

/** A Word heading's label without its marks and escapes. */
const plainHeading = (text: string) => quotableWordText(text);

function emailLabel(text: string, at: number, message: number): string {
  const subject = /^Subject: (.+)$/m.exec(text.slice(at, at + 400))?.[1];
  return subject ? `Message ${message}: ${clip(subject)}` : `Message ${message}`;
}

/** Where the document's parts start, for its kind of text. */
function boundaries(text: string, input: SearchPieceInput): Boundary[] {
  const found: Boundary[] = [];
  if (input.kind === "spreadsheet") {
    for (const match of text.matchAll(SHEET_LINE)) {
      const headerStart = match.index + match[0].length + 1;
      const headerEnd = text.indexOf("\n", headerStart);
      const header = text.slice(headerStart, headerEnd < 0 ? text.length : headerEnd).trim();
      found.push({ at: match.index, label: `Sheet: ${clip(match[1]!)}`, ...(header ? { header: clipText(header, 400) } : {}) });
    }
  }
  if (input.kind === "email" && text.includes(MESSAGE_SEPARATOR)) {
    let message = 1;
    found.push({ at: 0, label: emailLabel(text, 0, message) });
    for (let from = 0; ; ) {
      const at = text.indexOf(MESSAGE_SEPARATOR, from);
      if (at < 0) break;
      const next = at + MESSAGE_SEPARATOR.length;
      message += 1;
      found.push({ at: next, label: emailLabel(text, next, message) });
      from = next;
    }
  }
  if (input.kind === "markdown") {
    for (const match of text.matchAll(HEADING_LINE)) {
      const label = clip(plainHeading(match[2]!));
      if (label) found.push({ at: match.index, label });
    }
  }
  if (input.kind === "pdf") {
    for (const start of input.pageStarts ?? []) if (start > 0 && start < text.length) found.push({ at: start });
  }
  found.sort((a, b) => a.at - b.at);
  const merged: Boundary[] = [];
  for (const boundary of found) {
    const at = safeCut(text, boundary.at);
    const last = merged[merged.length - 1];
    if (last && last.at === at) {
      if (!last.label && boundary.label) Object.assign(last, { label: boundary.label, header: boundary.header });
      continue;
    }
    merged.push({ ...boundary, at });
  }
  return merged;
}

/** The best place to end a piece that starts at `from`, at or before `limit`. */
function breakBefore(text: string, from: number, limit: number, minChars: number, targetChars: number): number {
  const offset = Math.min(from + minChars, limit);
  const window = text.slice(offset, limit);
  const target = from + targetChars;
  for (const pattern of [/\r?\n[ \t]*\r?\n/g, /\r?\n/g, /[.!?]["')\]]?\s/g, /\s/g]) {
    let best = -1;
    let firstAfter = -1;
    for (const match of window.matchAll(pattern)) {
      const end = offset + match.index + match[0].length;
      if (end <= target) best = end;
      else {
        firstAfter = end;
        break;
      }
    }
    const chosen = best >= 0 ? best : firstAfter;
    if (chosen > from) {
      const cut = safeCut(text, chosen);
      if (cut > from) return cut;
    }
  }
  const cut = safeCut(text, limit);
  return cut > from ? cut : Math.min(text.length, limit + 1);
}

function cut(text: string, parts: readonly Boundary[], minChars: number): Array<{ start: number; end: number }> {
  const partEnds = [...parts.map((b) => b.at).filter((at) => at > 0), text.length];
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  let partIndex = 0;
  while (start < text.length) {
    while (partIndex < partEnds.length && partEnds[partIndex]! <= start) partIndex += 1;
    let partEnd = partEnds[partIndex] ?? text.length;
    // Join parts too small to stand alone, while the piece stays within the maximum.
    while (partEnd - start < minChars && partEnd < text.length) {
      const next = partEnds[partIndex + 1] ?? text.length;
      if (next - start > SEARCH_PIECE_MAX_CHARS) break;
      partIndex += 1;
      partEnd = next;
    }
    let end =
      partEnd - start <= SEARCH_PIECE_MAX_CHARS
        ? partEnd
        : breakBefore(text, start, Math.min(text.length, start + SEARCH_PIECE_MAX_CHARS), minChars, SEARCH_PIECE_TARGET_CHARS);
    // A tail shorter than the minimum joins this piece when it fits.
    if (text.length - end < minChars && text.length - start <= SEARCH_PIECE_MAX_CHARS) end = text.length;
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

/**
 * The pieces of `text`, in order. Each part's start begins a new piece
 * unless the piece before it would be shorter than the minimum, in which
 * case small parts join; long parts are cut near the target size. Past
 * MAX_SEARCH_PIECES the minimum grows until the file fits.
 */
export function splitSearchPieces(text: string, input: SearchPieceInput = { kind: "text" }): SearchPiece[] {
  if (text.length === 0) return [];
  const parts = boundaries(text, input);
  let minChars = SEARCH_PIECE_MIN_CHARS;
  let ranges = cut(text, parts, minChars);
  while (ranges.length > MAX_SEARCH_PIECES && minChars < SEARCH_PIECE_MAX_CHARS) {
    minChars = Math.min(SEARCH_PIECE_MAX_CHARS, minChars * 2);
    ranges = cut(text, parts, minChars);
  }
  const pageStarts = input.kind === "pdf" ? (input.pageStarts ?? []) : [];
  const pageAt = (offset: number): number => {
    let page = 1;
    for (let i = 0; i < pageStarts.length && pageStarts[i]! <= offset; i++) page = i + 1;
    return page;
  };
  return ranges.map(({ start, end }) => {
    let part: Boundary | undefined;
    for (const boundary of parts) {
      if (boundary.at > start) break;
      if (boundary.label) part = boundary;
    }
    return {
      start,
      end,
      ...(pageStarts.length ? { page: pageAt(start), pageEnd: pageAt(Math.max(start, end - 1)) } : {}),
      ...(part?.label ? { label: part.label } : {}),
      ...(part?.header ? { header: part.header } : {}),
    };
  });
}

/**
 * What a piece is searched by: its label, its sheet's header row, then its
 * text as the AI reads it (Word Markdown without its marks).
 * `searchText.slice(prefixChars)` is that text.
 */
export function searchTextOf(
  text: string,
  piece: SearchPiece,
  textFormat?: "markdown"
): { searchText: string; prefixChars: number } {
  const prefix = [piece.label, piece.header].filter(Boolean).map((line) => `${line}\n`).join("");
  return { searchText: prefix + quotableFileText(text.slice(piece.start, piece.end), textFormat), prefixChars: prefix.length };
}

/**
 * Page starts checked against the text they describe: whole numbers, in
 * order, inside the text, not between a surrogate pair, at most 2,000.
 * Anything else makes the whole list unusable (the caller splits by
 * paragraph instead).
 */
export function checkedPageStarts(text: string, pageStarts: unknown): number[] | null {
  if (!Array.isArray(pageStarts) || pageStarts.length === 0 || pageStarts.length > 2_000) return null;
  let previous = -1;
  for (const start of pageStarts) {
    if (!Number.isInteger(start) || start < previous || start < 0 || start > text.length) return null;
    if (start > 0 && start < text.length && isHigh(text.charCodeAt(start - 1))) return null;
    previous = start;
  }
  return pageStarts as number[];
}
