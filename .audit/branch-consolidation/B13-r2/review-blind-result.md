- `findOccurrencesBatch` silently returns `text: needle` when extraction throws. This can disguise an invalid mapped range as a successful match. Reject the candidate or expose the failure, and test that every returned range extracts successfully.

- The Unicode tests validate expected examples but never assert the general mapping invariant: every emitted range must be within the document, have `from < to`, and preserve complete original code points. Add generated cases combining expansions, supplementary characters, marks, and boundaries.

- The “exact,” “fragment,” and “paragraph” caller tests assert the destination paragraph without establishing which lookup branch executed. A fallback could make them pass while the intended branch remains broken. Use branch-distinguishing fixtures or explicit instrumentation.

- Caller Unicode coverage primarily places `İ` before the match. Add `highlightText` cases where expansion occurs inside the exact or fragment needle, with assertions on the precise highlighted text and boundaries.

- The malformed-surrogate behavior is tested only in the helper. Since these needles deliberately select complete original characters, add a mounted preview-and-replacement test proving that the larger returned span is displayed accurately and applied consistently.

- The heading/list/blockquote test uses `block?.querySelector(...).not.toBeNull()`. If the block is absent, the expression returns `undefined`, which passes that assertion. Assert each block exists before checking its decorations.

- The tests described as covering “nested lists” contain only a single list level. Add an actual nested list fixture and verify positions, break decorations, and isolation from neighboring list items.

- Cleanup tests always clear proposal and AI decorations together. Add separate assertions that clearing a proposal preserves the AI highlight and clearing the AI highlight preserves the proposal, especially where both decorate the same hard break.

- The replacement test immediately flushes and later manually clears decorations. It does not check whether applying the replacement leaves stale strikes, insertion widgets, or AI highlights visible. Assert the intended decoration state immediately after application.

- No new test edits the document between obtaining a match and using its range. Exercise Unicode and hard-break matches after an intervening insertion or deletion to verify the existing drift-validation and fallback behavior.

- The missing-section navigation test starts with highlights already cleared. Add a missing-section request while another section is highlighted and explicitly define whether the existing highlight should remain or disappear.

- The performance receipts cover ordinary fixtures, while the new overlap-rejection loop advances only one folded unit at a time. Add an expansion-heavy fixture with long, repeatedly overlapping needles to measure the newly introduced search path.

- Exercising `getEditorExtensions({ editable: false })` verifies schema compatibility, but does not verify the independent `ReadOnlyEditor` search consumer. Record an explicit follow-up with an owner and acceptance cases for the corresponding Unicode and hard-break navigation behavior.

- The evidence explicitly leaves the full repository gate pending. Attach the final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` result against the reviewed source hashes before treating integration acceptance as complete.