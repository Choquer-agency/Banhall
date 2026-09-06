---
title: Preserve current endpoint tests and recover missing authorization scenarios
type: chore
created: 2026-09-05
status: ready-for-dev
review_loop_iteration: 0
baseline_commit: PARENT_SETS_BASELINE
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="authorized BMAD integration; parent owns dispatch">

## Intent

**Problem:** Historical migration has missing cases; whole-file adoption erases newer real tests.

**Approach:** Extend five paths, map fake scenarios to persisted coverage, preserve production/runner contracts.

## Boundaries & Constraints

**Always:** User-selected BMAD supersedes generic factory engine/shipping restrictions. Work at the parent baseline; preserve main/prior batches. Read Convex guidelines. Use real rows/endpoints; helpers may use actual actor.run/t.run. Preserve research/snapshots/atomicity/permissions. Parent owns review/gate/ship.

**Ask First:** Escalate production/policy conflicts to parent; never change behavior to satisfy migration tests.

**Never:** Worker staging/commits/remotes/reviewer dispatch/installs/other-worktree/native-state changes. No product/schema/API/runner changes, fake databases, copied duplicate suite or weakened assertions. Never delete either current real proposal suite.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Reader roles | Manager/Admin/unrelated writer | Preserve existing internal read cases | Existing anonymous rejection |
| Assignment | Non-owner writer, open then completed workItem | Open entitlement applies; separate closed fixture denies | NOT_AUTHORIZED; full state unchanged |
| Attribution | Creator differs from owner; no assignment | Creator receives no prose entitlement | Typed denial/no writes |
| Wording | Same target, edited candidate | Editor/count/full event identity | Invalid target changes nothing |
| Rejection | Already applied proposal | Cannot reject | INVALID_INPUT/no writes |
| Tool creation | Actual queued sendMessage turn | Valid association saved; absent target rejected | Preserve completed/aborted stop fences |
| Replay | Same toolCallId, changed newText | Original result/wording; one proposal | No second card |
| Access/roster | Unrelated internal actor; duplicate-name IDs, anonymous/deleted users | Nullable/throwing/token parity; identity-based roster | Existing denial/null behavior |

</frozen-after-approval>

## Code Map

Only five writable paths:
- `tests/chatProposals.test.ts`: extend real fixture/state helper; Manager/Admin reads :96 already covered.
- `convex/projectAccess.test.ts`: unrelated-writer nullable/throwing/token parity.
- `convex/users.test.ts`: duplicate-name IDs, present-anonymous/deleted exclusion, authenticated listTeam.
- `tests/teamRoster.test.ts`: remove two fakes only; retain both label cases/all fallbacks.
- `tests/projectReviewAccess.test.ts`: map ten cases before deletion; retire callerless requireProjectCreator test only.
- Read-only: atomic proposal/reportAuthz, edits/snapshots, runner. Provenance `0fdcacf3f0cbaf434c2024a7fb609be88c453567`, `d9ee06235a1be9997eaf62331d98dbc7db78eb35`, `c755e003c7027135c9adf5ac3e67c617ddc7cce5`; `.audit/branch-consolidation/planning/B6.md` and B6-preflight.md map assertions.

## Tasks & Acceptance

**Execution:**
- [ ] Record actual Node/npm versions before verification; use installed repository Node24, not the non-login shell Node22. No install is needed for runtime selection.
- [ ] Capture baseline/hashes/named cases; run baseline suites. Map assertions, not old totals.
- [ ] Add non-owner writer/open revision workItem with complete schema fields; apply and assert audit tuple. Fresh closed case patches open→completed before apply; compare full denial state, never reuse an applied proposal.
- [ ] Add creator≠owner denial; manager apply→reject INVALID_INPUT; compare full state including anonymous rejection.
- [ ] Extend existing wording case with wordingEditedBy, wordingEditCount and event project/report/user IDs. Preserve target/report immutability and exact ordered replacement result/count/revision.
- [ ] Queued fixture: agentTest.register, valid actor/report, fixture provider key, fake timers before sendMessage(newThread:true). Use returned IDs; assert queued state, valid association/target rejection. Do not advance jobs; restore timers/env. Preserve running/completed/aborted cases.
- [ ] Extend tool replay with same toolCallId but different newText; assert original ID/result/wording and one row. Preserve existing identical-args replay.
- [ ] Add unrelated-writer throwing/nullable/token parity; real roster cases prove anonymous exists before exclusion. Remove mapped fakes after replacement proof.
- [ ] Retain research session/count, four ambiguity layouts, pinned/latest equality, sourceTranscriptIds, stale/deletion/anonymous and markProposalApplied coverage; hand focused proof to parent.

**Acceptance Criteria:**
- Every matrix row executes; each deleted fake assertion maps to current real proof or explicit callerless-helper retirement.
- Denials compare complete state; replay with changed wording preserves the first proposal.
- Five test paths only; both real proposal suites and edge/node assignments survive.

## Spec Change Log

## Design Notes

Literal running metadata does not prove queued sendMessage integration. The scoped fixture does without provider execution. saveProposal allows absent matching turns: do not claim mismatched-prompt rejection. Preserve valid association/stop/target checks and existing Manager/Admin read/non-owner Manager apply proof.

## Verification

**Commands:**
- Before/after: `node node_modules/vitest/vitest.mjs run tests/chatProposals.test.ts convex/chatProposals.test.ts convex/reportAuthz.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts --expect.requireAssertions`.
- Preservation: `node node_modules/vitest/vitest.mjs run convex/reportEditDistance.test.ts convex/snapshots.test.ts convex/qaBlocking.test.ts --expect.requireAssertions`.
- `git diff --check`; parent stages/maps discovery, dispatches review and runs final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`.

Retain actual commands/exits/hashes and limits in `.audit/branch-consolidation/B6/evidence.md`. No artificial product red required for test migration. Draft revision ran no tests; missing prerequisites go to parent.
