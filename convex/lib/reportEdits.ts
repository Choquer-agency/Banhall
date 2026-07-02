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
  const ri = replaceWith.search(/[a-z]/);
  if (mi >= 0 && ri >= 0) {
    const ch = matched[mi];
    if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) {
      return (
        replaceWith.slice(0, ri) +
        replaceWith[ri].toUpperCase() +
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
 * BNH-27: apply find/replace pairs to a Tiptap JSON doc across ALL occurrences.
 *
 * Pass 1 walks every text node at any depth and replaces in place — this is
 * mark-preserving and handles the common case (a phrase repeated across the
 * document, e.g. third-person → first-person pronouns).
 *
 * Pass 2 is a fallback for any pair whose `find` still survives because it spans
 * multiple inline nodes (e.g. a passage broken by a [GAP:] highlight or bold
 * run). For those, we rebuild the affected block's inline text as a single text
 * node so the replacement still lands instead of throwing.
 */
export function applyReplacements(
  doc: PMNode,
  pairs: ReplacePair[]
): { doc: PMNode; count: number } {
  let count = 0;

  // ── Pass 1: per-text-node, mark-preserving, global ──
  const walk = (node: PMNode): PMNode => {
    let next = node;
    const children = next.content as PMNode[] | undefined;
    if (Array.isArray(children)) {
      next = { ...next, content: children.map(walk) };
    }
    if (next.type === "text" && typeof next.text === "string") {
      let text = next.text as string;
      for (const { find, replaceWith } of pairs) {
        const r = replaceAll(text, find, replaceWith);
        text = r.text;
        count += r.count;
      }
      if (text !== next.text) next = { ...next, text };
    }
    return next;
  };
  let result = walk(doc);

  // ── Pass 2: block-level fallback for finds that span inline nodes ──
  // Check presence on normalized text so punctuation differences don't hide a
  // cross-node match.
  const normResultText = normalizeForMatch(nodeText(result)).toLowerCase();
  const stillPresent = pairs.filter((p) =>
    normResultText.includes(normalizeForMatch(p.find).toLowerCase())
  );
  if (stillPresent.length > 0) {
    const collapse = (node: PMNode): PMNode => {
      const next = node;
      const children = next.content as PMNode[] | undefined;
      if (!Array.isArray(children)) return next;

      // A block whose children are all inline text/breaks can be flattened.
      const inlineOnly = children.every(
        (c) => c.type === "text" || c.type === "hardBreak"
      );
      if (inlineOnly && children.some((c) => c.type === "text")) {
        let text = children
          .map((c) => (c.type === "text" ? ((c.text as string) ?? "") : "\n"))
          .join("");
        let changed = false;
        for (const { find, replaceWith } of stillPresent) {
          const r = replaceAll(text, find, replaceWith);
          if (r.count > 0) {
            text = r.text;
            count += r.count;
            changed = true;
          }
        }
        if (changed) return { ...next, content: [{ type: "text", text }] };
        return next;
      }
      return { ...next, content: children.map(collapse) };
    };
    result = collapse(result);
  }

  return { doc: result, count };
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
  try {
    const doc = JSON.parse(contentJson);
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
    const top = doc.content as Array<Record<string, unknown>> | undefined;
    top?.forEach(walk);
    return lines.filter((l) => l.length > 0).join("\n\n");
  } catch {
    return "";
  }
}

// ─── Banned-word scrub (chat safety net, mirrors the pipeline scrubber) ─────

const BANNED_REPLACEMENTS: [RegExp, string][] = [
  [/\bnovel\b/gi, "new"],
  [/\bpioneering\b/gi, "new"],
  [/\brevolutionary\b/gi, "new"],
  [/\bpivotal\b/gi, "critical"],
  [/\bseamless\b/gi, "smooth"],
  [/\bsubstantially?\b/gi, "considerably"],
  [/\bsignificantly?\b/gi, "markedly"],
  [/\bunique\b/gi, "distinct"],
  [/\bgroundbreaking\b/gi, "new"],
  [/\bcutting-edge\b/gi, "advanced"],
  [/\bstate-of-the-art\b/gi, "current"],
  [/\bcomprehensive\b/gi, "thorough"],
  [/\brobust\b/gi, "reliable"],
  [/\bholistic\b/gi, "complete"],
  [/\bsynergy\b/gi, "coordination"],
  [/\bleverage[ds]?\b/gi, "use"],
  [/\bleveraging\b/gi, "using"],
  [/\bharness(?:ed|ing)?\b/gi, "use"],
  [/\brevolutioniz(?:e[ds]?|ing)\b/gi, "change"],
  [/\btransformative\b/gi, "important"],
  [/\bgame-changing\b/gi, "important"],
  [/\bfundamentally\b/gi, ""],
  [/\bparadigm\b/gi, "approach"],
  [/\becosystem\b/gi, "environment"],
  [/\bfurthermore,?\s*/gi, ""],
  [/\bmoreover,?\s*/gi, ""],
  [/\badditionally,?\s*/gi, ""],
  [/\binnovative\b/gi, "new"],
  [/\bspearheading\b/gi, "leading"],
  [/\bdelving into\b/gi, "examining"],
];

export function scrubBannedWords(text: string): string {
  let result = text;
  for (const [pattern, replacement] of BANNED_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/ {2,}/g, " ").trim();
}
