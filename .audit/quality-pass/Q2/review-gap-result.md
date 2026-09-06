### Normal verification does not detect historical screenshot writes

- **Changed surface:** Screenshot destinations move into ignored outputs at `src/lib/components/chat/OptimisticSend.component.test.ts:61` and `src/routes/admin/learning/LearningHealth.component.test.ts:102`, plus their sibling captures.
- **Impacted consumer or site:** The canonical browser gate at `scripts/loop-verify.sh:122`.
- **Existing test evidence:** **Regression gap.** The chat test asserts rendered messages and send state; the learning test asserts metrics and layout. Both await screenshots without checking filesystem preservation. The gate and CI workflow contain no post-run artifact checks. The admitted before/after evidence supports the recorded candidate run, but those checks are not part of normal verification.
- **Missing verification:** A recurring check that captures leave tracked historical bytes unchanged and produce fresh files in the intended ignored locations.
- **Demonstration:** Reverting the chat destination at line 61 to `.audit/story-7/optimistic-after.png` would still allow its screenshot and UI assertions to pass. The checked gate would not detect the historical write.
- **Consequence:** Verification can pass while overwriting historical evidence again.