---
title: Prune unused direct dependencies without changing the surviving lock graph
type: chore
created: 2026-09-05
status: done
review_loop_iteration: 0
baseline_commit: 71e809f9f58e07b1b436fff95b2dbe6e9d05b27d
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="user authorized audited all-branch integration; parent promotes and dispatches sequentially">

## Intent

**Problem:** Unused direct packages and obsolete Bun tooling remain after application/test migration, retaining an unnecessary dependency graph.

**Approach:** Remove the five audited root dependencies and unreachable lock entries, delete Bun residue and obsolete include paths, then verify a fresh locked installation and real retained behavior.

## Boundaries & Constraints

**Always:** The user selected BMAD; generic factory engine/shipping requirements do not replace this authorized workflow. Work only in the parent-assigned checkout/baseline after B5/B6. Own locked `npm ci` is explicitly allowed. Preserve all surviving dependency versions, integrity and resolved values, current gate/configuration and previous batches. Parent owns final combined gate, review dispatch, staging, commits and shipping.

**Ask First:** Report new consumers, unexpected surviving graph drift or a necessary version change to parent before broadening. Ordinary exact lock cleanup and own npm ci are authorized.

**Never:** The worker must not stage, launch reviewers, commit, push, merge, edit another worktree, or mutate native state/ledgers. Do not stage, commit, push, merge, dispatch reviewers, edit other worktrees, mutate native state/ledger, hand-edit generated code, update unrelated dependencies, run unpinned installs or audit fixes. No removal of StarterKit's required Underline dependency. No Vitest, CI, discovery, browser preflight or product changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Root imports | Application/config/scripts after prior batches | No live consumer of removed roots | New consumer blocks that removal |
| Lock pruning | Current compatible lock graph | Only unreachable entries removed | Unrelated survivor drift reported |
| Fresh install | Own npm ci using committed lock inputs | Reproducible complete required graph | Capture real peer/invalid errors |
| Editor | Fresh installed StarterKit | Underline still works, one extension | No duplicate warnings |
| Discovery | Current executable tests and three archives | All executable files accounted | Genuine orphan still fails |
| Verification | Current unified defaults and pointer instances | Existing gate contract retained | No configuration workaround |

</frozen-after-approval>

## Code Map

Four writable paths only:
- `package.json`: remove direct docx, svelte-exmarkdown, tippy.js, eslint and @types/bun; retain every other field/value.
- `package-lock.json`: corresponding root/unreachable graph cleanup with no opportunistic upgrades.
- `bun.lock`: delete after confirming no executable bun:test consumer remains; historical receipts remain.
- `tsconfig.json`: remove only obsolete test/**/*.js, test/**/*.ts and test/**/*.svelte includes. Preserve src/tests/shared/native-transformer and generated Svelte declarations plus compiler settings.
- Keep gate/discovery, three pointer instances and two CI jobs byte-identical, including NUL paths and three archives.
- Sources `8649315de144a7e424c12ff461046d5ec8e58ddd` and `ad9952ff1ba107bfbf97955863d4dfcdf774a530`; ignore latter's old discovery script. `.audit/branch-consolidation/planning/B7.md` records graph evidence and B5 supplies real Underline proof.

## Tasks & Acceptance

**Execution:**
- [x] Record actual Node/npm versions before verification; use installed repository Node24, not the non-login shell Node22. No install is needed for runtime selection.
- [x] Capture hashes; scan current imports/config/scripts for removed roots and bun:test, including B1/B2 additions.
- [x] Parse lock tuples/reachability. Use cumulative ad9952f blob only if current inputs match; otherwise reconcile without upgrades and report drift.
- [x] Remove five roots, prune unreachable graph, delete bun.lock and exactly three obsolete includes. Preserve all unrelated bytes where practical.
- [x] Record complete added/removed/changed lock entry sets and survivor version/resolved/integrity equality. Inspect peer/dependency reachability, not just package counts.
- [x] Run own npm ci, capture full output/exit and npm ls results; distinguish unsupported optional platform packages from broken required dependencies.
- [x] Run focused tests and real editable/read-only Underline roundtrip/toggle proof on the fresh install. Deliver manifests, graph delta and receipts to parent for independent review and combined gate.

**Acceptance Criteria:**
- No production/config consumer is stranded and every removed transitive entry is unreachable from retained roots.
- Surviving versions, integrity and resolved URLs are unchanged; no added package or unrelated upgrade is accepted silently.
- Fresh installation and retained runtime assertions pass without canonical config changes; all four file changes stay within scope.

## Spec Change Log

## Verification

**Commands:**
- `npm ci` in the assigned checkout only, after exact lock changes; `npm ls --all` with captured exits and required-graph inspection.
- `node node_modules/vitest/vitest.mjs run tests` after installation; retain corresponding pre-change test receipt supplied by prior batches or run focused baseline before pruning.
- `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts` plus `node node_modules/vitest/vitest.mjs run src/lib/tiptapConfig.test.ts --expect.requireAssertions` and `node .audit/branch-consolidation/B5-r1/underline-proof.mjs` (strict default) on fresh modules. Never use the first B5 attempt's source-inferred acceptance mode.
- `node scripts/check-test-discovery.mjs` and `git diff --check`; parent owns staged membership verification, independent reviews and final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` with hosted proof.

Drafting runs no verification. Historical passes are not current evidence.

Worker evidence: retain actual commands, exit codes, source identities and limits under `.audit/branch-consolidation/B7/`, with `evidence.md` for parent review. Parent owns fresh review layers, final admission and shipping.

## Suggested Review Order

- Inspect the five-root removal and preserved application dependencies.
  [package.json:18](../../package.json#L18)

- Review complete surviving graph equality and unchanged missing edges.
  [verify-graph.py:17](../../.audit/branch-consolidation/B7/verify-graph.py#L17)

- Review explicit inherited peer exception and separate security follow-ups.
  [review-triage.md:8](../../.audit/branch-consolidation/B7/review-triage.md#L8)

- Check exact obsolete-path removal and retained TypeScript scope.
  [tsconfig.json:3](../../tsconfig.json#L3)

- Inspect fresh installation, strict editor proof and combined acceptance.
  [evidence.md:15](../../.audit/branch-consolidation/B7/evidence.md#L15)
