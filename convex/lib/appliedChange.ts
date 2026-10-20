/**
 * Chat parity Phase B (W3): Undo for an applied chat card.
 *
 * Reversing a card's find/replace pairs does not restore a report exactly:
 * matching is normalized and case-adjusted (`replaceAll`), and a match that
 * spans inline nodes rebuilds its block as one plain text node, losing its
 * marks. So an apply records what it changed instead: the runs of top-level
 * Tiptap blocks that differ between the stored document and the new one
 * (`computeAppliedHunks`). Undo finds each run's new text exactly once in the
 * current document and puts the old blocks back, all or nothing
 * (`undoAppliedHunks`).
 *
 * Blocks are compared in a canonical form (`canonicalBlockKey`): keys sorted,
 * null attributes, empty `attrs` and empty `marks` dropped, marks sorted, and
 * adjacent text nodes with the same marks merged. That is how the editor
 * re-saves content (ProseMirror's `toJSON` adds null attributes such as a
 * highlight's `color` and merges text runs), so a report the editor saved
 * after the apply still matches. Pure functions; no Convex runtime.
 */

import type { Id } from "../_generated/dataModel";

export type AppliedHunk = { before: string; after: string };

/** What `chatProposals.appliedChange` holds. */
export type AppliedChange = {
  revisionNumber: number;
  appliedAt: number;
  appliedBy: Id<"users">;
  hunks: AppliedHunk[];
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Block = Record<string, unknown>;

/** The most text one card keeps for Undo, before and after together (spec). */
export const APPLIED_CHANGE_MAX_CHARS = 400_000;
/**
 * The same bound in UTF-8 bytes: a Convex document holds at most 1 MiB, and
 * the hunks share it with the card's own wording. 400,000 characters of
 * accented or non-Latin text can exceed it.
 */
export const APPLIED_CHANGE_MAX_BYTES = 600_000;
/** Above this many block pairs the changed middle is kept as one run. */
const MAX_DIFF_CELLS = 4_000_000;
/** How far a run grows with unchanged neighbours to become unique. */
const MAX_CONTEXT_STEPS = 6;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalAttrs(value: unknown): Json | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, Json> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === null || entry === undefined) continue;
    out[key] = canonical(entry);
  }
  return Object.keys(out).length ? out : undefined;
}

