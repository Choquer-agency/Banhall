# DW-92 current supplied-spec review

Entry revision: `54a898d44878bf911eec5fb70777982eae43efde`. Workflow comparison baseline: `86a43d9d500ceab34245744d223d4453eba7b667`. Four independent reviewers read the complete retained `review.diff` and untracked inventory. The fourth started when a slot became available, before triage. Parent inspection also read the original frozen matrix, approved amendment, shared findings service, canonical extraction, stale completion storage and publish boundary. Previous reports remain historical.

## Independent findings and disposition

| Finding | Disposition |
| --- | --- |
| Blind 1 / edge 1: wrapped first block borrows unrelated because from inline ancestry | High patch: block entry/exit boundaries with registered baseline reproduction and repaired gates. |
| Blind 2: horizontalRule fails to separate uncertainty and unrelated explanation | High patch: preserve explicit separator, registered regression. |
| Blind 3: block classifier recreated for every child | Low patch: hoist classifier during traversal repair. |
| Blind 4: stricter nested-block handling lacks positive controls | Medium patch: same-block valid explanation coverage. |
| Blind 5: fixtures do not split inside marker/because tokens | Low patch: token-fragment positive/negative controls. |
| Blind 6: source snapshot does not hash installed dependencies in full | Reject, medium: runtime source identity is not a claim of hermetic dependency identity. Current verifier additionally records installed lock and resolved executables. Full node_modules immutability is not required by the frozen intent; no dependency edits occur in this repair. |
| Blind 7: tool/environment snapshot detached from gates | Low patch: current verifier records resolved executable hashes, versions, installed lock and safe environment-control hashes before/after each gate. |
| Blind 8: execution interval not validated | Low patch: current checker requires ordered start/end intervals after entry and before verification time. |
| Blind 9: older mutation artifacts lack full source identity | Reject, low: historical proof stays explicitly historical and is anchored by prior commits. Current repair records its own exact red/green input identity; older observations are not promoted to current evidence. |
| Blind 10: old native provenance checker accepts insufficient close event binding | Reject, low: this invocation stages no ledger modification and makes no new native-close provenance assertion. It checks all ledger and sprint bytes/index directly against entry. Existing close provenance remains historical; native acceptance remains subsequent orchestrator work. |
| Blind 11: terminal fields may be empty | Low patch: current checker requires nonempty separately parsed fields and the current manifest pointer. |
| Intent: snapshot has no current terminal result | Low patch: preserve entry snapshot and emit one current result after actual verification. |

Verification-gap reviewer: no verification gaps found. Intent auditor identified compatible bounded repair, fresh verification and flat native hand-back readings. No product-policy expansion; accepted structural title interpretation and sentence-level/exact-content limitations remain. Existing methodology, stale-result, writer and cleanup tests are rerun, not claimed as newly implemented.

Counts: intent_gap 0, bad_spec 0, patch 9 (high 2, medium 1, low 6), defer 0, reject 3 (medium 1, low 2). Follow-up recommendation true, medium/low score 9. Final repair/gate evidence is recorded in evidence.md after commands finish.
