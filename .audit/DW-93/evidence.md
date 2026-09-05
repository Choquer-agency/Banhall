# DW-93 verification evidence

Verified source revision and actual fresh run baseline: `bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d`.
Original frozen story baseline: `740008e1369faaf6eab001f95efeb10a9e52d1e5`. Historical authority: `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/3-persist-post-edit-distance-at-milestones.md:384` records that PED is only 1 minus word similarity and excludes paragraph counts; the same frozen story at `:134` and `:135` explicitly defers end-to-end coverage of single-candidate and iterative-approve paths in favor of structural coverage.
Commands ran 2026-09-04 America/Vancouver (2026-09-05 UTC), in the DW-93 isolated worktree. No production or test files changed, so the baseline identifies the exact source and tests exercised. The final evidence/spec commit is recorded by the parent workflow after independent review. Required parent Verify runs are retained in `parent-full-gate.log` and `parent-ped-tests.log`; the earlier implementer runs remain in `full-gate.log` and `ped-tests.log`. Native dispatch baseline provenance is retained in `native-dispatch-provenance.json`: journal entries 79/81 precede DW-93 dispatch entries 123/126, and task baseline_commit equals the verified revision above.

## Original acceptance criteria

| Original AC | Actual current-code and runtime evidence |
| --- | --- |
| 1. Candidate selection yields one zero-PED row accessible to admin | `convex/reportEditDistance.test.ts:163` calls actual selectReportCandidate and checks one candidate_selection row, PED 0, revision 0, then report-series retrieval as writer. Admin report-series access is exercised separately at `:464`. The combined evidence proves selection recording and admin read authorization; it is not a single admin-after-selection fixture. `parent-ped-tests.log`: passed. |
| 2. Edited milestone records current revision and PED > 0 | `convex/reportEditDistance.test.ts:226` calls createMilestoneSnapshot on edited revision 1 and checks one milestone row, revision 1 and 0 < PED < 1. `parent-ped-tests.log`: passed. |
| 3. Scheduled publication records owner attribution | `convex/reportEditDistance.test.ts:300` calls publishForReview, drains scheduled functions and asserts client_publish plus writerUserId equal to owner. `parent-ped-tests.log`: passed. |
| 4. No generated baseline writes no reading and caller succeeds | `convex/reportEditDistance.test.ts:383` tests successful milestone and publish with no reading; `:400` tests deleted-report scheduled no-op. Candidate creation atomically inserts its baseline before recording, and existing-report early return creates no reading (`convex/generations.ts:1005`). `parent-ped-tests.log`: passed; candidate absence is structural reasoning, not an exercised runtime fixture. |
| 5. Persisted/read-time formula parity and exact eight keys | `convex/reportEditDistance.test.ts:269` tests equal PED and exact keys; `:244` tests first real baseline against later ghost on both surfaces. `preservation-check.log` compares original formula statements, helpers and query argument/auth/baseline prefix exactly. Both commands passed. |
| 6. check and test pass | `parent-full-gate.log`: ordinary script completed with Convex types, zero Svelte errors/warnings, 148 files and 1772 tests passed, then uploader suites reported 50 and 18 passing cases. The PowerShell AC4 dotfile platform sub-case was SKIP (`parent-full-gate.log:48`), because Get-ChildItem without -Force hides dotfiles on this platform. Exit 0. |

## Original matrix and explicit contract checks

