# Independent proposal migration review

Review of the first tests-2 implementation before integration. Roster and ten access scenarios pass source mapping. Three corrections remain:

- Missing positive listProposals Manager/Admin/unrelated-writer rows. The deleted old suite has these at lines 542 and 554. Existing chatTurns creator/roleless/anonymous tests do not prove them; helper tests do not call the endpoint. Assert a real persisted proposal ID through a real thread mapping. Correct the decisions.tsv covered row by appending superseding ported rows.
- liveTurn calls sendMessage, which schedules streamChatReply via runAfter(0); convex-test runs this through real timers. Use the existing chatTurns fake-timer convention with pending-timer cleanup. Do not drain the real streaming job.
- Ordered replacement currently asserts a fragment. Assert exact final editor JSON or full prose, as AC1 requires.

The engine was stopped before accepting this migration so its existing isolated worktree can receive a bounded factory-implement fix. No production implementation may change. Existing evidence and decisions remain append-only.

## Correction accepted for engine review

Commit c755e003c7027135c9adf5ac3e67c617ddc7cce5 restores all three positive endpoint actors with an actual mapped thread, turn and persisted proposal ID; isolates saveProposal scheduling with scoped fake timers and cleanup; and compares exact full editor JSON for ordered replacements. Root independently read the stable commit. Targeted38 pass; full gate140 files/1516 tests, typechecks0/0, uploader50+18; all8predicates pass. A mapping-loss negative control fails all3newreader assertions, then is restored. A separately dispatched gpt-5.5 reviewer inspected the correction trail and captured outputs without rerunning tests; no remaining flags, transcript unavailable. Current proof is .audit/tests-2-real-proposal-access-roster-tests/fix-current-proof.md. Normal independent engine review and QA still follow.
