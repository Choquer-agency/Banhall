# B13 reviewed-source reproduction

Both findings confirmed in actual installed editable and read-only schemas. Command `node .audit/branch-consolidation/B13/review-probe/script.mjs` exited0 with explicit result assertions. Exit0 means both defect reproductions matched expectations, not repair success.

1. Paragraph `İİİ`, needle combining-dot + `i`: actual findOccurrencesBatch returns `{from:1,to:3,text:"İİ"}` and `{from:2,to:4,text:"İİ"}`. Folded-string matches do not overlap, but their expanded original spans overlap. This violates the per-needle non-overlapping original-range contract.
2. Paragraph `alphabeta`, then paragraph `alpha` + hardBreak + `beta`: actual findAllInDoc and actual highlightText return/store12..22 with text `alphabeta`. Actual extractMatchedText validates that range as `alpha beta`, so validation fails. Actual findTextInDoc falls back to1..10. Actual buildDecorationSet emits `ai-ref-highlight` at1..10, the wrong earlier paragraph, while highlightText requests scroll to12. This is actual function/DecorationSet execution, not only predicted control flow.

Four reviewed source files and tiptapConfig were snapshotted and hashed before notifying parent it could revert. All subsequent source evaluation reads snapshots, so later rederivation cannot affect these receipts. Installed TypeScript transpiles helper/config and AST-extracted Editor module plus exact highlightText function. Actual installed getEditorExtensions/getSchema and ProseMirror schema nodes/DecorationSet are used. Svelte mounting, browser DOM rendering, replacement persistence and final gates were not run. The duplicate Underline warning is retained separately in stderr; it did not prevent either mode's assertions.

Artifacts: `hashes.json` maps original paths to frozen snapshot names and SHA-256. `script.mjs` is the reproducer; `results.json` records full document JSON, ranges, validation, fallback, actual decorations and highlightText state/scroll calls. Snapshot names end `.txt`, not executable archived test suffixes. No canonical source/spec/ledger/refs were mutated.

Artifact SHA-256:
- `script.mjs`: `52688c7e72efb2d8b30691b8a6e986664ba0be0113b8221a54a897346689af96`
- `results.json`: `2bdc97759e42935b6d7eb2287bad668764a0b86d6580be7ccfbe8bf9c437a39c`
- `hashes.json`: `4fc6ec0c4982baa9b76f6e4d3bb3b24937a1ac070848b8b6141e4b08cb56a21d`
- `stderr.log`: `6f590ed840b4dcea9287482e5fe18a8c08b6f5f356f48e2cb6618156288e1d31`
