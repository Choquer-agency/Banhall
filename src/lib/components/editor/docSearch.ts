import type { Node as PMNode } from "@tiptap/pm/model";

export type Range = { from: number; to: number; text: string };

/**
 * Normalize for matching WITHOUT changing length (1:1) so character offsets
 * still map to ProseMirror positions: unify curly quotes, dashes, and collapse
 * every whitespace char to a single space. This makes matching tolerant of the
 * punctuation/whitespace the model tends to substitute in its references.
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
 * the needle side, so indexes in `hay` always line up with `posMap` —
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
    } else if (node.isTextblock && chars.length > 0) {
      pendingBreak = true;
    }
    return true;
  });
  return { hay: chars.join(""), posMap };
}

/**
 * Every occurrence of every needle in one pass. Proposal previews and
 * find/replace run whole batches of pairs at once, and building the index and
 * case-folding the haystack per needle made a 20-pair preview walk the document
 * 20 times over. Index-aligned with `finds`; a needle that normalises to empty
 * gets an empty slot. A batch with nothing to search for never touches the
 * document, so typing with no preview open costs no walk at all.
 */
export function findOccurrencesBatch(doc: PMNode, finds: string[]): Range[][] {
  const out: Range[][] = finds.map(() => []);
  const needles = finds.map((f) => (f ?? "").trim());
  const normalized = needles.map((n) => normalizeForMatch(n).toLowerCase());
  if (doc.content.size < 2 || normalized.every((n) => !n)) return out;

  const index = buildSearchIndex(doc);
  const hay = index.hay.toLowerCase();
  const posMap = index.posMap;

  for (let i = 0; i < normalized.length; i++) {
    const ned = normalized[i];
    if (!ned) continue;
    const needle = needles[i];
    let idx = hay.indexOf(ned);
    while (idx !== -1) {
      const fromPos = posMap[idx];
      const toPos = posMap[idx + ned.length - 1];
      if (fromPos !== undefined && toPos !== undefined && fromPos !== -1 && toPos !== -1) {
        let actual = needle;
        try {
          actual = doc.textBetween(fromPos, toPos + 1, " ");
        } catch {
          /* keep needle */
        }
        out[i].push({ from: fromPos, to: toPos + 1, text: actual });
      }
      idx = hay.indexOf(ned, idx + Math.max(1, ned.length));
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
