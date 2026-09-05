---
title: Await actual browser pointer media readiness
type: bugfix
created: 2026-09-05
status: in-review
review_loop_iteration: 0
baseline_commit: 3d4fe2e8794fb562f4f1fa84415359b1e5f96a8f
context: []
---

<frozen-after-approval reason="existing user authorization covers bounded hosted verification repair, tests, review and private commit without repeat approval">

## Intent

**Problem:** Required hosted Chromium CI failed before rendering WorkspaceChrome: after disabling touch emulation, an immediate fine-pointer media assertion still read false. This makes the verification gate fail before it can assess the required drawer-row sizes.

**Approach:** Diagnose actual browser media readiness across pointer emulation transitions, then synchronize setup and cleanup with the observable required state. Preserve every pointer-state and drawer-behavior assertion. Retain real baseline failure, meaningful controls, complete focused/full verification and fresh independent review.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-browser-pointer`, branch `codex/bmad-browser-pointer`, from the exact baseline. Use own npm dependencies and own rendered BMAD runtime; public placeholders only. Read TypeScript instructions before TS and frontend conventions as relevant. Keep coarse44px/fine28px expectations, row-count, visibility, close and isolation assertions. Report evidence as measured, distinguishing actual hosted failure from any local pass or diagnostic.

**Ask First:** Product changes or new behavior requirements if a production defect is actually proven. Notify coordinator with concrete evidence before broadening scope.

**Never:** Skip tests, weaken assertions, add test retries, use fixed sleeps, alter canonical configs/dependencies, change product/permission/policy/native state/ledger, run loops, modify original/root checkouts, push, merge or mutate GitHub. Do not render into original Banhall. Historical screenshots overwritten by existing tests must be restored to their exact baseline bytes, preserving a capture receipt.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Coarse setup | CDP touch enabled | Actual coarse media true and fine false before drawer assertions | Bounded readiness failure if state never arrives |
| Fine setup after coarse | CDP touch disabled | Actual fine true and coarse false before drawer assertions | Same bounded failure, no test rerun |
| Cleanup | Test leaves emulated touch state | Restore actual fine/noncoarse state before next case | Failure remains visible; do not silently swallow |
| Wrong state control | Actual browser deliberately remains opposite desired pointer | Readiness assertion cannot pass | Bounded failure proves no unconditional bypass |

</frozen-after-approval>

## Code Map

- `src/lib/components/workspace/WorkspaceChrome.component.test.ts:143-162`: paired coarse/fine tests await CDP send, then immediately assert both media queries at147-148. Drawer rendering and exact row-size/count assertions follow. Finally currently sends touch=false without checking renderer readiness. This is the only executable file expected to change.
- Same file already uses awaited `expect.poll` for actual rendered state; reuse Vitest's supported bounded assertion mechanism, not a sleep or whole-test retry. A small local helper may ensure setup/cleanup use the same two-query invariant.
- `.audit/browser-pointer/github-baseline.log`: actual unmodified hosted run33980243865 at baseline3d4fe2e,1 failure/462 successes, failure at fine-pointer readiness147 before render. Preserve raw source hash; do not describe a local pass as a reproduced failure.
- `vitest.component.config.ts`: real headless Chromium, files serial, unchanged. `npm run test:component -- src/lib/components/workspace/WorkspaceChrome.component.test.ts` is the focused real runner.
- `src/lib/components/workspace/WorkspaceChrome.svelte`, row CSS and component setup are read-only consumers. No production sizing defect has been established.
- `scripts/loop-verify.sh`: current unified9-step optional gate provides all required combined checks. Own install then Svelte sync supplies worker config; preserve all existing historical gate/ledger/source artifacts.

## Tasks & Acceptance

**Execution:**
- [x] `.audit/browser-pointer/`: preserve actual hosted failure provenance, install own dependencies, record one unmodified focused local run and bounded real transition diagnostic if needed.
- [x] `WorkspaceChrome.component.test.ts`: await actual required pointer state for setup and cleanup, preserving existing assertions and behavior.
- [x] `.audit/browser-pointer/`: demonstrate both actual state transitions and a bounded wrong-state negative control without mocking media results or changing canonical configs.
- [x] Run focused WorkspaceChrome tests and complete `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` once after the final repair; retain hashes/exits/counts and restore only generated historical captures.
- [ ] Complete fresh BMAD independent review and coordinator private finalization; retain evidence/spec and no native ledger changes.

**Acceptance Criteria:**
- Given the hosted baseline receipt, when inspected against its exact test source, then the failing assertion is identified accurately and no product failure is invented.
- Given coarse and fine pointer emulation, when the actual panel test proceeds, then both mutually exclusive media invariants are true for the intended mode and all original44/28px drawer assertions pass.
- Given the wrong real pointer state, when readiness is awaited within a bounded control, then it fails rather than masking an unavailable state.
- Given the final test-only patch, when the canonical optional gate runs, then every step passes and all other tracked product/config/dependency/archive/ledger files remain unchanged.

## Spec Change Log

## Design Notes

CDP transport completion is not evidence of renderer media-query readiness. This is an inference requiring runtime support; do not claim documentation proves a universal race. Observe the real matchMedia state and retain the original equality expectations. The production test awaits convergence, not repeated execution of its body. Shared browser cleanup is part of readiness correctness.

## Verification

- Unmodified focused real browser run; actual hosted baseline failure remains authoritative if local scheduling does not reproduce it.
- Bounded real transition/readiness diagnostic and opposite-state negative control; preserve original evidence.
- Focused canonical WorkspaceChrome suite and full `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`.
- Immutable baseline comparison and source/committed whitespace checks.
- Fresh independent BMAD review; no hosted check mutation or shipping by this worker.

## Review Findings

Four fresh Astra6 medium BMAD layers completed. Edge, verification-gap and acceptance layers found no violations. Blind review retained eight low artifact refinements and dismissed four suggestions by explicit scope/evidence triage. No executable source change is requested; final source remains the fully gated ten-line addition.

- [ ] [Review][Patch] Explain chosen readiness budget without claiming measured universal latency.
- [ ] [Review][Patch] Explicitly distinguish inferred delayed convergence from directly observed state/assertion evidence.
- [ ] [Review][Patch] Add finally restoration to the retained successor diagnostic.
- [ ] [Review][Patch] Add tolerant upper timing bound to diagnostic rejection proof.
- [ ] [Review][Patch] Remove incidental error-text dependence from successor diagnostic.
- [ ] [Review][Patch] Label Code Map references as baseline investigation.
- [ ] [Review][Patch] Remove stale pending wording from completed local gate evidence.
- [ ] [Review][Patch] Account for all spec/audit deliverables separately from executable scope.
