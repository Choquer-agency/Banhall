// Find/replace machinery for AI-proposed report edits (BNH-27/30). Shared by
// the legacy chat pipeline (convex/chat.ts) and the agent-based one
// (convex/chatV2.ts) during the parallel-run migration.

export type PMNode = Record<string, unknown>;
export type ReplacePair = { find: string; replaceWith: string };

/**
 * Normalize for matching WITHOUT changing length (1:1) so offsets in the
 * normalized string map back to the original: unify curly quotes, dashes, and
 * whitespace. The model routinely emits straight quotes / hyphens where the
 * report has typographic ones, which broke exact matching (BNH-27).
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’′´`]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\s/g, " ");
}

/** Capitalize the replacement's first letter when the matched text was capitalized. */
function smartCaseReplace(matched: string, replaceWith: string): string {
  const mi = matched.search(/[A-Za-z]/);
  // First LETTER of the replacement, not first lowercase letter: searching for
  // /[a-z]/ skipped an already-capitalized first word and uppercased its
  // second letter instead ("Acuity …" → "ACuity …").
  const ri = replaceWith.search(/[A-Za-z]/);
  if (mi >= 0 && ri >= 0) {
    const ch = matched[mi];
    const rch = replaceWith[ri];
    if (
      ch === ch.toUpperCase() &&
      ch !== ch.toLowerCase() &&
      rch === rch.toLowerCase() &&
      rch !== rch.toUpperCase()
    ) {
      return (
        replaceWith.slice(0, ri) +
        rch.toUpperCase() +
        replaceWith.slice(ri + 1)
      );
    }
  }
  return replaceWith;
}

/**
 * Replace every (non-overlapping) occurrence of `find` with `replaceWith`.
 * Matching is punctuation/whitespace-normalized AND case-insensitive (so "the
 * system" also matches "The system" at sentence starts), splicing the ORIGINAL
 * text at the matched offsets with case-preserving replacement (BNH-27/30).
 */
export function replaceAll(
  text: string,
  find: string,
  replaceWith: string
): { text: string; count: number } {
  if (!find) return { text, count: 0 };

  const nText = normalizeForMatch(text).toLowerCase();
  const nFind = normalizeForMatch(find).toLowerCase();
  if (!nFind) return { text, count: 0 };

  let out = "";
  let last = 0;
  let count = 0;
  let idx = nText.indexOf(nFind);
  while (idx !== -1) {
    const matched = text.slice(idx, idx + nFind.length);
    out += text.slice(last, idx) + smartCaseReplace(matched, replaceWith);
    last = idx + nFind.length;
    count += 1;
    idx = nText.indexOf(nFind, last);
  }
  out += text.slice(last);
  return { text: out, count };
}

/**
 * The "Line 242/244/246" Section headings are load-bearing: export, QA and
 * section detection find the Sections by their exact text, and the report
 * page shows them as fixed labels. The report's own title (a level-1 heading
 * first in the document) is hidden on the report page. No edit may rewrite
 * either (review g1, 2026-09-25), so every replacement pass leaves them be.
 */
function isSectionHeading(node: PMNode): boolean {
  if (node.type !== "heading") return false;
  return /^\s*(?:line|section)\s+24[246]\b/i.test(normalizeForMatch(nodeText(node)));
}

type ProtectedKind = "section" | "title";

/** The top-level nodes no edit may touch: the Section headings and the hidden title. */
function protectedHeadings(doc: PMNode): Map<PMNode, ProtectedKind> {
  const nodes = new Map<PMNode, ProtectedKind>();
  const top = (doc.content as PMNode[] | undefined) ?? [];
  top.forEach((node, index) => {
    const level = (node.attrs as { level?: unknown } | undefined)?.level;
    if (index === 0 && node.type === "heading" && level === 1) nodes.set(node, "title");
    else if (isSectionHeading(node)) nodes.set(node, "section");
  });
  return nodes;
}

/** Plain messages for an edit refused because it targets heading text. */
export const SECTION_HEADING_EDIT_REFUSED = "Section headings can't be edited.";
export const REPORT_TITLE_EDIT_REFUSED = "The report title can't be edited.";

const LEAF_NODE_TYPES = new Set(["hardBreak", "horizontalRule", "image"]);

/** A node's size in ProseMirror positions (what editor selections count in). */
function nodeSize(node: PMNode): number {
  if (node.type === "text" && typeof node.text === "string") return node.text.length;
  const children = node.content as PMNode[] | undefined;
  if (!Array.isArray(children) || children.length === 0) {
    return LEAF_NODE_TYPES.has(node.type as string) ? 1 : 2;
  }
  return 2 + children.reduce((sum, child) => sum + nodeSize(child), 0);
}

