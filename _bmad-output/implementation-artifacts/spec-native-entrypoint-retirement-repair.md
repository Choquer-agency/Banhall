---
title: 'Preserve native-only BMAD lifecycle entry points after integration'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: 9da55bece5948da12129720dd2330a3032c985bf
review_loop_iteration: 0
context:
  - '{project-root}/docs/bmad-loop.md'
---

<frozen-after-approval reason="user-authorized repair of failed loops while retaining native BMAD skills">

## Intent

**Problem:** The combined branch has resurrected `scripts/loop-parallel.py`, even though an accepted earlier repair deleted it and the current guide says it is retired. The remaining `scripts/loop.sh` wrapper can also re-arm a run from loose text matching, change local policy, and push a branch before establishing native completion. Operators can therefore accidentally bypass the native recovery and final verification contract.

**Approach:** Remove both unused legacy lifecycle wrappers and document their native replacements. Preserve the native engine, its dependency provisioning hook, all active and historical runs, and the required verification gate. Record a repeatable source-level check so final integration can detect another resurrection before shipping.

## Boundaries & Constraints

**Always:** Use native `bmad-loop` for run creation, status, preservation-aware recovery, review, verification and local merge-back. Retain Astra 6 medium for implementation, review and triage. Keep this repair isolated until the active sweep finishes, then verify the actual merged files again. Preserve useful work before recovery and require native task, commit and verification evidence before any main promotion.

**Ask First:** A new product-policy choice, deleting an active run or a user's uncommitted work, or changing an external operator's intended workflow beyond these superseded wrappers.

**Never:** Add a substitute controller, automatic re-arm loop, collector, fake completion receipt or implicit push. Change native state, installed engine code, local policy, credentials or active worker dependencies. Change application behavior or historical spec intent to make the review pass.

</frozen-after-approval>

## Code Map

- `scripts/loop-parallel.py`: 213-line executable currently present at baseline. It force-removes old lane worktrees, force-resets branches, shares dependencies through symlinks and collects every lane after waiting regardless of its exit status. Commit `7a164054c5e9fe85ee1ab41bf105d9e286bb81fb` deleted it; a later integration retained an older parent version. A scan of non-merge deletions from main to the current baseline found no other resurrected non-artifact source file.
- `scripts/loop.sh`: unused legacy lifecycle wrapper. Lines 44–46 rewrite policy; lines 56–66 infer provider faults using broad text and re-arm; lines 79–83 push before the final completion check. No tracked runtime or package entry point calls either wrapper. Their only nonhistorical references are self-documentation and the current guide's retirement statement.
- `docs/bmad-loop.md`: authoritative native guide. Already documents run/status/resolve/resume, paused-state checks, final review and CI. Update its retirement statement to name both files and explain that provider failures require preservation-aware native recovery.
- `scripts/loop-verify.sh` and `.bmad-loop/plugins/npm-bootstrap/plugin.toml`: preserved native verification and dependency hooks; no lifecycle orchestration is introduced here.
- `_bmad-output/implementation-artifacts/spec-bmad-native-operation.md`: prior completed retirement contract and historical verification. Retain its history; this new spec records the integration regression rather than rewriting earlier evidence.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/loop-parallel.py`, `scripts/loop.sh`: delete the obsolete launchers and remove their executable lifecycle paths.
- [x] `docs/bmad-loop.md`: identify both retirements and direct run/recovery/push actions to the existing native and reviewed shipping procedure.
- [x] `.audit/native-entrypoint-retirement/`: preserve baseline source and history evidence, a source-level verifier and its actual before/after output, and the replay command required for the final merged revision.

**Acceptance Criteria:**
- Given a checkout of this repair, when inspecting tracked lifecycle entry points, then neither retired wrapper exists and no active tracked caller still invokes either file.
- Given an operator encountering a provider failure, when following the guide, then native status and preserved work determine recovery; an elapsed wait or loose error-word match cannot re-arm a run through a repository wrapper.
- Given a paused run that exits zero, when following the shipping instructions, then the operator still requires every intended task's done phase, its commit and passing verification, plus final review and remote CI before main promotion.
- Given an active native sweep, when preparing this repair, then its integration checkout, worker state and dependencies remain untouched; only a separate repair checkout changes.
- Given the final integration revision, when rerunning the source verifier, then both retired files remain absent and native run and verification entry points remain documented and available.

## Spec Change Log

## Verification

- Run a small source verifier against the real baseline and repaired checkout: baseline must reproduce the two retired executable paths, repaired checkout must reject their existence and active callers while retaining the documented native commands and existing hook/gate.
- Compare `bmad-loop run --help`, `status --help`, `resolve --help` and `resume --help` with the guide. These are read-only probes; do not launch or recover a run as a test.
- Run `git diff --check` and inspect the complete repair diff. Product tests do not execute deleted operator scripts; the required combined product gates remain due on the final integration revision.


## Review Triage Log

Three independent Astra 6 medium BMAD layers completed. Blind and edge findings were consolidated into ten ordinary patches to the guide and source verifier; verification reported no additional gap. No product policy, native state, legacy story status or ledger entry changed. Preserved the initial source-check failure caused by tracked skill aliases; corrected it by accepting only aliases whose local tracked targets are also inspected. Unknown or historical-artifact targets fail closed. The final verifier passed against this real checkout and all 11 isolated fixture probes passed.

The final source receipt fingerprints the reviewed files independently of HEAD. The scan covered 3,120 tracked files plus verified local skill aliases. Exact native gate/bootstrap/guide hashes must survive final integration; a later failure requires inspection, not automatic hash replacement. Static references cannot prove absence of every dynamically constructed command.

## Suggested Review Order

- Use native run and preservation-aware recovery after removing legacy lifecycle wrappers.
  [bmad-loop.md:9](../../docs/bmad-loop.md#L9)

- Catch retired entry points and aliases while preserving reviewed native gates.
  [verify.py:1](../../.audit/native-entrypoint-retirement/verify.py#L1)

- Reproduce the integration regression from immutable history.
  [history.py:1](../../.audit/native-entrypoint-retirement/history.py#L1)

- Exercise the actual verifier against restored scripts, caller paths, aliases and altered gates.
  [probes.py:1](../../.audit/native-entrypoint-retirement/probes.py#L1)
