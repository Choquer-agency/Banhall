---
title: Bound verification worker resource use
type: bugfix
created: 2026-09-04
status: done
review_loop_iteration: 0
baseline_commit: 6cc8c41ef9b00886fd48cfb2df61d7029e55f900
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Concurrent native BMAD worktrees each launch an unrestricted Vitest worker pool. Their combined CPU and memory demand makes the source-contract scan exceed its five-second deadline despite passing under bounded execution. Verification must remain dependable without suppressing regressions.

**Approach:** Bound the standalone unit-test worker pool so the normal npm test command, including its use by the native verification script, runs with predictable resource demand. Preserve all assertions, test selection, and existing deadlines unless evidence establishes a narrowly scoped deadline change is necessary.

## Boundaries & Constraints

**Always:** Keep all current test projects, assertions and verification commands. Work only in this isolated checkout. Install its own dependencies. Preserve the existing Convex timeout. Record exact baseline and post-change command evidence.

**Ask First:** Changes to application behavior, authorization, or domain policy.

**Never:** Skip tests, loosen assertions, globally increase test deadlines, modify native engine state, use the custom parallel launcher, share generated build output, push, or alter another worktree.

</frozen-after-approval>

## Code Map

- `vitest.config.ts`: standalone config declares convex/shared/src projects. Convex already has a 30-second module-loading deadline; the top-level test config currently has no worker limit.
- `src/lib/components/ui/formControlContract.test.ts`: one synchronous test parses all Svelte sources and checks every native form field. Preserve its scanner and assertions.
- `package.json`: npm test runs vitest run directly.
- `scripts/loop-verify.sh`: native gate runs Convex tsc, svelte-check, normal npm test, and client-uploader harnesses. Preserve every gate.
- `tsconfig.json`: inherits SvelteKit generated source exclusions. This sibling worktree contains no nested native worktrees; avoid an unrelated exclusion change unless the actual verification identifies one.

## Tasks & Acceptance

**Execution:**
- [x] `vitest.config.ts`: cap workers at two in the common test config with a comment explaining concurrent native worktree resource use.
- [x] `.audit/bmad-verification-fix/`: capture baseline, normal npm test, complete native gate, and review evidence.

**Acceptance Criteria:**
- Given installed dependencies in this worktree, when normal npm test runs, then every existing test project runs and passes without a scanner timeout.
- Given the existing native script, when bash scripts/loop-verify.sh runs, then every gate passes without test-selection or assertion changes.
- Given the config diff, when reviewed, then the only runtime change is bounded worker concurrency and all existing timeouts and test globs remain unchanged.

## Spec Change Log

## Design Notes

The cap applies to the common pool within each Vitest invocation. Aggregate workers still increase with active worktrees; this does not cap individual-worker memory. Two workers reproduced a passing normal suite in this checkout after the unrestricted baseline failed. It trades some isolated-suite throughput for reliable concurrent native runs. CLI overrides remain available for intentional local experimentation. The repeated source parse is a legitimate contract assertion and should remain fully exercised.

## Verification

**Commands:**
- `npm test`: all projects pass with the normal entry point.
- `bash scripts/loop-verify.sh`: every native verification gate passes.
- `git diff --check`: no whitespace errors.

Approval: user delegated verification repairs and routine implementation choices; no additional checkpoint is required for this bounded configuration repair.

## Verification Results

Baseline `6cc8c41ef9b00886fd48cfb2df61d7029e55f900`: normal `npm test` failed only the source scanner at its 5,000 ms deadline (1,357 passed, one failed). Patch `8168e20a13d8ccd79903d4e0dc05a713ee3470f1`: normal `npm test` passed 127 files and 1,358 tests in 49.04 seconds. The complete `bash scripts/loop-verify.sh` then exited 0: Convex tsc passed, Svelte checking reported zero errors/warnings, all 1,358 tests passed again in 82.25 seconds, and PowerShell/Bash uploader harnesses passed 50/18 cases. Other native checks were concurrently active; these timings are observations rather than a controlled resource benchmark.

Independent BMAD blind, edge-case, and verification-gap reviews completed. Evidence wording was qualified; edge-case and verification-gap reviewers found no remaining issues. All existing deadlines, test selection, and assertions remain unchanged. Detailed local evidence: `.audit/bmad-verification-fix/{baseline-test.log,post-change-test.log,native-gate-complete.log,evidence.md,review.md}`.

## Suggested Review Order

- Bound concurrent workers for every existing unit-test project.
  [vitest.config.ts:14](../../vitest.config.ts#L14)

## Learn-chat recovery application

Applied the schema lane's independently reviewed source-audit timeout repair (f009b43) to the pinned recovery base after the source parser exceeded its five-second default during story 3 verification. The audit remains selected exactly once with unchanged assertions; only this parse-heavy suite has a 30-second budget. The two-worker cap remains. The resumed native story queue must verify the resulting configuration using the standard gate, without command-line timeout overrides. Historical evidence belongs to its original revision.
