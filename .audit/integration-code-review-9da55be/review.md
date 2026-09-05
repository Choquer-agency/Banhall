# Integration review at 9da55be

Both Sprint 2 SPEC kernels and implemented story contracts supplied full-mode context. The kernels contain no Tasks/Subtasks or story Status section, so findings are recorded here; no epic contract or native story status is rewritten. No story key exists for this combined review, so sprint sync is inapplicable.

Six patch findings, two existing concerns deferred, six findings dismissed against explicit accepted scope or already pending native decisions. Existing user authorization selects applying all patches. Reviewer judgments were checked against source call sites and frozen contracts before routing. This is an intermediate integration review, with later source changes and final review/gates still due.

## 1. Shared live report can change after publication

defer; medium; blind-hunter. convex/reports.ts:30-35,64-72; convex/projects.ts:1047.

Live sharing and mutable report identity predate this branch. The approved QA change gates readiness and publish mutations; pinning shared copies or adding an egress/edit gate changes the domain workflow. Preserve as a separate existing sharing concern, not an unapproved expansion of CAP-8.

## 3. Because detector accepts a substring

defer; low; blind-hunter. convex/ai/qaChecks.ts:101-104.

The existing sentence-level /because/i detector predates the change and is deliberately retained by the frozen QA contract. This specific substring limitation is distinct from the multi-uncertainty case in DW-71; changing the detector requires focused work under its own intent.

## 8. Prompt-program analyzer routing disclosure is stale

patch; medium; blind-hunter. convex/ai/promptProgram.ts:300; convex/ai/pipeline.ts:674-687.

CAP-10 now deliberately uses fixed MODEL for compare and retains selected single model. Canonical disclosure must describe both. Completed bmad-build in Banhall-bmad-analyzer-provenance-fix at bbaa9d20a9607d6463ee5298e1a5c9d8aebf19df: three reviews, three low patches, seven rejected expansions, 71 focused and 1733 full tests, both type checks. No runtime model-policy change or broad DW-7 expansion. Root inspected actual descriptor/action/hash diff and triage. Integration remains pending while the native target is frozen.

## 10. Retired launcher can destroy existing worktrees

patch; high; blind-hunter+edge-case-hunter. scripts/loop-parallel.py:169-171.

Actual integration resurrection at 021f0b4. Removed in reviewed local repair 19b7505738f2477ab646b763f6ae3d659c74d96b, along with unused legacy retry/push wrapper. Merged while the native run was paused, then source verifier passed at 89b4eeb50e40b38cc7acd42215ab4b9876e35cab before native resume. The fresh worker starts from 86a43d9d500ceab34245744d223d4453eba7b667; final shipping checks remain due.

## 11. Retired launcher ignores requested base

patch; medium; blind-hunter+edge-case-hunter. scripts/loop-parallel.py:142-171.

Distinct cause, same retired executable. Removal in 19b7505738f2477ab646b763f6ae3d659c74d96b eliminates this entry point; no replacement collector added.

## 12. Retired launcher collects failed or paused lanes

patch; high; edge-case-hunter. scripts/loop-parallel.py:187-200.

Removal in 19b7505738f2477ab646b763f6ae3d659c74d96b eliminates this unsafe lifecycle path. Native state/commit/verification evidence remains the completion authority.

## 13. Production review-decision submission lacks runtime coverage

patch; medium; verification-gap. src/lib/components/project/ProjectWorkflowMenu.svelte:290-299.

Confirmed DW-43. Completed bmad-build in Banhall-bmad-review-menu-verification at 97e32b72891c6d50d45191ac272607936fba1628: three reviews, five low test improvements, 315 component and 1730 full tests. Real menu/dialog with mocked transport catches a deliberately removed reviewDecision spread; exact original production source restored. Root inspected tests, shared stub delta, triage and evidence. Integration and native ledger closure remain pending while the target is frozen.

## 14. Phone redaction removes line breaks

