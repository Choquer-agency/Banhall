# Execution review findings

## Open: PERF1-PROOF-1, sequential PDF fixture timing

Independent source review by audit_performance and root at worktree commit 77825a2 found `src/lib/parseDocument.test.ts:225-246` creates both `after(20_000, ...)` promises before parsing begins. Thus document load and page text delays run concurrently, and page 2 starts at t=20s, despite the comment and ticket AC2(a) claiming t=40s. The test still catches restarting the per-call deadline, and no production timer or search defect was found. Correct the fixture by starting the page text timer lazily when getTextContent is called, or explicitly resolve deferred page text at t=40s; assert the phase timing and keep the 59,999/60,000 boundary and zero-timer checks. Preserve the real baseline-failure/head-pass evidence. This finding remains open until the corrected actual fixture is run and recorded. The factory review/QA for perf-1 is still pending; if it does not catch and fix this, schedule a narrow follow-up before declaring the sweep complete.

## Resolved locally: QA evidence write and deferred metadata preservation

QA could not append its report under its tool allowlist. The engine saved the full structured result as root `.audit/perf-1-parser-timers-editor-index/qa-0.md`; the orchestrator appended a reference and limits to root evidence, so no user action is needed. The engine merge also retained the integration copy of the ticket and discarded the implementer's four `deferred` entries. Restored those entries from actual commit 77825a2 into the canonical done ticket. Their planned resolutions (UI failures, duplicate Underline) remain pending respective tickets. Preserve source-side deferred entries at subsequent merges as needed; do not alter the external factory engine in this sweep.

## Applied to pending tickets: engine-persisted QA report

For tickets not yet started, added run-specific QA output guidance: return the full report through the structured fields the engine already persists, instead of repeatedly attempting audit-file writes denied by the existing tool allowlist. No permissions or verification requirements changed. Active perf-2 was excluded because its worktree and scope were already loaded. Root will link canonical QA outputs into evidence after each merge.
