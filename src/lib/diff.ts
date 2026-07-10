/**
 * Exact word-level diff for the proposal track-changes view. Whitespace is a
 * first-class token so both sides can always be reconstructed character for
 * character from the returned parts.
 */
export type DiffPart = { type: "equal" | "removed" | "added"; text: string };

export type TextReplacement = { find: string; replaceWith: string };
export type ProposedTextChange = { before: string; after: string };

export function proposedTextChanges(
  targetText: string | undefined,
  newText: string | undefined,
  replacements: readonly TextReplacement[] | undefined
): ProposedTextChange[] {
  if (replacements?.length) {
    return replacements.map(({ find, replaceWith }) => ({
      before: find,
      after: replaceWith,
    }));
  }
  return targetText === undefined
    ? []
    : [{ before: targetText, after: newText ?? "" }];
}

export function diffWords(oldText: string, newText: string): DiffPart[] {
  if (oldText === newText) {
    return oldText ? [{ type: "equal", text: oldText }] : [];
  }

  const a = oldText.match(/\s+|[^\s]+/g) ?? [];
  const b = newText.match(/\s+|[^\s]+/g) ?? [];
  const n = a.length;
  const m = b.length;

  // Guard pathological sizes — fall back to an exact whole-block replacement.
  if (n * m > 400_000) {
    return [
      { type: "removed", text: oldText },
      { type: "added", text: newText },
    ];
  }

  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  return parts;
}