patch; medium; acceptance-auditor. convex/lib/deidentify.ts:77-78.

Direct runtime reproduction violates story2 prose-structure invariant. Reviewed repair ae1c59b39beb0a85867c0df539152c01569be65b plus evidence d868ad1d88436d2cfb803c1083d0f1ff8479d94f passes 1744 tests, checks and uploader harnesses; merged while the native run was paused into 27990509734d4077794c07c593e01c6576dac32e, before native resume on 86a43d9. Final combined verification remains due.

## Coverage

No reviewer layer failed, but test additions and tooling were sampled. Each layer records its limits in its original result. No exhaustive 17,273-line review or final merged-head execution is claimed. No main promotion is permitted from this review alone.

## Native QA recovery at 86a43d9

Reviewed QA source/evidence through 828cc5a was preserved on the target with DW-92 still open. A standalone native-ledger preservation commit 5c27653 remains excluded. Native resolve rearmed the corrected operational spec; only spec commit 172a05e was cherry-picked as 86a43d9. The target AGENTS clarification permits committing unchanged native-produced ledger bytes after provenance/equality checks, without authoring state. Fresh bootstrap passed before Astra medium dev launch. See qa-ledger-escalation-recovery.md for independent lifecycle verification. This recovery does not itself close DW-92.

## Native PED acceptance and later independent audit

The native sweep accepted QA follow-up DW-92 as bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d and PED follow-up DW-93 as b984822a8aeb70b7eb48a5d617ed18846392b1d2. Integration 1cd1eb50f343007b3060c72d6ccbfaf5e0b72f35 contains both. Actual native results, gates, merge events and ancestor checks are retained in qa-native-acceptance.json and ped-native-acceptance.json. Historical intermediate review chains are retained on separate preservation refs.

A later bounded Astra PED audit found no actionable acceptance or product defect. The audited product diff is empty; invocation-bound preservation checks intentionally reject the new post-native ledger, which now contains DW-95. The report does not misstate historical replay as a current gate. QA structural-boundary audit likewise found no new in-contract defect and its reviewed extractor hash matches accepted code. Native advisory rows DW-94 and DW-95 remain visible pending deliberate ledger triage; neither is silently closed by this report.

Verified original capability completion is 14/19. Learning 4 needs the unanswered mixed-stream diversity decision and 5–8 remain queued. Analyzer and menu helper commits are reviewed, clean and independently fingerprint-verified but not yet integrated during the native target freeze. pending-merge-plan.md records their exact source bindings and final combined gates, including both public environment variables for production build.

## Reviewed work closeout at e13e6253d0440ec4b28ea9ca5605fe7dbdc77d05

All six patch findings are integrated. Analyzer merge `d6890710` and menu merge `e13e625` join the completed five-bundle native sweep at `434db602`. Each bundle has an accepted commit and merge receipt in `native-sweep-completion.json`; the CLI's six done tasks include triage. The separate combined delta review found no concrete integration defect within the approved scope.

Fresh verification at `e13e6253d0440ec4b28ea9ca5605fe7dbdc77d05` passed 1,849 unit/backend tests across 148 files, 315 Chromium component tests across 53 files, Convex TypeScript, Svelte check, both uploader harnesses, and the production build. Svelte reported zero errors and warnings. Existing PowerShell platform skips and browser mock warnings remain in the raw logs. The retirement verifier and source/vendor/docs whitespace check pass; verbatim review prompts and historical native specs retain documented whitespace. See `.audit/integration-combined-e13e625/`.

Root BMAD review actions: zero decision-needed findings, six patches handled, two existing concerns deferred, and six dismissed findings. Only the two new review deferral bullets were appended; all existing native ledger bytes were preserved. Workflow.on_complete resolved empty. No epic or native statuses were rewritten. Learning story 4 still needs the diversity decision; stories 5–8 remain queued. This closes review of completed work, not all 19 requirements or main shipping.