/** Text of the document between two ProseMirror positions. */
function textBetweenPositions(doc: PMNode, from: number, to: number): string {
  let out = "";
  const visit = (node: PMNode, start: number) => {
    if (node.type === "text" && typeof node.text === "string") {
      const end = start + node.text.length;
      if (end > from && start < to) out += node.text.slice(Math.max(0, from - start), Math.min(node.text.length, to - start));
      return;
    }
    const children = node.content as PMNode[] | undefined;
    if (!Array.isArray(children)) return;
    let pos = start + 1;
    for (const child of children) {
      visit(child, pos);
      pos += nodeSize(child);
    }
  };
  let pos = 0;
  for (const child of (doc.content as PMNode[] | undefined) ?? []) {
    visit(child, pos);
    pos += nodeSize(child);
  }
  return out;
}

export type StoredSelection = { from: number; to: number; text: string };
/**
 * "missing": the selected text is no longer in the report. "split": the
 * stored positions no longer hold it and it now occurs both in heading or
 * title text and in the body, so where the writer meant cannot be told.
 */
export type SelectionLocation = "body" | ProtectedKind | "missing" | "split";

/** Plain message when a stored selection's text is no longer in the report. */
export const SELECTION_GONE = "The report changed since this text was selected. Select it again.";

/** Each top-level node with its ProseMirror range and protected kind, if any. */
function topLevelRanges(doc: PMNode): Array<{ from: number; to: number; kind: ProtectedKind | undefined }> {
  const guarded = protectedHeadings(doc);
  const ranges: Array<{ from: number; to: number; kind: ProtectedKind | undefined }> = [];
  let pos = 0;
  for (const node of (doc.content as PMNode[] | undefined) ?? []) {
    const size = nodeSize(node);
    ranges.push({ from: pos, to: pos + size, kind: guarded.get(node) });
    pos += size;
  }
  return ranges;
}

/**
 * The protected kind a selection touches. A heading's text runs from one
 * position after its start to one before its end, so a body selection that
 * ends at the start of the next heading line, or starts at the end of a
 * heading's text, stays in the body.
 */
function kindAt(doc: PMNode, from: number, to: number): "body" | ProtectedKind {
  for (const range of topLevelRanges(doc)) {
    if (range.kind && from < range.to - 1 && to > range.from + 1) return range.kind;
  }
  return "body";
}

/**
 * Compare selected text with document text ignoring all whitespace: the
 * editor joins the blocks of a selection with a newline, the server's
 * position walk joins them with nothing.
 */
const compact = (text: string) => normalizeForMatch(text).replace(/\s+/g, "").toLowerCase();

/** Every occurrence of `text` inside one textblock, as ProseMirror ranges. */
function occurrences(doc: PMNode, text: string): Array<{ from: number; to: number }> {
  const needle = compact(text);
  if (!needle) return [];
  const found: Array<{ from: number; to: number }> = [];
  const visit = (node: PMNode, start: number) => {
    const children = node.content as PMNode[] | undefined;
    if (!Array.isArray(children)) return;
    if (children.every((c) => c.type === "text" || c.type === "hardBreak")) {
      // The block's text without whitespace, with each kept character's position.
      let joined = "";
      const positions: number[] = [];
      let pos = start + 1;
      for (const child of children) {
        if (child.type === "text" && typeof child.text === "string") {
          const normalized = normalizeForMatch(child.text).toLowerCase();
          for (let i = 0; i < normalized.length; i++) {
            if (!/\s/.test(normalized[i])) {
              joined += normalized[i];
              positions.push(pos + i);
            }
          }
          pos += child.text.length;
        } else {
          pos += 1;
        }
      }
      for (let at = joined.indexOf(needle); at !== -1; at = joined.indexOf(needle, at + 1)) {
        found.push({ from: positions[at], to: positions[at + needle.length - 1] + 1 });
      }
      return;
    }
    let pos = start + 1;
    for (const child of children) {
      visit(child, pos);
      pos += nodeSize(child);
    }
  };
  let pos = 0;
  for (const child of (doc.content as PMNode[] | undefined) ?? []) {
    visit(child, pos);
    pos += nodeSize(child);
  }
  return found;
}

