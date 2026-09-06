### Cross-break AI reference highlights can move to the wrong occurrence without failing tests

- **Changed surface:** `Editor.svelte:469` validates AI ranges using hard-break-preserving extraction.
- **Impacted consumer or site:** `highlightText` at `Editor.svelte:980`, used by `CurrentProjectPage.svelte:1379`, obtains ranges from `findAllInDoc`, which still extracts text without hard-break separators at `Editor.svelte:118`.
- **Existing test evidence:** **Regression gap.** Repository-wide symbol/reference searches located the relevant mounted tests. `Editor.component.test.ts:223` tests `highlightText` on ordinary paragraphs. The new cross-break test at line 270 calls `highlightRange` with helper-produced text, bypassing `findAllInDoc`.
- **Missing verification:** Assert that `highlightText(["alpha beta"])` highlights the paragraph containing `alpha`, a hard break, and `beta` when an earlier paragraph contains `alphabeta`.
- **Demonstration:** An in-memory probe using the repository functions and StarterKit schema returned the correct initial range `12..22`, but with text `alphabeta`. The changed validator extracts `alpha beta`, rejects that range, and the fallback selects the earlier occurrence at `1..10`. Neither mounted fixture exercises this combination.
- **Consequence:** Clicking an AI reference highlights a different passage despite locating the intended passage initially.
- **Suggested test shape:** Mount both paragraphs, invoke `highlightText`, and assert the highlighted range belongs to the second paragraph and includes its hard break.