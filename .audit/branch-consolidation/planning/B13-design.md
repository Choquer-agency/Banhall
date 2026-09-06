# B13: offset mapping and narrow leaf extraction design

Read-only implementation-design check, 2026-09-05. No source, frozen spec, ledger or runtime changes; no tests executed. Read current restored B2 helper, its cost tests, actual getEditorExtensions configuration and installed ProseMirror/Tiptap sources. This supplements the parent-owned draft; it does not amend approved intent.

## Minimal mapping shape

Keep the existing one document traversal and normalized, not-yet-lowercased `hay`. Retain original UTF-16 position information for each normalized code unit. Add a mapped exclusive end (or derive it while constructing the folded map); `to = start + 1` is insufficient for a supplementary code point or lowercase expansion.

After indexing, call `hay.toLowerCase()` once on the complete normalized string. This exact whole-string result remains the searchable haystack. Do not produce searchable text by joining individually lowercased code points: Greek capital sigma becomes final sigma only in context, including across adjacent differently marked text nodes.

Construct folded offset maps in a second linear pass over the normalized string by Unicode code point, maintaining a UTF-16 source cursor:

1. Determine the original PM span from the first and last UTF-16 units of that code point. Map every output unit belonging to it to that whole span, including both surrogate units and all lowercase expansion units.
2. Use independent code-point lowercase **length only** to advance the folded cursor when expansion exists. Never substitute its characters for whole-string output. Default non-locale lowercase's contextual final sigma substitution is length-preserving, so this retains its contextual output while handling `İ` expansion.
3. Reuse known lengths on the equal-length fast path; still map full supplementary-code-point spans. On expansion paths, reuse the already folded string's length for a one-code-point haystack rather than lowercasing that entire haystack twice. Per-code-point length work remains linear, not per needle or per prefix.
4. Require final cursor/map length to equal the authoritative whole-string lowercase length and every map span to be defined and ordered. Do not quietly return shifted matches if that invariant fails. Tests should cover the supported runtime's contextual cases; this design does not claim locale-specific Turkish/Lithuanian casing support.

Search remains the existing normalized needle's whole-string lowercase against the authoritative folded haystack. A matched start uses the start map and the last matched unit uses the exclusive-end map. Thus a hit containing an expansion or supplementary character selects complete original characters, and an ASCII target after `İ` stays at3..9. No per-needle traversal, prefix folding, locale conversion or schema extension is needed. Existing exported buildSearchIndex consumers/tests should be checked before changing its return shape; adding a narrowly named mapped-end field or keeping folded mapping internal is safer than changing the meaning of the current raw posMap silently.

The existing whitespace position map uses the next real character for a collapsed separator. Trimmed needles do not begin/end with that separator; preserve this convention. Adjacent differently marked text nodes must not create a false boundary, and sigma context must use their joined normalized hay. Avoid splitting supplementary pairs when walking UTF-16 strings; derive code-point spans from the joined normalized hay and original maps, rather than assuming each text node independently contains complete code points.

## Supported hardBreak indexing

In the existing descendants callback, handle exactly `node.type.name === "hardBreak"` by setting the same pending separator state used for whitespace/block boundaries, only after content exists. Repeated hard breaks and surrounding whitespace collapse into one separator. Leading/trailing breaks do not introduce searchable padding. Keep horizontalRule and other block processing unchanged. The actual schema exposes no custom non-text inline node besides hardBreak, so no generic atom replacement is warranted.

This prevents `alpha` + hardBreak + `beta` matching `alphabeta`; `alpha beta` matches range1..11. Returned text should represent hardBreak as a single space, matching the parent draft and existing block-separator extraction. No downstream replacement safety requirement mandates a newline; preserve ordinary casing and mapped range accuracy.

## Exact installed extraction API and safe callback

Installed `node_modules/prosemirror-model/src/node.ts:99–106` declares fourth argument `string | null | ((leafNode: Node) => string)`. `fragment.ts:54–68` calls it for **every non-text leaf**, not just inline nodes. If a callback is provided, the default `node.type.spec.leafText` fallback is bypassed unless the callback explicitly preserves it.

Use the supported narrow equivalent:

```ts
doc.textBetween(from, to, " ", (leaf) =>
  leaf.type.name === "hardBreak"
    ? " "
    : leaf.type.spec.leafText?.(leaf) ?? ""
);
```