/**
 * Where a stored editor selection sits: in a Section heading, the hidden
 * title or the body. When the positions no longer hold the selected text (the
 * report changed since), its occurrences decide only if they are all of one
 * kind; occurrences in both heading or title text and the body give "split",
 * and a text no longer anywhere in one block gives "missing".
 *
 * `partialHeadingText: false` is for selections made in the report editor
 * (research, Ask assistant). The reading view never selects part of a
 * heading's text, and the classic view selects whole words, so an occurrence
 * inside a heading or the title then counts only when it covers that
 * heading's whole text or whole words of it: "46" inside "Line 246" does
 * not, "Work Performed" does. The review link keeps the default: every
 * occurrence counts.
 */
export function locateSelection(
  doc: PMNode,
  selection: StoredSelection,
  { partialHeadingText = true }: { partialHeadingText?: boolean } = {}
): SelectionLocation {
  const { from, to } = selection;
  if (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    to > from &&
    compact(textBetweenPositions(doc, from, to)) === compact(selection.text)
  ) {
    return kindAt(doc, from, to);
  }
  const ranges = topLevelRanges(doc);
  const kinds = new Set<"body" | ProtectedKind>();
  for (const found of occurrences(doc, selection.text)) {
    const kind = kindAt(doc, found.from, found.to);
    if (kind !== "body" && !partialHeadingText) {
      const heading = ranges.find((range) => range.kind && found.from < range.to - 1 && found.to > range.from + 1);
      if (!heading) continue;
      const before = textBetweenPositions(doc, heading.from + 1, found.from);
      const after = textBetweenPositions(doc, found.to, heading.to - 1);
      const wordBounded = !/[\p{L}\p{N}]$/u.test(before) && !/^[\p{L}\p{N}]/u.test(after);
      if (!wordBounded) continue;
    }
    kinds.add(kind);
  }
  if (kinds.size === 0) return "missing";
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.has("body")) return "split";
  return kinds.has("section") ? "section" : "title";
}

/**
 * The location that decides an Ask assistant edit, from the writer's
 * highlight: undefined when the edit does not target the highlight. A
 * heading, title, split or missing highlight only decides for an edit whose
 * target text actually occurs in heading or title text (`protectedMatches`):
 * a body-only target falls back to the match-count rules (so the second edit
 * from a turn applies after the first changed the highlighted text), while a
 * heading-text target of a highlight that can no longer be placed is refused.
 */
export function highlightLocation(
  doc: PMNode,
  highlight: StoredSelection,
  find: string,
  protectedMatches: number
): SelectionLocation | undefined {
  const target = compact(find);
  const selected = compact(highlight.text);
  if (!target || !selected) return undefined;
  if (!target.includes(selected) && !selected.includes(target)) return undefined;
  // "missing" stays a refusal for a target that also occurs in heading or
  // title text; a body-only target falls back to the match-count rules.
  const location = locateSelection(doc, highlight, { partialHeadingText: false });
  if (location !== "body" && protectedMatches === 0) return undefined;
  return location;
}

export type ReplacementResult = {
  doc: PMNode;
  count: number;
  /** Matches left in Section headings, which are never edited. */
  skippedInHeadings: number;
  /** Matches left in the hidden report title, which is never edited. */
  skippedInTitle: number;
};

/**
 * Why a single-target edit must be refused because of heading or title text,
 * or null. With a stored selection (a research edit, a client suggestion, an
 * Ask assistant highlight) the selection decides: in a heading or the title
 * it is refused, in the body it may apply to the body match, and a selection
 * whose text is gone is refused as stale. Without one, a heading or title
 * match only matters when it is the only match.
 */
export function headingEditRefusal(
  result: ReplacementResult,
  location?: SelectionLocation
): string | null {
  const message = result.skippedInHeadings > 0 ? SECTION_HEADING_EDIT_REFUSED : REPORT_TITLE_EDIT_REFUSED;
  const inProtected = result.skippedInHeadings + result.skippedInTitle > 0;
  if (location === "section") return SECTION_HEADING_EDIT_REFUSED;
  if (location === "title") return REPORT_TITLE_EDIT_REFUSED;
  if (location === "missing" || location === "split") return SELECTION_GONE;
  if (result.count === 0 && inProtected) return message;
  return null;
}

/** A blank line between paragraphs in a card's text. */
export const PARAGRAPH_BREAK = /\n[ \t]*\n/;

/**
 * 2026-11-03 (owner: "let it add, merge and split paragraphs"): a pair that
 * changes the paragraphs, not just their text. Its replacement holds a blank
 * line (a split, or a paragraph added after this one) or is empty (the
 * paragraph merged into another, so it goes). Such a pair acts only on a
 * whole paragraph whose text is exactly its `find`; it never puts a blank
 * line inside a paragraph.
 */
export function isParagraphPair(pair: ReplacePair): boolean {
  return PARAGRAPH_BREAK.test(pair.replaceWith) || pair.replaceWith.trim() === "";
}

