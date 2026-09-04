---
title: Bound verification worker resource use
type: bugfix
created: 2026-09-04
status: in-progress
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
- [ ] `vitest.config.ts`: cap workers at two in the common test config with a comment explaining concurrent native worktree resource use.
- [ ] `.audit/bmad-verification-fix/`: capture baseline, normal npm test, complete native gate, and review evidence.

**Acceptance Criteria:**
- Given installed dependencies in this worktree, when normal npm test runs, then every existing test project runs and passes without a scanner timeout.
- Given the existing native script, when bash scripts/loop-verify.sh runs, then every gate passes without test-selection or assertion changes.
- Given the config diff, when reviewed, then the only runtime change is bounded worker concurrency and all existing timeouts and test globs remain unchanged.

## Spec Change Log

## Design Notes

The cap applies to the global pool rather than independently increasing per-project parallel demand. Two workers is the previously successful recovery bound. It trades some isolated-suite throughput for reliable concurrent native runs. CLI overrides remain available for intentional local experimentation. The repeated source parse is a legitimate contract assertion and should remain fully exercised.

## Verification

**Commands:**
- `npm test`: all projects pass with the normal entry point.
- `bash scripts/loop-verify.sh`: every native verification gate passes.
- `git diff --check`: no whitespace errors.

Approval: user delegated verification repairs and routine implementation choices; no additional checkpoint is required for this bounded configuration repair.

## Chat-spend recovery application

Applied the schema lane's independently reviewed dedicated source-audit timeout repair (f009b43) after the standard command repeatedly exceeded the five-second source-parser budget. Assertions and test selection are unchanged; the audit is selected once with a 30-second limit and the existing worker cap remains. This recovery base awaits serial native dev, review and final verification. Earlier passing logs certify their recorded historical revisions only.
