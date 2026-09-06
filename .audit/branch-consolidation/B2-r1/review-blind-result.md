- `docSearch.ts`: Lowercasing the haystack can change its UTF-16 length while `posMap` remains unchanged. For example, `İ abc` becomes `i̇ abc`, shifting subsequent lookups and producing incorrect replacement ranges. This inherited limitation is explicitly deferred, but needs a regression fixture and a tracked follow-up.

- `buildSearchIndex`: Inline `hardBreak` and other non-text leaf nodes contribute no separator, allowing text on opposite sides to become a false contiguous match. Add fixtures documenting the deferred behavior so extraction does not silently change it.

- `Editor.component.test.ts`: No test searches again after a document edit. Search once, insert text before the match, then repeat preview and find/replace to verify the promised document-identity cache behavior and updated positions.

- `Editor.component.test.ts`: Preview tests cover setting and clearing one batch, but never replacing an active preview with another batch. Verify that changing needles or replacement text removes obsolete strikes and widgets.

- `Editor.component.test.ts`: Empty and all-blank batches are tested for `findReplaceMatches`, but not for `previewProposal`. Add actual-caller coverage for their traversal cost, rendered output, and behavior when a preview already exists.

- `Editor.component.test.ts`: The rendered casing assertion examines two identical lowercase `"thermal stability"` occurrences. It does not establish the comment’s claim about differing casing. Preview a phrase containing `"The system"` and `"The System"` and assert the resulting widget text.

- `Editor.component.test.ts`: Decoration counts and selected text checks do not verify that each insertion widget appears beside its intended occurrence. Assert widget placement and replacement identity per occurrence, especially for duplicate needles with different replacements.

- `docSearch.test.ts`: The schema contains only unmarked paragraph text. Add matches spanning differently marked text nodes and nested list blocks to verify position mapping against structures the actual editor produces.

- `docSearch.test.ts`: All-blank cases assert zero document walks but never assert zero haystack case-folds, although both are part of the acceptance contract. Exercise both counters for empty and all-whitespace batches.

- `countHaystackFolds`: Identifying the haystack solely by string length can count a same-length needle as a haystack fold. Make the instrumentation distinguish the actual haystack and include a needle whose length equals the document text length.

- `findOccurrencesBatch`: Duplicate normalized needles still repeat the full substring search and matched-text extraction. Reuse results within a batch while preserving input slots and distinct replacement identities at the callers.

- `buildDecorationSet`: Batching now materializes every pair’s match objects before decoration construction, whereas the previous loop consumed one pair at a time. Add a dense-match benchmark to measure peak memory and latency; the current unique-label fixture does not exercise this allocation change.

- `scripts/bench/editor-search.mjs`: The position hash captures only the final iteration and only `[from, to]`. It cannot detect changed replacement text, decoration attributes, or incorrect pair association. Include a deterministic semantic signature alongside the position hash.

- `scripts/bench/editor-search.mjs`: Stripping all imports and injecting every helper export bypasses the actual import wiring. The benchmark could still succeed with a missing editor import. Bind only the helpers explicitly imported by the extracted module, or validate those bindings before execution.

- `scripts/bench/editor-search.mjs`: The unrelated parser appendix can fail the editor benchmark when parser declarations move, even if editor search remains valid. Separate the measurements so parser extraction changes do not block editor performance verification.