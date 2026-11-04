import {
  PARAGRAPH_BREAK,
  applyReplacements,
  changesParagraphs,
  keepUnchangedParagraphs,
  type ReplaceOptions,
  headingEditRefusal,
  normalizeForMatch,
  type PMNode,
  type ReplacePair,
} from "./reportEdits";

/** Separate passage rewrites must have unique, independent targets. */
export function applyPassageEdits(doc: PMNode, pairs: ReplacePair[], options: ReplaceOptions = {}):
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
    // Review 2026-11-03: a passage that adds, splits or merges paragraphs
    // must still be one whole paragraph of the current report.
    if (options.paragraphs && PARAGRAPH_BREAK.test(pair.replaceWith) && !changesParagraphs(doc, pair)) {
      return { ok: false, reason: "Adding, splitting or merging paragraphs needs whole paragraphs: copy each paragraph in full, exactly as the CURRENT REPORT has it." };
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
  })), options);
  // Review 2026-11-03: every passage must land, and no marker may stay in
  // the report (a paragraph pair restores only over a whole paragraph).
  const text = JSON.stringify(restored.doc);
  if (restored.count !== pairs.length || markedPairs.some((pair) => text.includes(pair.replaceWith))) {
    return { ok: false, reason: "The report changed where this suggestion applies. Ask the assistant to make it again." };
  }
  const doc_ = options.paragraphs ? keepUnchangedParagraphs(doc, restored.doc, pairs) : restored.doc;
  return { ok: true, doc: doc_, count: restored.count };
}

/**
 * The passages of one proposeEdit call (owner, 2026-10-21). A target inside
 * one paragraph is one passage, as before. A target of several paragraphs,
 * such as a trim across a whole Line, never matched anything: the model fell
 * back to one call per paragraph and the writer got four cards. Now each
 * paragraph pairs with the matching paragraph of the new text, so the change
 * lands as one card; unchanged paragraphs are dropped.
 *
 * 2026-11-03 (owner): the new text may hold more or fewer paragraphs than the
 * target, so a card can add, split or merge paragraphs. Then the target must
 * be whole paragraphs (`applyReplacements` acts on a whole paragraph only).
 * Paragraphs pair in order; the last target paragraph takes any extra new
 * paragraphs (a split, or paragraphs added after it), and target paragraphs
 * left over once the new text runs out are removed (a merge).
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
  if (targets.length === 0) return { ok: false, reason: "targetText is empty." };
  if (replacements.length === 0) {
    return { ok: false, reason: "newText is empty. To remove a paragraph, merge it: target it with the paragraph it joins and give newText the joined paragraph." };
  }
  const last = targets.length - 1;
  const paired = targets.map((find, i) => ({
    find,
    replaceWith:
      i < last
        ? (replacements[i] ?? "")
        : replacements.slice(last).join("\n\n"),
  }));
  // A paragraph the model retyped with straight quotes or plain dashes is
  // unchanged, not an edit that silently swaps the report's typography.
  const pairs = paired
    .filter((pair) => normalizeForMatch(pair.find) !== normalizeForMatch(pair.replaceWith));
  if (pairs.length === 0) return { ok: false, reason: "newText is the same as targetText, so nothing would change." };
  return { ok: true, pairs };
}
