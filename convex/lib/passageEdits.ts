import { applyReplacements, type PMNode, type ReplacePair } from "./reportEdits";

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
    if (!pair.find.trim() || pair.find === pair.replaceWith ||
        applyReplacements(doc, [markedPairs[i]]).count !== 1) {
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
  return { ok: true, ...restored };
}
