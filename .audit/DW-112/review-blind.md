- `convex/generations.ts:1959`: Returning only a Brief ID hides whether persistence published or adopted it. `deriveOrReuseBrief` subsequently returns `kind: "derived"` even for the losing publisher, producing an inaccurate “Derived a new Generation Brief” progress message. Propagate the publication outcome and test the recorded narration.

- `convex/generations.ts:1663`: The helper selects by creation order, while `findReusableBrief` promises `MAX(version)`. Historical races can leave a newer version-1 row after an edited version-2 row. Define the authoritative ordering, test that history, and reconcile the query with the documented contract.

- `convex/generations.ts:1958`: The adoption branch patches `generationId` without checking that its generation belongs to `projectId`. A mismatched internal call can attach another project’s Brief. Validate that relationship before stamping, with a regression asserting no changes on mismatch.

- `convex/generations.ts:1952`: The reuse check remains unreachable if `publishDerivedBrief` fails while reading its baseline. A competing publisher may already have committed the reusable Brief, yet the loser can still finish without adopting it. Add an atomic adoption attempt before baseline work or recovery after a baseline-read failure.

- `convex/ai/brief.test.ts:986`: The barrier synchronizes calls before `t.mutation`, but the installed `convex-test` transaction manager serializes their execution. This exercises stale callers, not overlapping transaction snapshots or conflict retries. Document that verification boundary and add backend evidence if conflict behavior is part of the claimed proof.

- `convex/ai/brief.test.ts:1028`: The concurrent regression checks IDs and row counts without verifying the winning payload. It could miss a Brief whose owner, storyline, and citation source come from different publishers. Assert that these fields consistently match one publisher and that the other publisher’s payload was discarded.

- `convex/ai/brief.test.ts:1116`: The invalid excerpt does not prove citation processing was skipped: validation can read the source, reject the candidate, and still return the existing Brief without changing either snapshot. Add read instrumentation or a constrained transaction budget to verify the promised absence of candidate-source reads.

- `convex/ai/brief.test.ts:959`: Both new reuse tests operate within one project. They do not protect the project component of the idempotency key. Add two projects sharing an `inputsHash` and assert that each publishes and retains its own Brief.

- `spec-dw-112-brief-derivation-concurrency.md:27`: The unconditional promise that both generations end with the authoritative ID conflicts with an intervening writer edit. The first publisher can retain version 1 while the loser correctly adopts version 2. Define authority at each transaction’s completion and add this interleaving to the acceptance matrix.

- `spec-dw-112-brief-derivation-concurrency.md:68`: Verification lists expected results without linking the existing failing-control, focused-pass, and full-gate logs. Attach those evidence references and identify the tested revision or file hashes so reviewers can connect the checked tasks to the actual verification.