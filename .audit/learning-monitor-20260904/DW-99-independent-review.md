# DW-99 independent review

Reviewed accepted story 8 `76d101671d109012438ed5fb282168872811103c` against baseline `64ee37c8d7498318232f6367b55c7f638e8b830e`, from isolated target `c3bcddd475a924780cfaf2362b0217d1d58d428d`. Accepted and target trees are identical. Full story and approved `decisions/rerank-fallback-measurement-2026-09-05.md` were read alongside all three native triages and evidence. No source, ledger, state, or native checkout edits.

## Result and structured triage

One LOW verification gap retained for patch; no production defect or additional human decision identified. Four fresh independent BMAD layers ran in capacity-limited waves: blind correctness, edge-case and acceptance returned no findings; verification returned the retained gap. Parent source review confirmed it. No duplicates, deferred findings, or dismissed claims.

**DW99-V1: capped rerank denominator selection lacks an order-sensitive regression.** `convex/learningHealth.ts:47` correctly queries ascending observed time with a 2,000-row cap. `src/routes/admin/learning/+page.svelte:129` displays the resulting rate and line 138 promises oldest-first selection. Existing capped fixture `convex/learningHealth.test.ts:332` uses only successes at identical timestamps; mixed arithmetic fixture at line 273 remains under cap with equal in-window timestamps. Thus the tests do not distinguish the promised oldest cohort from a newest cohort with a different denominator/rate. The specific proposed regression uses chronologically distinct mixed success/fallback observations beyond cap, verifies selected counts/rate and first/last timestamps, and demonstrates sensitivity to wrong ordering. This is a test gap, not evidence the current ascending implementation miscalculates. A wrong-order control was reasoned from source, not executed during this read-only review.

## Evidence and limits

Executable/test source at retained gate revision `12d2a0af4195746014b78f03f3947358e030dc9b` is identical to review target: only `.audit/story-8/evidence.md` and the deferred ledger differ. Decompressed retained `third-final-unit.log.gz` proves 1,955 tests/152 files; `third-final-component.log.gz` proves 451 Chromium tests/60 files; `third-final-check.log.gz` reports zero errors/warnings. `third-final-convex.log.gz` is empty, and native evidence records exit 0. Hashes/log tails and exact identity commands are captured in `source-and-gate-evidence.json`. No tests freshly rerun, dependencies installed, or live provider/deployed environment exercised. This does not attest root's later combined integration.

Reviewed terminal recording and idempotency, search error/skip exclusion, missing billing behavior, admin query and route guards, daily PED aggregation, provenance identity/source metadata joins, weighted candidate and versioned writer judgments, byte/count budgets, omitted-cohort disclosure, refresh/range/stale transitions and narrow-screen evidence. Explicit prospective/best-effort coverage, observational association, unavailable data, current judgments and bounded oldest-first populations remain declared limitations, not newly invented requirements. Local fixtures are not live production proof. Review-budget follow-up is performed, but DW-99 remains open pending the retained regression and root's integrated verification/disposition. No ledger closure.

The TypeScript skill was applied; its referenced type-system-discipline dependency is not installed. BMAD on_complete resolves empty. Audit-only reporting follows the explicit read-only task scope.

Durable full diff and evidence: /Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw99-review/.audit/DW-99-independent-review
