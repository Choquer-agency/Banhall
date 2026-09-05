# Native BMAD 0.11.1 sweep spec recovery audit

Read-only investigation on 2026-09-04. Only this report was written. No engine, state, ledger, spec, control, or code changes, and no tests run.

## Finding

The wrong spec originated in native result discovery, not in the QA worker choosing the browser story. `GenericDevAdapter._artifact_dirs` searches the worker implementation-artifacts directory **and the integration checkout implementation-artifacts directory as a fallback** (`adapters/generic.py:1335-1345`). Initial sweep dev dispatch has no recorded spec; its prompt names bundle intent.md. `expected_spec` is pinned only when a recorded spec is also named by the prompt (`engine.py:5623-5659`). A path mentioned inside the bundle intent does not provide this binding.

The first-attempt discovery scan reads only direct `*.md` children of implementation_artifacts (`devcontract.py:430-460`, `491-521`). The intended `_bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/qa/stories/8-blocking-qa-policy.md` is outside that directory and cannot be discovered. Both integration and worker `_bmad/bmm/config.yaml` configure implementation_artifacts as `{project-root}/_bmad-output/implementation-artifacts`.

The root browser reconciliation spec has mtime 2026-09-04T22:04:19.479007Z, after QA session start 22:03:46.348361Z (journal line 44). It is markerless and status done. At 23:14:59.810818Z native discovery recorded terminal-frontmatter-pending for that root file (`tasks/dw-blocking-qa-native-followup-dev-1/resultless-stops.jsonl:1`), sent its contract nudge at 23:15:00.834Z, then synthesized at 23:15:21.482946Z (session-lifecycle.jsonl:2). This matches the root fallback scan and post-launch mtime requirement exactly. The QA Codex transcript contains the browser filename only in that injected nudge, lines 295-296, not in worker instructions or selection before then. Root checkout mutation supplied the unrelated qualifying artifact; the broader enabling defect is unbound discovery plus root fallback plus a non-discoverable adopted original spec. This does not establish that merge alone would fail with a correctly discoverable authoritative artifact.

## What the receipt means

State tasks.dw-blocking-qa-native-followup records phase review-running, spec_file as the absolute ROOT browser path, dispatched_spec_file null, accepted_dev_session_index 0, no commit_sha, and isolated_ledger_carried false. Its synthesized result even contains the browser baseline 717c75897cc04256c008a2ed42747df66f6fc6b5 rather than task baseline 137d77f87db77d8296f5e759ebfa7e2a55709c25. This is false artifact attribution, not QA native completion.

Journal lines 45-49 show synthesis then out-of-tree refusals for marker repair, reconcile, and deferral harvest. The command gate passed (line 50), dev decision proceeded (51), and DW-92 closed only inside the worker (52). Sweep closes its bundle ledger after accepted dev and before review because review requires the closed entries (`sweep.py:1678-1730`). Therefore this close is not accepted integration or final review. Review launch then correctly rejected the root file against the worker trusted roots (`engine.py:6244-6267`; crash.txt). No review session launched.

The QA worker original spec presently says done, followup_review_recommended true, and has its own evidence/history. Preserve these real changes independently of the incorrectly attributed engine receipt.

## Supported recovery behavior

`bmad-loop resume` is a supported crash recovery entry point, but **does not continue this sweep at review**. `SweepEngine._recover_inflight_bundle` only resumes COMMITTING or an accepted DEV_VERIFY receipt. For this review-running task it calls `_discard_unit_for_restart`, resets to pending, and dispatches afresh (`sweep.py:791-878`). Preserve the worker commits and ignored evidence before any resume.

The native path reanchor is not an artifact replacement API. `StoryTask.rebase_spec_paths_on` only anchors relative paths; absolute out-of-mount paths pass through unchanged (`model.py:540-563`). Thus there is no supported resume-after-reanchor operation that turns this root browser spec into the nested QA spec. No supported CLI spec-rebind option was found. Do not hand-edit state or patch the installed engine.

`resolve` is inappropriate: `runs.rearm_escalation` requires PAUSE_ESCALATION and Phase.ESCALATED (`runs.py:3731-3744`). This task is review-running after a crash. Restore-patch is also a constrained escalation mechanism, not a general replacement of accepted spec attribution. Consequently the loop-resolve skill is not applicable here.

Safest bounded recovery: preserve worker changes/evidence, stop the crashed run through native controls if necessary, integrate only reviewed QA changes with independent verification, and obtain a fresh native acceptance on a correctly addressed original spec. Preserve this failed run as evidence rather than manufacturing success. A native stories run uses deterministic folder/id discovery (`adapters/generic.py:1360-1366`), which is better suited to adopting the existing nested QA story; assess its eligibility/status rules before dispatch. A fresh sweep can also run, but merely repeating the original-spec path in incoming intent **does not fix discovery**. It needs a genuinely discoverable result artifact under the configured implementation-artifacts directory, or a supported configuration/layout that makes the exact original story directly discoverable. Changing implementation_artifacts also relocates the engine ledger and sprint paths (`bmadconfig.py:39-43`), so do not casually repoint it to the nested QA folder. An engine-authored normal sweep spec that references original QA evidence is a viable sweep contract, but is distinct from directly adopting that original spec.

## Recurrence prevention

Freeze root integration mutations while a native sweep worker is active, including merging unrelated terminal specs. Keep one discoverable result artifact per unbound initial attempt. Validate effective config and worker paths before launch. Incoming hints should name the exact existing original spec, retain its baseline/history, require fresh native review and evidence, and require the native completion marker; however those hints govern agent behavior only and do not bind native result discovery. Prefer deterministic stories folder/id mode for preexisting nested story adoption. Do not mark DW-92 resolved from this failed run, copy its worker ledger closure blindly, or claim the successful command gate proves review acceptance.

Installed source root: `/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/`.
Run evidence root: `.bmad-loop/runs/20260904-145336-4d56/`.
QA transcript: `/Users/johnnynguyen/.codex/sessions/2026/09/04/rollout-2026-09-04T15-03-47-01a06e73-0707-7c10-b5cc-4b8ad389a78f.jsonl`.

## Recovery decision refinement

A flat native follow-up spec is sufficient; original result-path adoption was a prior plan, not a user requirement. The strongest supported path is a **fresh native sweep** after preserving and independently integrating the worker QA changes/evidence, with target DW-92 remaining open for native acceptance. Provide an operator recovery note that explicitly supersedes nested result-location directions for BOTH QA and PED: create a normal flat follow-up spec in `_bmad-output/implementation-artifacts`, use the original nested story and its immutable contract/history as context, run real native review and current-code gates, and emit the required Auto Run Result marker in the flat follow-up spec. This matches the adapter discovery contract without config tricks or engine changes.

Do not resume this poisoned task expecting replacement discovery to heal it. `_discard_unit_for_restart` calls `release_mount_owned_state` (`engine.py:1360-1435`); `release_spec_paths_from_mount` deliberately preserves an outside-mount absolute `spec_file` (`model.py:463-509`). `_record_dev_spec` exits early whenever task.spec_file is already set (`engine.py:2666-2675`). Therefore even a successful flat replacement result in a resumed dev attempt would leave the task pointing at the wrong browser file. Fresh run/task state is essential for this recovery path, and the fresh sweep should consume the explicit revised incoming intent rather than reuse the old bundle instruction to adopt the nested result.