| Scenario or constraint | Evidence |
| --- | --- |
| Candidate selection | AC1 above; all three callers traced at `convex/generations.ts:1222`, `:2168`, `:2896`, shared recorder at `:1070`. |
| Milestone snapshot | AC2 above. |
| Client publish | AC3 above. |
| No baseline | AC4 above. |
| Repeat trigger | `convex/reportEditDistance.test.ts:317` repeat publish suppresses second row; `:329` edited republish survives; `:349` different trigger on same revision survives. |
| Per-report denied access | `convex/reportEditDistance.test.ts:413` anonymous-admin, roleless and unmapped users; `:464` unauthenticated; `:528` missing report; `:438` filters another project's rows. |
| Per-writer wrong actor | `convex/reportEditDistance.test.ts:605` unrelated writer and anonymous-admin rejected; unauthenticated returns NOT_AUTHENTICATED. |
| Empty text | `convex/lib/editDistance.test.ts:50` both empty => similarity 1 and PED 0; `:60`, `:69` asymmetric empties. |
| Formula edge behavior | `convex/lib/editDistance.test.ts:7`, `:18`, `:29`, `:39`, `:79`, `:86`, `:91`: multiset counts, Unicode/punctuation, identical/rewrite, line splits, whitespace/case and partial edit. |
| Unexpected recorder failure isolation | `convex/lib/editDistance.test.ts:104` failing baseline query resolves null and logs once; recorder's full read/compute/insert body is caught at `convex/lib/editDistance.ts:106`. |
| Bounded series and ordering | `convex/reportEditDistance.test.ts:498` report timestamp tie, `:538` report cap 200, `:694` writer cap 500; all keep newest rows. |
| Writer permissions and sinceDays | `convex/reportEditDistance.test.ts:587`, `:605`, `:632`, `:646`, `:658`: admin/manager/self, denied actors, validation, auth precedence, indexed window. |
| Durable writer and generation attribution | `convex/lib/editDistance.ts:141` takes project.ownerId; `convex/reportEditDistance.test.ts:368`, `:675` ownerless behavior; `:464`, `:587` generationId projection. |
| Generated API registration/provenance | `preservation-check.log`: API equals supported codegen revision `3e575b7c68a80ef560b746be78e1b016e1dda750`; preserved real receipt originates at `5de0e9a389022afc4ee21f740fe6fdd0755fa9b8`. Full gate typechecks current generated registration. |

## Follow-up acceptance

The full current-code assessment is `assessment.md`; preservation hashes are `preservation-snapshot.json`; decisions are append-only in `decisions.tsv`. All original ACs and matrix scenarios are mapped above, with explicit dynamic versus structural evidence limits. The production implementation required no repair. Review identified an audit-verifier defect: Python optimization disabled integrity assertions, while git_blob and matches_baseline metadata were unvalidated. `verifier-before.log` reproduces five failing tamper-rejection cases; explicit fail-closed checks and metadata validation make all eight cases pass in `verifier-after.log`. `test-preservation.py` tampers only with the snapshot returned in memory, testing normal Python and `-O`; protected files are never changed.

`verify-preservation.py` checks the frozen story, ledger, generated API and preserved prior codegen evidence against the actual fresh baseline. It additionally establishes canonical ancestor revisions and exact API/formula/query preservation. The script is read-only and creates no native receipts. Independent reviews, triage and the terminal Auto Run Result belong to the parent development workflow; native final acceptance belongs to the orchestrator.

## Exact commands and retained outcomes

- `bash scripts/loop-verify.sh`: exit 0. Full output in `parent-full-gate.log`. Uses its existing PUBLIC_CONVEX_URL default and ordinary repository test settings; no timeout overrides or test configuration changes.
- `npx vitest run convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts`: exit 0. Full output in `parent-ped-tests.log`; 2 files, 35 tests passed.
- `python3 .audit/DW-93/verify-preservation.py`: exit 0. Full output in `preservation-check.log`; every comparison passed.
- `python3 .audit/DW-93/test-preservation.py`: repaired verifier passes 8 cases (normal and optimized modes), including rejection of in-memory SHA-256, Git blob and baseline-attestation tampering. Before/after output is retained in `verifier-before.log` and `verifier-after.log`.
- `git diff --check`: exit 0. Output/status in `diff-check.log`.

Ordinary full-gate output excerpts:

```text
svelte-check found 0 errors and 0 warnings
 Test Files  148 passed (148)
      Tests  1772 passed (1772)
SKIP  AC4 dotfile sub-case - this platform hides dotfiles from Get-ChildItem without -Force
50 passed, 0 failed
18 passed, 0 failed
Exit status: 0
```

Focused output excerpt:

```text
 Test Files  2 passed (2)
      Tests  35 passed (35)
Exit status: 0
```

Existing frozen risks and product deferrals remain unchanged, including scheduled drain-time readings and historical retention/ownership behavior. The successful ordinary gate replaces the need to rely on the earlier extended-timeout run for this follow-up's verification. Supported codegen provenance is retained without claiming a fresh remote run or native acceptance.

## Final post-review verification

