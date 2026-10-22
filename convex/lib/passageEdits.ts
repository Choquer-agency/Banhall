import {
  applyReplacements,
  headingEditRefusal,
  normalizeForMatch,
  type PMNode,
  type ReplacePair,
} from "./reportEdits";

/** Separate passage rewrites must have unique, independent targets. */
export function applyPassageEdits(doc: PMNode, pairs: ReplacePair[]):
  | { ok: true; doc: PMNode; count: number }
  | { ok: false; reason: string } {
  if (pairs.length === 0) return { ok: false, reason: "No passages were supplied." };
  // Mark the original ranges before inserting new prose. Otherwise the
  // matcher's inline fallback can match the old sentence inside an appended
  // correction and apply it twice. Markers contain no letters for smart-case
  // replacement to alter, and cannot collide with any input content.
  const source = JSON.stringify({ doc, pairs });
  let markerCode = 0xE000;
  const markedPairs = pairs.map(pair => {
    let marker: string;
    do {
      if (markerCode === 0xF900) markerCode = 0xF0000;
      marker = String.fromCodePoint(markerCode++);
    } while (source.includes(marker));
    return { find: pair.find, replaceWith: marker };
  });
  for (const [i, pair] of pairs.entries()) {
    const probe = applyReplacements(doc, [markedPairs[i]]);
    // A passage whose only match is Section heading or title text: say so.
    // Text that also has one body match applies to the body passage.
    const refusal = pair.find.trim() ? headingEditRefusal(probe) : null;
    if (refusal) {
      return { ok: false, reason: `${refusal} Target the passage in the report prose instead.` };
    }
    if (!pair.find.trim() || pair.find === pair.replaceWith || probe.count !== 1) {
      return { ok: false, reason: "Each passage must identify exactly one current report location and make a change." };
    }
  }
  // Check both orders to reject overlapping original targets.
  // Reuse the editor's matching rules, including split inline text and case.
  const forward = applyReplacements(doc, markedPairs);
  const reverse = applyReplacements(doc, [...markedPairs].reverse());
  if (forward.count !== pairs.length || reverse.count !== pairs.length ||
      JSON.stringify(forward.doc) !== JSON.stringify(reverse.doc)) {
    return { ok: false, reason: "Passages overlap or affect one another. Combine overlapping changes into one passage and retry." };
  }
  const restored = applyReplacements(forward.doc, pairs.map((pair, i) => ({
    find: markedPairs[i].replaceWith, replaceWith: pair.replaceWith,
  })));
  return { ok: true, doc: restored.doc, count: restored.count };
}

/**
 * A blank line between paragraphs, as the CURRENT REPORT block prints them.
 * A match never crosses a paragraph (`applyReplacements` matches one block at
 * a time), so a target that spans paragraphs has to be split on these.
 */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;

/**
 * The passages of one proposeEdit call (owner, 2026-10-21). A target inside
 * one paragraph is one passage, as before. A target of several paragraphs,
 * such as a trim across a whole Line, never matched anything: the model fell
 * back to one call per paragraph and the writer got four cards. Now each
 * paragraph pairs with the matching paragraph of the new text, so the change
 * lands as one card; unchanged paragraphs are dropped.
 *
 * A proposal keeps the paragraph count (review 2026-10-21): text replaces
 * text inside paragraphs, so it cannot merge, split, add or remove one. A
 * blank line inside one paragraph's new text would only put a line break in
 * that paragraph, which every count downstream then reads differently.
 */
export function editPassages(targetText: string, newText: string):
  | { ok: true; pairs: ReplacePair[] }
  | { ok: false; reason: string } {
  const paragraphs = (text: string) =>
    text
      .replace(/\r\n?/g, "\n")
      .split(PARAGRAPH_BREAK)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  const targets = paragraphs(targetText);
  const replacements = paragraphs(newText);
  if (replacements.length !== targets.length) {
    return {
      ok: false,
      reason: `targetText has ${targets.length} ${targets.length === 1 ? "paragraph" : "paragraphs"} but newText has ${replacements.length}. A proposal keeps the paragraph count: give newText one paragraph for each paragraph of targetText, in the same order, separated by a blank line.`,
    };
  }
  // A paragraph the model retyped with straight quotes or plain dashes is
  // unchanged, not an edit that silently swaps the report's typography.
  const pairs = targets
    .map((find, i) => ({ find, replaceWith: replacements[i] }))
    .filter((pair) => normalizeForMatch(pair.find) !== normalizeForMatch(pair.replaceWith));
  if (pairs.length === 0) return { ok: false, reason: "newText is the same as targetText, so nothing would change." };
  return { ok: true, pairs };
}
