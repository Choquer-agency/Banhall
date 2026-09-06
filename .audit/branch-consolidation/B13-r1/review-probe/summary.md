# B13-r1 review proof and complete AI writer inventory

Frozen four reviewed B13-r1 sources plus actual tiptapConfig were captured before notifying parent it could revert. `hashes.json` binds every snapshot. Probe source reads only these snapshots; parent rederivation cannot change results. Command `node .audit/branch-consolidation/B13-r1/review-probe/script.mjs` exited0 with explicit assertions in both installed editable/read-only schemas. This means reproduction succeeded, not repaired acceptance.

## Confirmed defect A: non-overlap rejection skips the next valid match

Actual paragraph six `İ`, needle `\u0307i\u0307i`: whole-string folded match candidates start at1,3,5,7. Actual function returns only `{from:1,to:4,text:"İİİ"}`. Non-overlapping original-span contract permits another `{from:4,to:7,text:"İİİ"}`. Full needle-length advance after rejecting an overlapping mapped range skips that candidate. Both actual schemas reproduce; no imaginary Unicode/schema fixture is used.

## Confirmed defect B: section paragraph selection highlights the wrong paragraph

Actual schema document: heading242, paragraph alphabeta, paragraph alpha + hardBreak + beta. Actual AST-extracted locateSectionParagraph('242',2) stores17..27 with text alphabeta and scrolls to17. Actual extractMatchedText of17..27 is alpha beta. Validation fails; actual findTextInDoc returns6..15; actual buildDecorationSet emits ai-ref-highlight6..15, the first paragraph. Results include full document, stored state, scroll, validation and decorations. This executes real functions and PM DecorationSet, not just inferred source flow; no Svelte/DOM/browser mount or report persistence was run.

## Exhaustive writes to Editor aiHighlights

Inventory is from frozen Editor.svelte; all textual references were checked. No additional writer, alias mutation or hidden callback assignment was found.

| Frozen line | Writer | Producer / live call sites |
|---|---|---|
|630|state initialization `[]`|Component initialization; no range producer.|
|794|mousedown handler clears `[]`|Installed on actual editor DOM at797; only clears when clicked target is inside ai-ref-highlight.|
|987|highlightText assigns ranges|Uses findAllInDoc; AgentChatPanel onReferenceText wired in CurrentProjectPage1379 and PreviewProjectPage1750. Includes exact/fragment/paragraph fallback outputs; all must obey same extraction convention.|
|1016|locateSectionParagraph assigns target|Uses paragraph node.textContent, newly proven inconsistent. CurrentProjectPage439–440→QA onLocateGap1347; PreviewProjectPage515–516→onLocateGap1714.|
|1021|clearHighlight assigns `[]`|Replace-session finalization CurrentProjectPage340 and PreviewProjectPage416; clearing only.|
|1051|highlightRange assigns supplied range|findReplaceMatches outputs first/next matches. CurrentProjectPage313/395; PreviewProjectPage389/471. Producer uses docSearch extracted text and actual bounds.|

At769 the decoration effect reads aiHighlights and passes it to buildDecorationSet with doc-identity caching; it is not a writer. previewProposal/clearProposalPreview write preview state, not aiHighlights. scrollToPosition/getYForPos support comment/position behavior and do not write this state; their separate validation is outside the changed AI validator. Preserve it.

CurrentProjectPage1264 and PreviewProjectPage1614 bind the actual editable Editor reference. CandidateSelection141 also calls a method named locateSectionParagraph, but its ref is explicitly ReadOnlyEditor at136/326. ReadOnlyEditor owns a separate highlight implementation/state and does not flow into changed Editor buildDecorationSet. Do not misclassify that caller as a fourth writer or alter it without separate scope/evidence. Running the frozen helper against getEditorExtensions({editable:false}) proves schema parity only, not mounted ReadOnlyEditor execution.

`caller-hashes.json` pins the four live caller/module files read for this inventory. The reviewed-source defect proof itself is fully bound to `hashes.json` snapshots. Parent owns spec amendments, implementation, fresh review and final acceptance; no source/spec/ledger/refs changed here.

Evidence hashes:
- `script.mjs`: `5b29409676a370d1e6f372595af0463b65eeac71eda7dfa38c851f1c3c43419c`
- `results.json`: `80261d11f6fef3f33c885477e1117501f5d02d106f17d88bc7723e9e2fc1e761`
- `hashes.json`: `09547b98277b39f453cba5c36bdbfb8a6aa12e32c689aa32c914c673452ca24a`
- `caller-hashes.json`: `10b6a7225972e820b95c5bc2a6384f60ee72155f0a8a91dea9668a23b92d51e1`
- `stderr.log`: `6f590ed840b4dcea9287482e5fe18a8c08b6f5f356f48e2cb6618156288e1d31`
