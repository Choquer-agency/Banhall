// One card per Line (owner, 2026-10-28): which CRA Line a suggested change
// sits in, and find/replace scoped to one Line. A Line is a top-level Section
// heading ("Line 242 ..."), the same test `reportEdits` uses to protect
// headings, plus every top-level block up to the next Section heading.

import {
  applyReplacements,
  nodeText,
  normalizeForMatch,
  type PMNode,
  type ReplacePair,
  type ReplacementResult,
} from "./reportEdits";

export type ReportLine = "242" | "244" | "246";

export const REPORT_LINES: readonly ReportLine[] = ["242", "244", "246"];

/** The Line a top-level Section heading opens, or null for any other block. */
export function headingLine(node: PMNode): ReportLine | null {
  if (node.type !== "heading") return null;
  const match = /^\s*(?:line|section)\s+(24[246])\b/i.exec(normalizeForMatch(nodeText(node)));
  return match ? (match[1] as ReportLine) : null;
}

type LineRange = { start: number; end: number };

/** The top-level block range of each Line: its heading through its last block. */
export function lineRanges(doc: PMNode): Partial<Record<ReportLine, LineRange>> {
  const top = (doc.content as PMNode[] | undefined) ?? [];
  const ranges: Partial<Record<ReportLine, LineRange>> = {};
  let open: ReportLine | null = null;
  top.forEach((node, index) => {
    const line = headingLine(node);
    if (!line) return;
    if (open) ranges[open]!.end = index;
    // A repeated heading for the same Line keeps the first one, as
    // section detection does.
    if (ranges[line]) {
      open = null;
      return;
    }
    ranges[line] = { start: index, end: top.length };
    open = line;
  });
  return ranges;
}

function lineDoc(doc: PMNode, range: LineRange): PMNode {
  const top = (doc.content as PMNode[] | undefined) ?? [];
  return { ...doc, content: top.slice(range.start, range.end) };
}

/**
 * `applyReplacements` inside one Line only. Text outside the Line is never
 * touched or counted; a report without that Line changes nothing.
 */
export function applyReplacementsInLine(doc: PMNode, pairs: ReplacePair[], line: ReportLine): ReplacementResult {
  const range = lineRanges(doc)[line];
  if (!range) return { doc, count: 0, skippedInHeadings: 0, skippedInTitle: 0 };
  const top = (doc.content as PMNode[] | undefined) ?? [];
  const inner = applyReplacements(lineDoc(doc, range), pairs);
  const replaced = (inner.doc.content as PMNode[] | undefined) ?? [];
  return {
    ...inner,
    doc: { ...doc, content: [...top.slice(0, range.start), ...replaced, ...top.slice(range.end)] },
  };
}

/** How many times `pair.find` matches the prose of each Line. */
export function pairLineCounts(doc: PMNode, pair: ReplacePair): Partial<Record<ReportLine, number>> {
  const ranges = lineRanges(doc);
  const counts: Partial<Record<ReportLine, number>> = {};
  for (const line of REPORT_LINES) {
    const range = ranges[line];
    if (!range) continue;
    const { count } = applyReplacements(lineDoc(doc, range), [pair]);
    if (count > 0) counts[line] = count;
  }
  return counts;
}

export type LineGroup = { line: ReportLine | undefined; pairs: ReplacePair[] };

/**
 * Split a card's pairs into one group per Line, in build order 242, 244, 246.
 * A pair that recurs in several Lines (a report-wide find/replace) goes into
 * each of them; each card then applies inside its own Line. A pair that
 * matches no Line's prose stays in a group without a Line, so the existing
 * checks still decide what happens to it.
 */
export function groupPairsByLine(doc: PMNode, pairs: ReplacePair[]): LineGroup[] {
  const byLine = new Map<ReportLine | undefined, ReplacePair[]>();
  for (const pair of pairs) {
    const lines = REPORT_LINES.filter((line) => (pairLineCounts(doc, pair)[line] ?? 0) > 0);
    for (const line of lines.length ? lines : [undefined]) {
      byLine.set(line, [...(byLine.get(line) ?? []), pair]);
    }
  }
  const order = (line: ReportLine | undefined) => (line ? REPORT_LINES.indexOf(line) : REPORT_LINES.length);
  return [...byLine.entries()]
    .sort(([left], [right]) => order(left) - order(right))
    .map(([line, grouped]) => ({ line, pairs: grouped }));
}
