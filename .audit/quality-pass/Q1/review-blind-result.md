- The “invalid attempt rolls back duplicate orphan cleanup” test does not establish that cleanup executes before rejection. If attempt validation rejects first, it proves early validation only. Add a failure triggered after storage deletion and verify that the blob survives transaction rollback.

- `deleteDocument` now removes the database row before attempting storage deletion, but no test exercises a storage-deletion failure. Verify that such a failure restores the document row as well as preserving storage state.

- The evidence explicitly reports already-deleted storage during the baseline lifecycle test, but the fix does not demonstrate recovery for records whose bytes were lost previously. Add a missing-blob regression and define whether deleting such a document should succeed or reject.

- Each reference-field regression creates one protective reference independently. Add a lifecycle case with simultaneous references across tables, removing them successively, to verify that early returns do not conceal premature reclamation when protection passes to another field.

- Maintenance coverage omits the case where several discarded rows share a blob that the retained row does not reference. Verify that cleanup preserves the blob while another discarded row still references it and reclaims it after the final removal.

- The new duplicate-upload tests omit resubmission of the retained document’s own storage ID. Explicitly verify the `dup.storageId === args.storageId` branch preserves bytes and resolves the upload receipt correctly.

- The new suite does not cover duplicate backfill when the retained document has no storage ID and the supplied blob already belongs to another record. Verify that attaching this shared reference and subsequently deleting either document preserves the other document’s bytes.

- The unauthorized-deletion test accepts any thrown error. An unrelated runtime failure could satisfy it. Assert the expected access-denial error so the test demonstrates authorization enforcement specifically.

- The helper’s bounded individual lookups do not bound maintenance’s total work: every discarded row can add four queries, including repeated checks for the same blob. Add representative batch-limit coverage and consider consolidating checks for repeated storage IDs after removing the discarded references.

- Canonical verification remains explicitly pending. Focused tests and the Convex typecheck do not establish that the required `bash scripts/loop-verify.sh` gate passes; retain that result before treating this change as accepted.