/**
 * How `applyReplacements` treats paragraph pairs. Off by default, so every
 * other caller (client review suggestions, research edits) behaves as before;
 * Assistant cards turn it on (review 2026-11-03).
 */
export type ReplaceOptions = { paragraphs?: boolean };

/** Whether a pair changes paragraphs in this doc: a paragraph pair whose find is a whole top-level paragraph. */
export function changesParagraphs(doc: PMNode, pair: ReplacePair): boolean {
  if (!isParagraphPair(pair)) return false;
  const top = (doc.content as PMNode[] | undefined) ?? [];
  return top.some((block) => block.type === "paragraph" && blockText(block).trim() !== "" && sameText(blockText(block), pair.find));
}

/**
 * The paragraphs a paragraph pair leaves in place of the one it matched. A
 * new paragraph that is the matched one unchanged keeps its node, marks and
 * gap highlights included (adding a paragraph after it never retypes it).
 */
function paragraphsFor(original: PMNode, pair: ReplacePair): PMNode[] {
  return pair.replaceWith
    .replace(/\r\n?/g, "\n")
    .split(PARAGRAPH_BREAK)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) =>
      sameText(text, pair.find)
        ? original
        : {
            type: "paragraph",
            ...(original.attrs ? { attrs: original.attrs } : {}),
            content: [{ type: "text", text }],
          }
    );
}

/**
 * Final review 2026-11-03: a passage set marks each target before it writes
 * the new text, so a paragraph an added paragraph leaves unchanged comes back
 * as plain text. Put the original top-level paragraph back (its marks and gap
 * highlights) wherever the new doc holds one with exactly its text that a
 * paragraph pair left in place.
 */
export function keepUnchangedParagraphs(original: PMNode, updated: PMNode, pairs: ReplacePair[]): PMNode {
  const kept = new Set(
    pairs
      .filter((pair) => PARAGRAPH_BREAK.test(pair.replaceWith) && changesParagraphs(original, pair))
      .map((pair) => normalizeForMatch(pair.find).trim().toLowerCase())
  );
  if (kept.size === 0) return updated;
  const originals = ((original.content as PMNode[] | undefined) ?? []).filter(
    (block) => block.type === "paragraph" && kept.has(normalizeForMatch(blockText(block)).trim().toLowerCase())
  );
  const content = ((updated.content as PMNode[] | undefined) ?? []).map((block) => {
    if (block.type !== "paragraph") return block;
    const match = originals.find((source) => sameText(blockText(source), blockText(block)));
    return match ?? block;
  });
  return { ...updated, content };
}

/** A paragraph's whole text, hard breaks as line breaks, as the matcher reads it. */
function blockText(node: PMNode): string {
  const children = (node.content as PMNode[] | undefined) ?? [];
  return children.map((c) => (c.type === "text" ? ((c.text as string) ?? "") : "\n")).join("");
}

export const sameText = (a: string, b: string) =>
  normalizeForMatch(a).trim().toLowerCase() === normalizeForMatch(b).trim().toLowerCase();

/**
 * BNH-27: apply find/replace pairs to a Tiptap JSON doc across ALL occurrences.
 * Section headings and the hidden title are skipped (see protectedHeadings),
 * and the matches left there are counted so single-target callers can refuse
 * an edit aimed at them (headingEditRefusal).
 *
 * Each block is matched once, against its original text. Where every match
 * sits inside one text node the replacement keeps the marks; where a match
 * spans inline nodes (a passage broken by a [GAP:] highlight or a bold run)
 * the block's inline text is rebuilt as a single text node so the
 * replacement still lands. Matching the original text means a replacement
 * that contains its own search text is applied once, never again to its own
 * output (review 2026-09-25).
 */