Parent ran the spec gates again after the audit repairs. `bash -x scripts/loop-verify.sh` completed with exit 0 in `final-full-gate.log`; shell tracing identifies the Convex tsc step and leaves test settings unchanged. The final focused command passed 35 tests in `final-ped-tests.log`. `parent-verifier-tests.log` has eight passing tamper/clean checks; `final-preservation.log` confirms all protected bytes and provenance. The four independent review layers and subsequent repair verification are recorded in `reviews.md`. Runtime versions observed by the parent: Node v24.19.0, npm 11.17.0, PowerShell 7.6.5.

The complete staged artifact set is checked with `git diff --cached --check` and a protected-path inventory before commit; see `finalization-check.log`. The final local commit is identified in the workflow hand-back, and its parent chain connects this evidence to the exact source revision above. Native acceptance remains pending orchestrator review.

## Native review follow-up on 2026-09-04

The sections above and their original logs are historical evidence for development commit `98b4b084562ef93c0036297ce8958381e7a5f9f9`. After that commit, native journal line 130 closed DW-93 and line 131 started this review. This phase is documented in `review-followup/reviews.md`, `native-journal.json`, `native-task.json`, and `invocation-snapshot.json` under that directory. Original baseline and frozen contract remain unchanged.

The old verifier failure against the orchestrator's new ledger is reproduced in `review-followup/preservation-before.log` (exit 1). The repaired verifier checks historical ledger bytes against the original development baseline and current ledger bytes against the review invocation; it also checks exact protected inventory and native baseline agreement. No ledger bytes were authored or reverted. Tamper tests now require the expected diagnostic and cover missing/duplicate inventory, baseline disagreement, protected bytes, current ledger and staged bytes in normal and optimized Python.

Fresh ordinary commands and outcomes are retained in `review-followup/`: `ped-tests.log` (35 tests, exit 0), `full-gate.log` (ordinary full gate, exit 0), and post-repair command logs. The full gate reports 1,772 tests across 148 files, zero Svelte errors/warnings, uploader suites 50 and 18 passed, with the existing PowerShell dotfile sub-case skipped. Production source and original AC/matrix mapping above are unchanged. Final staged checks and manifest bind the committed artifact set; the containing commit can be resolved with `git log -1 --format=%H -- .audit/DW-93/review-followup/reviews.md`. Native acceptance remains subsequent orchestrator work.

## Current review invocation

This review began at canonical commit `a338f6a08274e7a26b3f0195fb15424f7f30a1ed`; this is also the fixed containing revision for the historical review-followup receipts and manifest. The recorded workflow baseline remains `bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d` under the done-spec review route. Current invocation hashes and review triage are in `review-current/invocation.json` and `review-current/reviews.md`. No production source or original PED test changed; the original AC/matrix mapping above still applies to the freshly exercised source.

Current exact commands and real outcomes, all exit 0 unless specified:

- `bash scripts/loop-verify.sh`: full-gate.log and post-repair-full-gate.log, both pass. Post-repair result: zero Svelte errors/warnings, 148 files / 1,772 tests passed; uploader suites 50 and 18 passed, with the existing PowerShell dotfile platform sub-case skipped.
- `npx vitest run convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts`: ped-tests.log and post-repair-ped.log, both 35 passed.
- `python3 .audit/DW-93/test-preservation.py`: integrity-before.log reproduces six false successes against the old staged checker (exit 1, 22 passed / 6 failed); integrity-after.log verifies 44 passing normal/optimized cases after repairs. The independent edge reviewer also ran the suite successfully.
- `python3 .audit/DW-93/verify-preservation.py --staged`: post-repair-preservation.log passes, including all five protected index paths and preserved generated API provenance.
- `python3 .audit/DW-93/review-current/verify-finalization.py`: finalization.log records terminal spec, invocation byte/index equality, staged allowlist/equality and whitespace checks. The executable source is retained.

All current logs above are under `.audit/DW-93/review-current/`. Ledger bytes were neither written nor staged during this invocation. No sprint-status.yaml or project-context.md exists in this worktree (including ignored-file search). The original story, API and codegen receipts remain unchanged. Native acceptance remains an orchestrator decision. This pass changes audit verification and result artifacts only; frozen structural candidate-path coverage and other historical product choices remain unchanged.
