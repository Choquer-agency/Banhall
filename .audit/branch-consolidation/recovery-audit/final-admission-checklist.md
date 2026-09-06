# Final admission mapping checklist

This snapshot joins the 63-commit recovery ledger, 124-commit factory ledger and 20-parent ancestry plan to state.json. Historical ledgers remain unchanged; this is neither a repeated semantic audit nor merge admission.

The machine-readable final-admission-mapping-snapshot.json contains every one of the 26 integration-source dispositions: 23 map to accepted batches; three remain pending. B10 owns d0669fec95d4145b3be34a6f6b2b5e76db276cc7 and 76f9aca3c973a805a32cc5466cacd11d61ca080e. B11 owns 186dc570967a0eaa388c72595376d41ba8a9b5d8, specifically requested/confirmed/failed-attempt audit labels while retaining accepted backend semantics.

Accepted B1/B12/B2/B13/B3/B4/B5/B6/B7/B8/B9 commits are enumerated with committed evidence/manifest paths and ancestry to the snapshot. B12/B13 are additional corrective prerequisites, not new historical source dispositions. A state acceptance entry and proof-file presence are structural inputs; the parent’s reviews and receipts determine actual acceptance.

Before ancestry recording:

- Record B10 and B11 accepted commits in a NEW final mapping snapshot after their reviews/gates. Verify each accepted commit is ancestral to the intended content tip. Do not reinterpret uncommitted B10 work as acceptance.
- For each of the 26 source rows, bind every required batch to its accepted commit, exact allowed source unit, parent triage/review, applicable gate and evidence archive. No pendingBatches may remain. Preserve corrected B8 assertions and B11 labels rather than relying on initial supersession descriptions.
- Verify additional B12/B13 acceptance and retain open follow-up disclosures (state currently lists DW-103/DW-104/DW-105). Branch consolidation does not imply unrelated deferred work has vanished.
- Run verify-committed-archives.py on the frozen exact content SHA. Inspect all committed manifest bytes and restored gzip hashes, not local/index membership. Require zero errors; receipt existence alone is insufficient.
- Obtain parent approval that all 20 ancestry-parent contentPrerequisites are satisfied using the final mapping. Record accepted source tree before tree-preserving ancestry reconciliation. An ancestry-only merge cannot supply a missing implementation or test.
- Run verify-final-ancestry.py after reconciliation, then again on freshly verified main after a normal ancestry-preserving PR merge. Resolve captured drift and newlyObservedRefs separately. Bind final two-job CI evidence to the actual PR head.

Keep branches/worktrees intact. Cownose’s captured commit is graph-covered; its uncommitted work remains excluded and untouched. Do not claim “all work merged” from an all-ancestors result. The final report must distinguish committed branch history, admitted useful content and excluded uncommitted work.

The existing executable graph/archive verifiers cover mechanical admission checks. No new checker claims that evidence filenames establish successful semantic review; the final per-batch acceptance matrix remains parent-owned. No tests, installs or source/ref/index changes were performed.
