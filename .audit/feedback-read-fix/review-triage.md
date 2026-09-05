# Fresh feedback read repair review

Four fresh Astra6 medium context-free layers, capacity-limited waves. Blind returned two test gaps; verification repeated the earlier-turn gap; edge returned[]; acceptance returned no intent violations. Deduplication by same claim/action leaves two LOW patches, both resolved. No production finding, intent gap, spec loopback, deferred issue or ledger action.

| Finding | Disposition | Final evidence |
|---|---|---|
| Continuation can include earlier-turn text without a specific negative regression | LOW patch: seed earlier answered turn, delete target answer, retain target reasoning, assert unavailable and zero rows | chatFeedbackReadLimits.test.ts test `does not rate an earlier answer...` |
| Byte exhaustion needs both merged streams populated | LOW patch: large assistant tool-call and reasoning records exercise both streams under enforced limits; assert safe domain failure and zero rows | chatFeedbackReadLimits.test.ts test `bounds both merged...` |

SDK shared.ts20 marks assistant tool-call records tool=true; reasoning-only records are tool=false. Each persisted record is verified below1,000,000 bytes. The mixed-stream test exercises the prefetch charged by the actual installed merged stream implementation.

Final focused25/2 passes after review. Complete post-review gates retained separately with -final names. No production change occurred after the initial full successful gate; only the two meaningful regression fixtures were added. Read-only reviewers did not run tests themselves or claim deployed proof.
