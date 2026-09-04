# DW-92 fresh native follow-up evidence

Follow-up baseline: `9da55bece5948da12129720dd2330a3032c985bf`. Original implementation baseline: `f122b086d745acc40b4decca26b9aaafc7257f6a`. The original QA contract and historical reviews remain byte-identical in the nested original spec. Historical implementation/repair commits are enumerated in `implementation-provenance.json`; this run independently reviewed those changes, including the three extraction repairs in `f1a61c44f80268df68b5ebd29bc848eee23490a2` and bookkeeping commit `a62e1760a9931c9451c34baa2df8af29fa1e9538`.

## Review and repair

`review.md` records all four required layers and every triage decision. Five patches: one high extraction bypass, two medium coverage gaps, two low evidence improvements. No new deferral or product-policy amendment. The original sentence-level detector deferral is preserved, not resolved here.

The new result location is `_bmad-output/implementation-artifacts/spec-dw-92-blocking-qa-native-followup.md`. A local result marker and passing commands are inputs to the native orchestrator; this evidence does not claim the subsequent native discovery, binding or review acceptance occurred. No native control-state writes were performed by this worker. `verify_preservation.py` verifies repository-local protected artifacts; it does not infer external engine-state preservation from Git.

## Frozen acceptance and matrix mapping

Exact test titles below are within `convex/qaBlocking.test.ts` unless another file is named. The original focused command executes the entire file without filtering or skips. The full ordinary gate additionally executes the attribution and cleanup suites. Fixture data runs through real registered Convex boundaries using convex-test; external provider transport in attribution tests is mocked. No production deployment or live model call is claimed.

| Frozen criterion / scenario | Exact executed proof |
| --- | --- |
| Persist deterministic current-reference rows on human save | `human content save persists because findings and rejects publish atomically`; compares check, revision and actual hash |
| Current failure blocks readiness and publish | `explicit %s failure persists and blocks both boundaries`, for both `why_how_why_intact` and `uncertainties_distinguished`; shared `expectBlocked` checks typed rejection and unchanged project/scheduler |
| Because failure without stored rows | `legacy rows without QA, revision or hash still get the deterministic gate` |
| Advisory-only QA permits authorized publish | `house-style findings and false verbiage do not block client review`; retains unrelated readiness prerequisites |
| Manager/admin feedback cannot waive | `%s cannot waive findings by reclassifying QA feedback`, for `qa-manager` and `qa-admin` |
| Skeleton/style overrides cannot waive because | `frozen style waivers remove advisory rows but never the because blocker` |
| Human correction preserves history and unblocks changed content | `human correction preserves history without carrying old failure to new content` |
| Byte-identical save/restore cannot clear methodology | `no-op save carries exact-content methodology to the new revision`; `restoring byte-identical historical content carries its methodology failure` |
| Late QA cannot be relabeled current | `QA input uses current content and late completion cannot relabel the old revision`; `convex/generationAttribution.test.ts`: `settles stale QA without attribution and permits a fenced retry` |
| Foreign report/hash isolation | `foreign report identity and stale content hash cannot affect current readiness` |
| Retry deduplication and passing score non-waiver | `same-revision QA retries are deduplicated and a passing score is not a waiver` |
| Unpinned legacy QA cannot establish methodology | `legacy unpinned QA cannot create current methodology findings` |
| Authorization still precedes QA | `publish authorization still precedes QA validation` |
| Canonical creation persists both categories | `single-candidate completion persists both deterministic and methodology failures` |
| All alternate canonical writes persist exact identity | `%s persists findings on the exact resulting revision`, for applyProposal, markProposalApplied, acceptEdit, restoreSnapshot; `project copy persists deterministic findings for the destination report` |
| Invalid candidate scorecard cannot block | `selecting a candidate rejects invalid stored scorecards as blocking evidence` |
| Real post-QA action carries provider evidence/reference | `convex/generationAttribution.test.ts`: `post-QA provider methodology failures persist and block current readiness and publishing` |
| Current iterative input and empty-input recovery | `convex/generationAttribution.test.ts`: `iterative QA captures all current sections instead of frozen approved runs`; `settles empty QA input and recovers after content is restored` |
| Historical DW-92 repairs remain covered | `unpunctuated legacy cross-references preserve uncertainty at both gates and on save`; `late uncertainty heading cannot hide earlier renamed section in %s`, legacy and rich text; `rich-text whitespace-only blank lines cannot borrow an unrelated explanation` |
| New deep-nesting bypass repair | `deep %s retain uncertainty on save and at both gates`, block containers and inline containers; baseline red then repaired green logs |
| Iterative artifact waiver coverage | `convex/generationAttribution.test.ts`: `stamps the frozen set on the iterative report and its ghost comparison snapshot`; artifact-sourced advisory exclusion and exact-reference substantive persistence |
| Cleanup safety | `convex/qaFindingsCleanup.test.ts`: `each transaction deletes only one bounded batch and schedules its continuation`; `unauthorized project deletion retains findings and schedules no cleanup`; `cleanup refuses to remove findings from a live report` |
| Flat result and original history preservation | `python3 .audit/DW-92-native-followup/verify_preservation.py`; terminal marker check remains pending at this pre-finalization evidence commit |

