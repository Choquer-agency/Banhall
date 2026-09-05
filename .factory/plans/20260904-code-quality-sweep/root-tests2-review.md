# Independent proposal migration review

Review of the first tests-2 implementation before integration. Roster and ten access scenarios pass source mapping. Three corrections remain:

- Missing positive listProposals Manager/Admin/unrelated-writer rows. The deleted old suite has these at lines 542 and 554. Existing chatTurns creator/roleless/anonymous tests do not prove them; helper tests do not call the endpoint. Assert a real persisted proposal ID through a real thread mapping. Correct the decisions.tsv covered row by appending superseding ported rows.
- liveTurn calls sendMessage, which schedules streamChatReply via runAfter(0); convex-test runs this through real timers. Use the existing chatTurns fake-timer convention with pending-timer cleanup. Do not drain the real streaming job.
- Ordered replacement currently asserts a fragment. Assert exact final editor JSON or full prose, as AC1 requires.

The engine was stopped before accepting this migration so its existing isolated worktree can receive a bounded factory-implement fix. No production implementation may change. Existing evidence and decisions remain append-only.