Do not use blanket fourth argument `" "` or `"\n"`. Current getEditorExtensions enables horizontalRule (`src/lib/tiptapConfig.ts:29–33`); its extension is a block leaf (`node_modules/@tiptap/extension-horizontal-rule/src/horizontal-rule.ts:36–45`). Giving it text also changes ProseMirror's block-separator bookkeeping: a paragraph, horizontalRule, paragraph can gain additional spaces compared with existing extraction. The callback above leaves that leaf empty, preserving previous behavior, while preserving any existing spec leafText for other nodes.

Tiptap hardBreak defines `renderText() { return '\n' }` at extension-hard-break/src/hard-break.ts:63. However core `getSchemaByResolvedExtensions.ts:148–155` assigns renderText to `schema.toText`, not ProseMirror `leafText`; this explains why ordinary PM textBetween omitted it in the actual probe. Do not assume Tiptap's renderText automatically fixes PM extraction.

## Focused implementation proof required at dispatch

- Retain actual-schema pre-fix failures from the same new tests: Unicode target shift/loss and hardBreak concatenation; both editable modes.
- Exact expansion-span tests, including a match containing `İ`, ASCII following it and a one-character document; supplementary character boundaries before/within matches.
- Whole-string sigma fixtures in word-final and nonfinal contexts, including text split by marks; results must equal authoritative whole-string casing, not isolated-character output.
- HardBreak, repeated hardBreak and whitespace/block controls; matched text must include a single space for hardBreak. Paragraph/horizontalRule/paragraph text extraction must remain unchanged, so a broad leaf override is regression-sensitive.
- Existing B2 empty-input, one traversal, one whole-haystack fold and actual caller cost tests remain. Current helper's countHaystackFolds at docSearch.test.ts:165–178 counts calls whose receiver length equals full hay length; avoid an accidental second whole-haystack fold in the single-code-point edge case.

Parent/worker must validate implementation and source identities with fresh focused evidence. This document proposes the bounded algorithm; no successful runtime mapping repair is claimed here.


## Caller reconciliation: corrected recommendation and discovered inconsistency

The earlier newline recommendation described literal visible line-break text, but it was not required by any replacement consumer. The parent draft explicitly chooses a single space. Source inspection supports that normalized choice; the callback and extraction guidance above are corrected accordingly. No frozen/canonical spec was edited.

Actual downstream paths:

- `Editor.svelte:1024–1040` findReplaceMatches forwards mapped bounds and matched text; smartCaseReplace at199–211 only inspects the first ASCII letter's capitalization. Space versus newline does not alter that decision.
- `Editor.svelte:1043–1045` replaceRange calls insertContentAt with from/to and the proposed replacement string. It does not search for or serialize matched text during replacement.
- `CurrentProjectPage.svelte:305–313,392–425` and matching PreviewProjectPage:381–389,468–501 select, highlight and replace using those bounds. Session finalization at CurrentProjectPage:337–361 passes captured document JSON and revision to markApplied, not matched text. Thus replacement correctness depends on mapped positions and the actual document, not whether Range.text uses a space/newline.
- CurrentProjectPage:1440 and PreviewProjectPage:1822 display matched text in ordinary inline markup; these are not preformatted newline-sensitive serialization consumers.

**Concrete source contradiction to address before B13 acceptance:** `Editor.svelte:1048–1051` highlightRange stores returned matched text in aiHighlights. buildDecorationSet at464–480 validates that text using existing `doc.textBetween(from,to," ")`, which still omits hardBreak. A correct new range with text `alpha beta` therefore differs from its old extracted `alphabeta`. The fallback findTextInDoc at215–258 likewise obtains fullText without hardBreak; it cannot find either `alpha beta` or `alpha\nbeta` in `alphabeta`, so the decoration is dropped. Choosing newline does not fix this.

Recommend parent permit the narrow Editor.svelte AI-range validation to share hardBreak-only extraction with docSearch and require an actual `findReplaceMatches` → `highlightRange` browser regression that observes the cross-break ai-ref-highlight. Preserve comment/proposal/publication behavior and current caller cost tests. Do not simply add hardBreak text to the legacy fallback without updating its position map: it currently maps only text units and block separators, so such an isolated extraction change would introduce offset mismatch there. Parent should scope any necessary drift fallback work explicitly; this read-only check has not implemented or run it.

This contradiction was established by tracing current source, not a new runtime reproduction. The existing actual-schema diagnostic proves the old hardBreak omission; a mounted caller failure/passing test remains required for the integration change.