export function applyReplacements(doc: PMNode, pairs: ReplacePair[], options: ReplaceOptions = {}): ReplacementResult {
  let count = 0;
  // With paragraphs on, paragraph pairs act on whole top-level paragraphs
  // below, and a split or an added paragraph never goes inline. An empty
  // replacement inside a paragraph still deletes that text, as before.
  const paragraphs = options.paragraphs === true;
  // Final review (Fable) 2026-11-03: a pair that removes a whole top-level
  // paragraph acts only there. Run inline too, it would also delete that
  // text from a merged paragraph another pair just wrote.
  const structural = paragraphs ? new Set(pairs.filter((pair) => changesParagraphs(doc, pair))) : new Set<ReplacePair>();
  const inlinePairs = paragraphs
    ? pairs.filter((pair) => !PARAGRAPH_BREAK.test(pair.replaceWith) && !structural.has(pair))
    : pairs;
  const guarded = protectedHeadings(doc);
  let skippedInHeadings = 0;
  let skippedInTitle = 0;
  for (const [node, kind] of guarded) {
    const text = nodeText(node);
    for (const { find } of pairs) {
      const found = replaceAll(text, find, "").count;
      if (kind === "section") skippedInHeadings += found;
      else skippedInTitle += found;
    }
  }

  const replaceInText = (text: string): { text: string; count: number } => {
    let out = text;
    let found = 0;
    for (const { find, replaceWith } of inlinePairs) {
      const r = replaceAll(out, find, replaceWith);
      out = r.text;
      found += r.count;
    }
    return { text: out, count: found };
  };

  const walk = (node: PMNode): PMNode => {
    if (guarded.has(node)) return node;
    const children = node.content as PMNode[] | undefined;
    if (!Array.isArray(children)) return node;
    const inlineOnly = children.every((c) => c.type === "text" || c.type === "hardBreak");
    if (inlineOnly && children.some((c) => c.type === "text")) {
      // Per text node: keeps marks.
      let perNode = 0;
      const replaced = children.map((child) => {
        if (child.type !== "text" || typeof child.text !== "string") return child;
        const r = replaceInText(child.text);
        perNode += r.count;
        return r.text === child.text ? child : { ...child, text: r.text };
      }).filter((child) => !(child.type === "text" && child.text === ""));
      // Final review 2026-11-03: an empty text node is invalid, and the editor
      // would load a blank document; an emptied paragraph keeps no content.
      // Across the block's original text: finds matches that span nodes.
      const joined = children.map((c) => (c.type === "text" ? ((c.text as string) ?? "") : "\n")).join("");
      const whole = replaceInText(joined);
      if (whole.count > perNode) {
        count += whole.count;
        return { ...node, content: whole.text ? [{ type: "text", text: whole.text }] : [] };
      }
      count += perNode;
      return perNode > 0 ? { ...node, content: replaced } : node;
    }
    let changed = false;
    const next = children.flatMap((child) => {
      // Top-level paragraphs only: a list item, a table cell or a quote
      // must keep a paragraph.
      if (paragraphs && node === doc && child.type === "paragraph" && !guarded.has(child)) {
        const text = blockText(child);
        const pair = text.trim() ? pairs.find((entry) => isParagraphPair(entry) && sameText(text, entry.find)) : undefined;
        if (pair) {
          count += 1;
          changed = true;
          return paragraphsFor(child, pair);
        }
      }
      const walked = walk(child);
      if (walked !== child) changed = true;
      return [walked];
    });
    return changed ? { ...node, content: next } : node;
  };
  const result = walk(doc);
  return { doc: result, count, skippedInHeadings, skippedInTitle };
}

/** Concatenate all text in a node tree (for presence checks). */
export function nodeText(node: PMNode): string {
  if (node.type === "text" && typeof node.text === "string") return node.text;
  const children = node.content as PMNode[] | undefined;
  if (!Array.isArray(children)) return "";
  return children.map(nodeText).join("");
}

/** Flatten a Tiptap JSON doc into readable plain text for model context. */
export function extractPlainText(contentJson: string): string {
  return tryExtractPlainText(contentJson) ?? "";
}

/** Preserve parse/traversal failure separately from successfully extracted empty text. */
export function tryExtractPlainText(contentJson: string): string | null {
  try {
    const doc = JSON.parse(contentJson);
    const top = doc.content as Array<Record<string, unknown>> | undefined;
    return (top ?? []).flatMap(plainTextLines).join("\n\n");
  } catch {
    return null;
  }
}

/** The non-empty plain-text lines one top-level node contributes to
 * extractPlainText, in order. */
export function plainTextLines(topNode: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    const type = node.type as string | undefined;
    const children = node.content as Array<Record<string, unknown>> | undefined;
    if (type === "text") {
      lines.push((node.text as string) ?? "");
      return;
    }
    if (children) {
      const before = lines.length;
      children.forEach(walk);
      // join inline children of a block into one line
      if (type === "paragraph" || type === "heading") {
        const joined = lines.splice(before).join("");
        lines.push(joined);
      }
    }
    if (type === "horizontalRule") lines.push("———");
  };
  walk(topNode);
  return lines.filter((l) => l.length > 0);
}

// ─── Banned-word scrub (chat safety net) ────────────────────────────────────
// Canonical table + implementation: shared/bannedWords.ts — the same scrubber
// the generation pipeline runs, and the same list the QA scan derives from.

export {
  scrubBannedWords,
  scrubBannedWordsUnlessWaived,
} from "../../shared/bannedWords";
