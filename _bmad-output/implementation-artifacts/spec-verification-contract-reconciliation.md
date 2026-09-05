---
title: Reconcile the unified verification contract
type: chore
created: 2026-09-05
status: done
review_loop_iteration: 0
baseline_commit: dd787d4287bcdf970aa3bcb25f0781dc765e030c
context: []
---

<frozen-after-approval reason="user explicitly approved the unified gate contract and routine implementation/review without another checkpoint">

## Intent

**Problem:** The completion branch still exposes the old verification command and CI jobs despite the user's updated AGENTS contract. The reviewed infrastructure on the original branch also assumes every tracked test file is executable, while completion preserves three historical QA source copies.

**Approach:** Port the reviewed unified command and two-job workflow into this isolated checkout, account for exactly the three known archive files, and document the actual verification entry point. Prove both successful execution and fail-closed discovery before handing the private reviewed commit to root.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-verification-contract` on `codex/bmad-verification-contract`. Keep worker-owned npm dependencies, public placeholder environment and all current product tests. Preserve archive bytes, native ledger guidance and existing domain policies. Capture actual commands, exit codes, source hashes and baseline failure before adapting the guard. Record decision/evidence files under `.audit/verification-contract/`. User authorization covers this spec and normal implementation, checks and review without repeat approval. BMAD governs this repair; factory references are historical provenance only.

**Ask First:** Any newly required product behavior, dependency version, runner selection or private deployment changes.

**Never:** Alter original/completion/native worktrees, ledger, native state/policy, product code, dependency files, canonical Vitest configs, generated source or historical evidence. Do not start native/factory loops, push, open PRs or merge. Do not globally exclude audit trees or suppress genuinely undiscovered executable tests. No new factory plans or hermetic deployment initiative.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Existing archives | Three specific tracked QA copies absent from runners | Report/account exactly those archives, all executable tracked tests discovered | Any other orphan fails |
| New undiscovered test | Genuine temporary test tracked only in an isolated temporary index | Actual unchanged canonical listings leave it orphaned | Exit nonzero and name path |
| Missing prerequisite | Bounded PATH fixture lacks pwsh | Preflight names missing tool and hint | Exit 1 before later steps |
| Gate failure | Harness injects Convex command exit 37 | Name failing step, run no later step | Propagate exit 37 |
| Optional missing browser | Empty browser cache with VERIFY_COMPONENT=1 | Preflight names Chromium and install command | Exit 1 |

</frozen-after-approval>

## Code Map

- Source commit `5ec93e594eda60c28da2cfdbf27fb668fd55eb3d` is reachable locally. Four files below match independently verified worker `125c6cd47e8b1068f39889855d2029a502e5a856`; transplant their final bytes rather than whole commits.
- `scripts/loop-verify.sh`: adds eight numbered steps, tool/version checks before own npm installation, both public URL defaults, build/discovery/uploader, exact exit propagation and optional ninth browser step.
- `scripts/check-test-discovery.mjs`: Node builtin script lists tracked *.test.ts and calls both canonical Vitest list commands. Its unmodified line37 rejects the three archives. Add exact path accounting here.
- Archive paths: `.audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/ai/qaChecks.test.ts`, `.audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/lib/tiptapReport.test.ts`, `.audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/qaBlocking.test.ts`.
- `.github/workflows/ci.yml`, `.nvmrc`: reviewed two independent jobs and Node24 pin. No branch-protection claim is established by YAML alone.
- `AGENTS.md`: replace only Running and verifying section; preserve native ledger finalization and policy.
- `docs/bmad-loop.md:220-228`: update only current gate description/public defaults and optional browser entry, preserving all integration/ledger guidance.
- `README.md`: stale Next boilerplate; replace with concise factual Banhall/SvelteKit introduction and verification/prerequisite guidance only. Do not import original README factory planning, deployment recipe or future hermetic initiative.
- Existing `vitest.config.ts`, `vitest.component.config.ts`, package files and uploader harnesses are read-only inputs. New script uses existing dependencies.

## Tasks & Acceptance

**Execution:**
- [x] Port the four identified infrastructure files; record exact upstream hashes.
- [x] Reproduce unmodified guard archive failure, then add the exact archive accounting and runtime negative control.
- [x] Update only directly relevant AGENTS/README and current docs/bmad-loop.md verification guidance.
- [x] Record runtime preflight/exit/browser controls and complete VERIFY_COMPONENT=1 unified gate; maintain own dependency/config ownership.
- [x] Complete fresh independent BMAD review, resolve concrete findings and finalize private commit through coordinator.

**Acceptance Criteria:**
- Given current completion source, when the unified optional-browser command runs, then all nine steps pass with exact retained counts and exit0.
- Given a tracked orphan control, when the real guard uses unchanged canonical configs, then it fails; removing the fixture restores success and leaves source/index clean except authorized work.
- Given the final diff, when reviewed, then four infrastructure files plus narrow archive adaptation, verification docs and own spec/audit are the only changes; product/dependency/archive bytes remain identical.
- Given the workflow, when inspected, then both jobs run on PR/main with Node24, public placeholders and component Chromium installation, without optional-failure suppression.

## Spec Change Log

## Design Notes

Use exact archive identities to preserve an auditable distinction between retained input evidence and executable tests. A temporary GIT_INDEX_FILE can record an orphan fixture without touching this worktree's real index. Preserve command/config behavior: no wrapper replaces the canonical suites. Existing original audit receipts are contextual evidence only; they cannot certify this combined source.

## Verification

- Unmodified ported guard: expected exit1 naming exactly three archives.
- Adapted guard and temporary-index negative fixture: expected success/failure/success with actual Vitest listing.
- Actual script harness controls: missing pwsh, missing Chromium, injected Convex exit37.
- `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`: all nine steps pass.
- `git diff --check`; immutable source and archive comparisons; fresh four-layer BMAD review.

## Review Findings

Four fresh BMAD layers completed in capacity-limited waves: two medium and seven low patch items, three dismissed; no decision-needed/defer items. All patches are authorized by the current repair instruction and BMAD build auto-fix path. No native sprint/ledger updates apply to this standalone spec.

- [x] [Review][Patch] Verify actual supported headless launch in optional preflight, with before/after distinct cache controls.
- [x] [Review][Patch] Preserve filename bytes using raw NUL-delimited Git paths and actual discovered Unicode fixture.
- [x] [Review][Patch] Diagnose missing Git early with actual negative control.
- [x] [Review][Patch] Document checkout-local npm ci freshness/ownership prerequisite.
- [x] [Review][Patch] Document Linux Chromium system dependency installation.
- [x] [Review][Patch] Retain a default full gate run with an empty browser cache.
- [x] [Review][Patch] Document existing historical screenshot output side effect and careful cleanup.
- [x] [Review][Patch] Verify baseline object types and executable modes as well as bytes.
- [x] [Review][Patch] Check authorized new-file inventory alongside baseline immutability.

## Final verification results

The original upstream archive guard failed on the exact three retained QA copies before the compatibility patch. Fresh four-layer BMAD review found two medium mechanics defects and seven low documentation/evidence patches; all nine were resolved, with three other suggestions dismissed by explicit scope/evidence triage. A fresh independent post-patch verification found no remaining issues.

Actual baseline/repair probes establish quoted Unicode/newline filename handling and both regular-only/headless-only cache classifications. Runtime controls preserve genuine orphan rejection, early missing Git/PowerShell/browser diagnostics and injected exit37 propagation. Partial/empty caches use isolated PLAYWRIGHT_BROWSERS_PATH; filename controls use temporary GIT_INDEX_FILE. A measured repeat confirmed363 shared-cache records and the real index unchanged. Existing component tests rewrote historical screenshots; only their generated outputs were restored to exact baseline bytes, with receipts.

Final optional nine-step and default eight-step gates both exited0. Each passed Convex types, Svelte0 errors/0 warnings,1970 unit tests/154 files,214 executable discovered files+3 archives, production build and uploader50+18. Optional browser gate also passed463 tests/60 files; default gate's temporary browser cache remained empty. All4555 protected baseline contents and all4560 baseline modes/types match. Hosted CI and shipping remain root-owned.

Authoritative evidence: `.audit/verification-contract/after-review-evidence.md`, final source manifest, complete logs/exits, preserved before/after probes, structured review triage and post-patch independent verification. No native story/ledger status was changed. This standalone spec is complete under the user's existing approval for private finalization.

## Suggested Review Order

- Follow numbered gate execution and exact failure propagation.
  [loop-verify.sh:112](../../scripts/loop-verify.sh#L112)

- Verify actual optional headless readiness with bounded cleanup.
  [loop-verify.sh:84](../../scripts/loop-verify.sh#L84)

- Preserve filename bytes and account only exact historical archives.
  [check-test-discovery.mjs:15](../../scripts/check-test-discovery.mjs#L15)

- Confirm separate hosted verification and browser jobs.
  [ci.yml:12](../../.github/workflows/ci.yml#L12)

- Read complete real before/after and isolated-fixture evidence.
  [after-review-evidence.md:1](../../.audit/verification-contract/after-review-evidence.md#L1)

- Review fresh findings and their scoped dispositions.
  [review-triage.md:1](../../.audit/verification-contract/review-triage.md#L1)
