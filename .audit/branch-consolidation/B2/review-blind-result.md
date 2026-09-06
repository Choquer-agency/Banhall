- `docSearch.ts` lowercases the haystack without updating `posMap`. Unicode lowercasing can expand characters: `İ target` becomes `i\u0307 target`, shifting the indices used to locate `target`. This inherited defect can produce incorrect replacement ranges; add a regression fixture and explicitly track it if fixing Unicode behavior remains outside scope.

- `buildSearchIndex` ignores inline hard breaks. A document containing `alpha`, a hard-break node, and `beta` is indexed as `alphabeta`, permitting a false match and missing `alpha beta`. The paragraph-only test schema cannot expose this inherited limitation.

- `buildSearchIndex` also concatenates text across inline leaf atoms. A replacement range can consequently span a non-text object absent from the search phrase. Define the intended boundary behavior and test it with a schema containing an inline atom.

- The component tests never verify that previewing, clearing previews, highlighting, or searching leaves document content unchanged and emits no save. Assert against the captured `saved` callback and serialized document to protect the explicit writer-action boundary.

- The spec requires preserving the document-identity cache, but every search assertion runs against freshly seeded content. Add an edit-then-search case that checks new positions, removes stale matches, and re-resolves an existing reference after text is inserted before it.

- The duplicate-slot unit test exercises only the helper. Neither component test verifies that `findReplaceMatches` preserves different replacements for duplicate needles or maintains pair order when matches share a position. Those properties matter when a caller presents or applies the returned matches.

- Preview assertions primarily count decorations. They could pass with incorrect replacement text or widgets attached to the wrong occurrences. Assert the original text, replacement text, and placement for each pair, including the empty replacement.

- The tests omit partially overlapping needles, such as `thermal stability` and `stability under`. Identical duplicate ranges do not establish how overlapping strikes, insertion widgets, and returned replacement ranges behave.

- `replaceRange` is tested only within one plain-text paragraph, while the helper explicitly returns ranges spanning blocks. Add writer-action coverage for a cross-paragraph match and a match split across formatting marks, checking the resulting document structure as well as text.

- The benchmark hashes only decoration positions from the final iteration. It does not check replacement text, decoration attributes, or consistency across iterations, so equal hashes establish narrower equivalence than preservation of preview behavior. Validate those properties separately from the timed measurements.

- The empty-batch tests count document walks but do not verify the promised zero whole-haystack folds. Also, `findOccurrencesBatch` reads `doc.content.size` before checking whether all needles are empty, contradicting its stronger “never touches the document” documentation. Align the guard, tests, and stated contract.

- The evidence still leaves the canonical verification gate and test-discovery check pending. The later browser receipts resolve browser execution, but do not establish full acceptance. Attach the final gate results against the reviewed source hashes before marking the acceptance criteria complete.