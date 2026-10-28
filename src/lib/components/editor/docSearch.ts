import type { Node as PMNode } from "@tiptap/pm/model";

export type Range = { from: number; to: number; text: string };

/**
 * Normalize punctuation and collapse whitespace runs for matching. Search
 * offsets are aligned through buildSearchIndex's position map, rather than
 * through equal lengths of the original and normalized strings.
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’′´`]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, "-")
    // Collapse whitespace RUNS (incl. paragraph breaks) to one space so a
    // needle spanning "\n\n" matches doc text where blocks join on one "\n".
    .replace(/\s+/g, " ");
}

/**
 * Doc text + aligned position map for searching. Whitespace runs and block
 * boundaries collapse to a single " " entry, matching normalizeForMatch on
 * the needle side, so indexes in `hay` always line up with `posMap`;
 * consecutive empty paragraphs previously desynced the two and highlights
 * landed on shifted character spans.
 */
export function buildSearchIndex(doc: PMNode): { hay: string; posMap: number[] } {
  const chars: string[] = [];
  const posMap: number[] = [];
  let pendingBreak = false;
  const pushChar = (ch: string, pos: number) => {
    if (/\s/.test(ch)) {
      pendingBreak = chars.length > 0;
      return;
    }
    if (pendingBreak) {
      // Interior separator: matches never start/end on a space (needles are
      // trimmed), so mapping it to the next real char's pos is safe.
      chars.push(" ");
      posMap.push(pos);
      pendingBreak = false;
    }
    chars.push(
      ch
        .replace(/[‘’′´`]/, "'")
        .replace(/[“”″]/, '"')
        .replace(/[–—−]/, "-")
    );
    posMap.push(pos);
  };
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) pushChar(node.text[i], pos + i);
    } else if ((node.isTextblock || node.type.name === "hardBreak") && chars.length > 0) {
      pendingBreak = true;
    }
    return true;
  });
  return { hay: chars.join(""), posMap };
}

/** Preserve ordinary/block text while making supported hard breaks visible. */
export function extractMatchedText(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, " ", (leaf) =>
    leaf.type.name === "hardBreak" ? " " : (leaf.type.spec.leafText?.(leaf) ?? "")
  );
}

/**
 * Keep whole-string casing authoritative (notably contextual Greek sigma).
 * Isolated lowercase lengths only align its units to complete original UTF-16
 * spans. Default Unicode lowercase context changes sigma's value, not length.
 * This linear pass runs once per batch; the raw index map stays unchanged.
 */
function lowercaseIndex(index: ReturnType<typeof buildSearchIndex>) {
  const hay = index.hay.toLowerCase();
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const point of index.hay) {
    // A one-code-point haystack has already been folded in full above.
    const length = point.length === index.hay.length ? hay.length : point.toLowerCase().length;
    const from = index.posMap[offset];
    const to = index.posMap[offset + point.length - 1] + 1;
    for (let unit = 0; unit < length; unit++) {
      starts.push(from);
      ends.push(to);
    }
    offset += point.length;
  }
  return { hay, starts, ends };
}

/**
 * Every occurrence of every needle using one document index. Proposal previews and
 * find/replace run whole batches of pairs at once, and building the index and
 * case-folding the haystack per needle made a 20-pair preview walk the document
 * 20 times over. Index-aligned with `finds`; a needle that normalises to empty
 * gets an empty slot. A batch with nothing to search for performs no document walk or haystack
 * case-fold. The guard still reads the document content size.
 */
export function findOccurrencesBatch(doc: PMNode, finds: string[]): Range[][] {
  const out: Range[][] = finds.map(() => []);
  const needles = finds.map((f) => (f ?? "").trim());
  const normalized = needles.map((n) => normalizeForMatch(n).toLowerCase());
  if (doc.content.size < 2 || normalized.every((n) => !n)) return out;

  const index = buildSearchIndex(doc);
  const { hay, starts, ends } = lowercaseIndex(index);

  for (let i = 0; i < normalized.length; i++) {
    const ned = normalized[i];
    if (!ned) continue;
    const needle = needles[i];
    let previousEnd = -1;
    let idx = hay.indexOf(ned);
    while (idx !== -1) {
      const fromPos = starts[idx];
      const toPos = ends[idx + ned.length - 1];
      let advance = 1;
      // Folded matches may be disjoint yet cover the same original character.
      // Keep the first span and enforce non-overlap in document coordinates.
      if (fromPos !== undefined && toPos !== undefined && fromPos >= previousEnd && fromPos !== -1 && toPos !== -1) {
        let actual = needle;
        try {
          actual = extractMatchedText(doc, fromPos, toPos);
        } catch {
          /* keep needle */
        }
        out[i].push({ from: fromPos, to: toPos, text: actual });
        previousEnd = toPos;
        advance = ned.length;
      }
      // A rejected original-span overlap may hide a valid candidate inside
      // this folded match. Only accepted matches consume the full needle.
      idx = hay.indexOf(ned, idx + advance);
    }
  }
  return out;
}

/**
 * BNH-30: every occurrence of `find`, case-insensitive (so "the system" also
 * matches "The system" at sentence starts). Returns the ACTUAL matched text so
 * the replacement can preserve casing.
 */
export function findAllOccurrencesCI(doc: PMNode, find: string): Range[] {
  return findOccurrencesBatch(doc, [find])[0];
}

/** One mark of a change under review: old words cut, or new words added. */
export type ReviewMark =
  | { kind: "cut"; from: number; to: number }
  | { kind: "new"; at: number; text: string };

type ReviewPart = { type: "equal" | "removed" | "added"; text: string };

/**
 * Owner 2026-10-28 (rows 34 and 35): the marks for a change under review.
 * Each pair's passage is found the way previews find it; inside it, the
 * words the change removes are cut ranges and the words it adds are new text
 * placed where they go. `diff` splits one passage into those parts (the
 * card uses `diffWords`). `scope` keeps the search inside one Line.
 */
export function reviewMarks(
  doc: PMNode,
  pairs: ReadonlyArray<{ find: string; replaceWith: string }>,
  diff: (before: string, after: string) => ReviewPart[],
  scope?: { from: number; to: number }
): ReviewMark[] {
  const marks: ReviewMark[] = [];
  if (doc.content.size < 2 || pairs.length === 0) return marks;
  const index = buildSearchIndex(doc);
  const { hay, starts, ends } = lowercaseIndex(index);
  const inScope = (from: number, to: number) => !scope || (from >= scope.from && to <= scope.to);

  for (const pair of pairs) {
    const needle = (pair.find ?? "").trim();
    const ned = normalizeForMatch(needle).toLowerCase();
    if (!ned) continue;
    // Offsets in the needle map to offsets in the normalized needle, which
    // line up with the haystack and so with document positions.
    const normalizedLength = (text: string) => normalizeForMatch(text).toLowerCase().length;
    // Neighbouring removed (or added) words make one mark, so a struck
    // phrase reads as one run, across a line break too.
    const parts = diff(needle, (pair.replaceWith ?? "").trim()).reduce<ReviewPart[]>((merged, part) => {
      const last = merged.at(-1);
      if (last && last.type === part.type && part.type !== "equal") last.text += part.text;
      else merged.push({ ...part });
      return merged;
    }, []);
    let idx = hay.indexOf(ned);
    let previousEnd = -1;
    while (idx !== -1) {
      const from = starts[idx];
      const to = ends[idx + ned.length - 1];
      if (from === undefined || to === undefined || from < previousEnd || !inScope(from, to)) {
        idx = hay.indexOf(ned, idx + 1);
        continue;
      }
      previousEnd = to;
      let offset = 0;
      for (const part of parts) {
        if (part.type === "added") {
          const at = normalizedLength(needle.slice(0, offset));
          const position = at < ned.length ? starts[idx + at] : to;
          if (part.text.trim()) marks.push({ kind: "new", at: position, text: part.text.trim() });
          continue;
        }
        const startOffset = offset;
        offset += part.text.length;
        if (part.type === "equal") continue;
        let start = normalizedLength(needle.slice(0, startOffset));
        let end = normalizedLength(needle.slice(0, offset));
        // A collapsed space maps to the next word's position: trim it off.
        while (start < end && hay[idx + start] === " ") start++;
        while (end > start && hay[idx + end - 1] === " ") end--;
        if (end > start) marks.push({ kind: "cut", from: starts[idx + start], to: ends[idx + end - 1] });
      }
      idx = hay.indexOf(ned, idx + ned.length);
    }
  }
  return marks;
}