function canonicalMarks(value: unknown): Json | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value
    .map((mark) => canonical(mark))
    .sort((left, right) => {
      const a = JSON.stringify(left);
      const b = JSON.stringify(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
}

/** Adjacent text nodes with the same marks read as one, as ProseMirror stores them. */
function mergeTextRuns(nodes: Json[]): Json[] {
  const out: Json[] = [];
  for (const node of nodes) {
    if (isObject(node) && node.type === "text") {
      if (typeof node.text !== "string" || node.text.length === 0) continue;
      const last = out.at(-1);
      if (
        isObject(last) &&
        last.type === "text" &&
        JSON.stringify(last.marks ?? null) === JSON.stringify(node.marks ?? null)
      ) {
        out[out.length - 1] = { ...last, text: `${last.text as string}${node.text}` };
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

function canonical(value: unknown): Json {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) continue;
      if (key === "attrs") {
        const attrs = canonicalAttrs(entry);
        if (attrs !== undefined) out.attrs = attrs;
        continue;
      }
      if (key === "marks") {
        const marks = canonicalMarks(entry);
        if (marks !== undefined) out.marks = marks;
        continue;
      }
      if (key === "content" && Array.isArray(entry)) {
        const content = mergeTextRuns(entry.map(canonical));
        if (content.length) out.content = content;
        continue;
      }
      out[key] = canonical(entry);
    }
    return out;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  return null;
}

/** One top-level block in the canonical form both sides are compared in. */
export function canonicalBlockKey(block: unknown): string {
  return JSON.stringify(canonical(block));
}

function topBlocks(doc: unknown): Block[] | null {
  if (!isObject(doc) || !Array.isArray(doc.content)) return null;
  return doc.content.filter(isObject);
}

type Range = { oldStart: number; oldEnd: number; newStart: number; newEnd: number };

/** Matched block pairs of the changed middle, in order (longest common subsequence). */
function alignMiddle(oldKeys: string[], newKeys: string[], range: Range): Array<[number, number]> {
  const n = range.oldEnd - range.oldStart;
  const m = range.newEnd - range.newStart;
  if (n === 0 || m === 0 || n * m > MAX_DIFF_CELLS) return [];
  // lengths[i][j]: common subsequence of old[i..] and new[j..].
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        oldKeys[range.oldStart + i] === newKeys[range.newStart + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldKeys[range.oldStart + i] === newKeys[range.newStart + j]) {
      pairs.push([range.oldStart + i, range.newStart + j]);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

function occurrences(keys: string[], run: string[]): number[] {
  const found: number[] = [];
  if (run.length === 0 || run.length > keys.length) return found;
  for (let start = 0; start + run.length <= keys.length; start += 1) {
    let match = true;
    for (let offset = 0; offset < run.length; offset += 1) {
      if (keys[start + offset] !== run[offset]) {
        match = false;
        break;
      }
    }
    if (match) found.push(start);
  }
  return found;
}

/** Merge runs that overlap or that a context step made touch. */
function mergeRanges(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const range of [...ranges].sort((a, b) => a.newStart - b.newStart)) {
    const last = out.at(-1);
    if (last && range.newStart < last.newEnd) {
      last.oldEnd = Math.max(last.oldEnd, range.oldEnd);
      last.newEnd = Math.max(last.newEnd, range.newEnd);
      continue;
    }
    out.push({ ...range });
  }
  return out;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The changed runs of top-level blocks between `before` (the stored report)
 * and `after` (the report the apply writes). Each run grows with unchanged
 * neighbours until its new text occurs exactly once in `after`, so Undo can
 * find it, and an inserted or deleted run always carries a neighbour.
 *
 * Returns null when either side is not a document or the runs exceed
 * APPLIED_CHANGE_MAX_CHARS or APPLIED_CHANGE_MAX_BYTES (no Undo is offered),
 * and an empty list when nothing changed.
 */
export function computeAppliedHunks(before: unknown, after: unknown): AppliedHunk[] | null {
  const oldBlocks = topBlocks(before);
  const newBlocks = topBlocks(after);
  if (!oldBlocks || !newBlocks) return null;
  const oldKeys = oldBlocks.map(canonicalBlockKey);
  const newKeys = newBlocks.map(canonicalBlockKey);

  let prefix = 0;
  while (prefix < oldKeys.length && prefix < newKeys.length && oldKeys[prefix] === newKeys[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldKeys.length - prefix &&
    suffix < newKeys.length - prefix &&
    oldKeys[oldKeys.length - 1 - suffix] === newKeys[newKeys.length - 1 - suffix]
  ) suffix += 1;
  const middle: Range = {
    oldStart: prefix,
    oldEnd: oldKeys.length - suffix,
    newStart: prefix,
    newEnd: newKeys.length - suffix,
  };
  if (middle.oldStart === middle.oldEnd && middle.newStart === middle.newEnd) return [];

  // The unmatched stretches between aligned pairs are the changed runs.
  let ranges: Range[] = [];
  let oldAt = middle.oldStart;
  let newAt = middle.newStart;
  for (const [oldIndex, newIndex] of [...alignMiddle(oldKeys, newKeys, middle), [middle.oldEnd, middle.newEnd]]) {
    if (oldIndex > oldAt || newIndex > newAt) {
      ranges.push({ oldStart: oldAt, oldEnd: oldIndex, newStart: newAt, newEnd: newIndex });
    }
    oldAt = oldIndex + 1;
    newAt = newIndex + 1;
  }

  // Grow each run with unchanged neighbours until its new text is unique.
  for (let step = 0; step < MAX_CONTEXT_STEPS; step += 1) {
    ranges = mergeRanges(ranges);
    let grew = false;
    for (const range of ranges) {
      const run = newKeys.slice(range.newStart, range.newEnd);
      if (run.length > 0 && occurrences(newKeys, run).length === 1) continue;
      // Alternate sides; take whichever side still has a neighbour.
      const left = range.newStart > 0 && range.oldStart > 0;
      const right = range.newEnd < newKeys.length && range.oldEnd < oldKeys.length;
      if (left && (step % 2 === 0 || !right)) {
        range.newStart -= 1;
        range.oldStart -= 1;
        grew = true;
      } else if (right) {
        range.newEnd += 1;
        range.oldEnd += 1;
        grew = true;
      }
    }
    if (!grew) break;
  }
  ranges = mergeRanges(ranges);

  const hunks = ranges.map((range) => ({
    before: JSON.stringify(oldBlocks.slice(range.oldStart, range.oldEnd)),
    after: JSON.stringify(newBlocks.slice(range.newStart, range.newEnd)),
  }));
  let chars = 0;
  let bytes = 0;
  for (const hunk of hunks) {
    chars += hunk.before.length + hunk.after.length;
    if (chars > APPLIED_CHANGE_MAX_CHARS) return null;
    bytes += utf8Bytes(hunk.before) + utf8Bytes(hunk.after);
    if (bytes > APPLIED_CHANGE_MAX_BYTES) return null;
  }
  return hunks;
}

function parseRun(text: string): Block[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) && parsed.every(isObject) ? (parsed as Block[]) : null;
  } catch {
    return null;
  }
}

/**
 * Put each hunk's `before` blocks back where its `after` blocks stand in
 * `current`. Every `after` run must occur exactly once and no two may
 * overlap; otherwise nothing changes and the result is a conflict.
 */
export function undoAppliedHunks(
  current: unknown,
  hunks: readonly AppliedHunk[]
): { ok: true; doc: Record<string, unknown> } | { ok: false } {
  const blocks = topBlocks(current);
  if (!blocks || !isObject(current) || hunks.length === 0) return { ok: false };
  const keys = blocks.map(canonicalBlockKey);
  const placed: Array<{ start: number; end: number; restore: Block[] }> = [];
  for (const hunk of hunks) {
    const after = parseRun(hunk.after);
    const restore = parseRun(hunk.before);
    if (!after || !restore || after.length === 0) return { ok: false };
    const found = occurrences(keys, after.map(canonicalBlockKey));
    if (found.length !== 1) return { ok: false };
    placed.push({ start: found[0], end: found[0] + after.length, restore });
  }
  placed.sort((a, b) => a.start - b.start);
  for (let index = 1; index < placed.length; index += 1) {
    if (placed[index].start < placed[index - 1].end) return { ok: false };
  }
  const next = [...blocks];
  for (const run of [...placed].reverse()) {
    next.splice(run.start, run.end - run.start, ...run.restore);
  }
  return { ok: true, doc: { ...current, content: next } };
}

/**
 * The record an apply stores for Undo, or undefined when nothing can be
 * kept (no change, a document that does not parse, or over the size cap):
 * such a card offers no Undo.
 */
export function appliedChangeFor(input: {
  before: unknown;
  after: unknown;
  revisionNumber: number;
  appliedAt: number;
  appliedBy: Id<"users">;
}): AppliedChange | undefined {
  const hunks = computeAppliedHunks(input.before, input.after);
  if (!hunks || hunks.length === 0) return undefined;
  return {
    revisionNumber: input.revisionNumber,
    appliedAt: input.appliedAt,
    appliedBy: input.appliedBy,
    hunks,
  };
}

/** A JSON report body as an object, or null when it does not parse as one. */
export function parseReportDocument(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