## Initial fresh verification

- Implementation exact focused command: 145 tests passed (`implementation-focused.log`).
- Implementation extraction, attribution and cleanup command: 52 tests passed (`implementation-lifecycle.log`).
- Parent exact focused command: 145 tests passed (`parent-focused.log`).
- Parent `bash scripts/loop-verify.sh`: exit 0 (`ordinary-gate.log`), Svelte 0 errors/warnings, 148 files / 1730 tests, PowerShell 50/50 and Bash 18/18. This script runs Convex tsc first under set -e. Its initial raw output is retained unchanged; final command manifest will add explicit attribution for the silent type check.
- This initial gate precedes the newly found extraction repair. Final repaired-source verification is recorded below when complete.

The PowerShell harness includes a platform-specific dotfile subcase skip. Its aggregate 50/50 is the harness's own report on this host, not proof of execution on Windows. No component/browser test is required because no frontend file changes.

## Final repaired-source verification

`python3 .audit/DW-92-native-followup/run_verification.py` exited 0. It executed the ordinary commands sequentially with no test-timeout overrides. `final-command-manifest.json` records exact argv, start/end times, actual exit statuses, current HEAD, tracked working diff hash and gate script hash. Each command saw the same tracked source diff. The explicit Convex tsc log is empty because the successful compiler emits no output; its process exit is recorded by the wrapper.

| Command | Actual result | Raw output |
| --- | --- | --- |
| `bash scripts/loop-verify.sh` | Exit 0; Convex tsc, Svelte check 0 errors/warnings, 148 files / 1732 tests, PowerShell 50/50, Bash 18/18 | `final-ordinary-gate.log` |
| `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts` | Exit 0; 147 tests in three files, none skipped | `final-focused.log` |
| `npx tsc -p convex/tsconfig.json --noEmit` | Exit 0 | `final-convex-tsc.log` and manifest |
| `python3 .audit/DW-92-native-followup/verify_preservation.py` | Exit 0; original nested spec and ledger byte-identical; no frontend/generated diff; flat result location and baseline correct | `preservation.json` |
| `git diff --check` | Exit 0 after code/test repairs | Parent command observation |

Before/after evidence is adjacent in `review-patches.md`: `deep-nesting-before.log` has two actual baseline failures at registered readiness; `review-patches-after.log` has 91 passing targeted tests with both new cases, persisted rows and publish rejection. `brain-overrides-mutation-before.log` has the intended failing assertion when artifact waiver lookup is disabled; restoration was byte-identical and `brain-overrides-restored-after.log` passed. The final full suite executed all these tests without a name filter.

Review recommendation: true because one high patch was applied. Patched severity counts are high 1, medium 2, low 2; weighted medium/low score is 8. The independent edge reviewer inspected the final repair diff and returned no findings.

No report semantic-classification expansion or frontend changes. The existing sentence-level detector and exact-content methodology policy remain the explicit residual limits. Source/evidence commit and final artifact checks are pending at this pre-finalization evidence commit.

Audit serialization: raw log diagnostic lines are retained; only extra terminal blank lines were removed for Git whitespace checks. The exact initial review diff is retained losslessly as `review-input.diff.gz`; its decompressed SHA-256 is in `review-inputs.json`. The original-history scratch diff is reproducible from the full canonical revisions and explicit argv in that manifest.
