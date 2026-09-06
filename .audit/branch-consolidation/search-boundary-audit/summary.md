# Actual-schema search boundary diagnostic

Read-only source diagnostic, 2026-09-05. `node .audit/branch-consolidation/search-boundary-audit/probe.mjs` exited 0. This is successful diagnostic execution, not passing search correctness: four edge fixtures fail their expectations in both editor modes; the ordinary control passes. No browser, full gate, dependency installation or source mutation.

The probe transpiles the actual current docSearch and tiptapConfig files with installed TypeScript, invokes installed `getEditorExtensions({editable})` and `@tiptap/core.getSchema`, constructs schema-valid ProseMirror documents and calls actual exported search functions. It also AST-extracts only normalizeForMatch/buildSearchIndex/findAllOccurrencesCI from pre-B2 Editor at `cc6b706c3b43f971d944cb703a4174eabf3134d9`. Every current result equals that baseline result exactly. Source hashes before/after match. This establishes inherited provenance, not a new batching regression.

## Confirmed: Unicode lowercase expansion corrupts mapped ranges

Actual paragraph `İ target tail`, needle `target`:

- Expected ProseMirror range `{from:3,to:9,text:"target"}`.
- Both current and old helper return `{from:4,to:11,text:"arget t"}`.
- With paragraph `İ target`, the same expected target at3..9 returns no match.
- Control `A target tail` returns the correct3..9 target.

`İ`.toLowerCase() expands to two UTF-16 code units (`i` plus combining dot), while buildSearchIndex's posMap still describes the original one-unit character. findOccurrencesBatch lowercases the complete haystack after constructing that map and uses expanded indexes against unexpanded positions. This is a concrete false range/lost match for an ASCII needle; no decision about Turkish locale matching is required to demonstrate it. The pending-whitespace mapping can further extend the incorrect end to the next real character, as captured in raw index/range output. Both editable and read-only extension schemas reproduce it.

## Confirmed: supported hardBreak silently concatenates words

Actual schema paragraph contains text `alpha`, hardBreak, text `beta`. Nodes pass `doc.check()`. Logical visible text with leaf separator is `alpha\nbeta`; positions are alpha1..6, hardBreak6..7, beta7..11.

- Search `alphabeta` incorrectly returns range1..11 with text `alphabeta` in both old/current helpers. There is no uninterrupted word alphabeta in the document; the range crosses a real hard break.
- Search `alpha beta` returns no match. Under the existing whitespace/boundary normalization convention, the expected span is1..11. The fixture records logical text `alpha\nbeta`; that is not a proposed new public Range.text serialization policy. Any repair should explicitly preserve or adjudicate actual-text extraction separately.

buildSearchIndex handles text and textblock boundaries but ignores the inline hardBreak node. Therefore the false positive exists independently of a decision about whether searches should span a hard break. The helper's doc.textBetween call also omits leaf text, explaining why returned text conceals the break. No persistence or actual writer replacement was executed by this diagnostic.

## Refuted unsupported generalization

Installed editable and read-only schemas expose only `text` and `hardBreak` as inline node types. ProseMirror reports both as atom/leaf, but text is already handled. No mention/image/custom inline atom is configured by actual getEditorExtensions. A broader inline-atom failure claim requiring a fabricated schema is not supported by this application. The concrete inline-node bug is hardBreak above.

## Evidence and limits

`results.json` contains both complete schema-valid fixture JSONs, actual index/posMap, expected and returned ranges/text, baseline comparison and source identities. `probe.mjs` is the reproducible actual-function extraction harness. `stderr.log` honestly retains the duplicate Underline warning from current configuration, separately planned B5; it did not prevent schema construction or invalidate the comparisons.

This diagnostic proves helper behavior on the application's actual installed schema, not mounted Editor DOM behavior, user interaction, persisted report replacement or final integrated acceptance. Matching semantics are inherited; parent owns whether to remediate them within the approved integration scope and all implementation/review decisions.

Source hashes (identical before/after):
- `src/lib/components/editor/docSearch.ts`: `e49adbce3a1c258ce283cbcbfb7c7e0022f32940e6b3a8c20ee232800ee6774b`
- `src/lib/components/editor/Editor.svelte`: `01b9aea3d1af126040690275dc3474e38fbf3bdba1d37ad22e000ab4e0964bce`
- `src/lib/tiptapConfig.ts`: `aeda054d505e409986b73b9e3bf0e965b5050e656c8e50a84459eb0ddd6ad104`

Evidence hashes:
- `probe.mjs`: `68ff51a14231e862821f1d3a0f8b6f306c7097cc24f571769b5a821ded47201d`
- `results.json`: `d4684b0b3359e7327f24436885c564594ff07f823c6cb8219c5631eeb8eab761`
- `stderr.log`: `6f590ed840b4dcea9287482e5fe18a8c08b6f5f356f48e2cb6618156288e1d31`
