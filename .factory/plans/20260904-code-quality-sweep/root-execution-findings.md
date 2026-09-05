# Execution review findings

## Resolved: PERF1-PROOF-1, sequential PDF fixture timing

Independent source review by audit_performance and root at worktree commit 77825a2 found `src/lib/parseDocument.test.ts:225-246` creates both `after(20_000, ...)` promises before parsing begins. Thus document load and page text delays run concurrently, and page 2 starts at t=20s, despite the comment and ticket AC2(a) claiming t=40s. The test still catches restarting the per-call deadline, and no production timer or search defect was found. Correct the fixture by starting the page text timer lazily when getTextContent is called, or explicitly resolve deferred page text at t=40s; assert the phase timing and keep the 59,999/60,000 boundary and zero-timer checks. Preserve the real baseline-failure/head-pass evidence. Closure required the corrected actual fixture to run with recorded output. The original perf-1 review/QA did not fix this. Follow-up proof-1 merged as 7a32eee after source commit d381a68: the page-text callback is lazy, t20/t40 phase assertions pass, and the eager negative control fails specifically at the page-2-not-called assertion at 20 seconds. Parser 19/19, Editor 4/4 and the 129-file/1430-test full gate pass; engine predicate also passes. QA independently reran the positive suites and inspected the negative-control evidence, with its own temporary eager edit denied by the allowlist. See .audit/proof-1-parser-budget-sequence/qa-0.md, before-negative.log and after-positive.log. Independent audit_performance source review approved the exact two-test-file diff. No production changes or new tests.

## Resolved locally: QA evidence write and deferred metadata preservation

QA could not append its report under its tool allowlist. The engine saved the full structured result as root `.audit/perf-1-parser-timers-editor-index/qa-0.md`; the orchestrator appended a reference and limits to root evidence, so no user action is needed. This running engine retained the integration copy of the ticket and discarded the implementer's four `deferred` entries. Restored those entries from actual commit 77825a2 into the canonical done ticket. Their planned resolutions (UI failures, duplicate Underline) remain pending respective tickets. Preserve source-side deferred entries at subsequent merges as needed. At 07:14 UTC, the on-disk external engine.mjs:168 already contains explicit deferred preservation, so the observed behavior is a limitation of this active run, not a confirmed defect in the current on-disk version. No external factory engine changes were made in this sweep.

## Applied to pending tickets: engine-persisted QA report

For tickets not yet started, added run-specific QA output guidance: return the full report through the structured fields the engine already persists, instead of repeatedly attempting audit-file writes denied by the existing tool allowlist. No permissions or verification requirements changed. Active perf-2 was excluded because its worktree and scope were already loaded. Root will link canonical QA outputs into evidence after each merge.

## Corrected pending DX scope: dependency consumes SITE URL at build time

Slop-1's initial build with only PUBLIC_CONVEX_URL failed with MISSING_EXPORT PUBLIC_CONVEX_SITE_URL at `node_modules/@mmailaender/convex-better-auth-svelte/dist/sveltekit/index.js:3`. Root confirmed installed adapter 0.8.2 imports both public URLs; hooks.server.ts, +layout.server.ts and api/auth/[...all]/+server.ts import that adapter. The earlier source-only review correctly rejected the authClient comment as a reader but missed this dependency consumer. Updated pending dx-1 AC3/AC4 to document both URL placeholders for production-build verification and cite both adapter and uploader setup. Typecheck still needs only PUBLIC_CONVEX_URL.

## Pending DX closure of deleted-component guidance

Restored slop-1's deferred entry from 84ca337: `docs/svelte-migration.md:77` says to reuse ui/MenuToggleIcon and ui/Header, now deleted. Added removal of only those two names to pending dx-1. Its historical note will cover the entire old Verify section (Bun commands, shared server, no Convex edits, no commits), not just the dev-server bullet. No new implementation file or criterion. Read-only GitHub checks also found main reports Branch not protected and repository rulesets list is empty; no external branch rule was changed.

## Corrected: QA commands belong in the explicit engine verify list

Slop-2 QA returned typecheck-only after passing the shared gate, 8 unit cases and 33 browser cases because clean installation, production build and the direct underline proof were not executable under its tool allowlist. Stopped run 20260905-055642-10-tickets during its first fix retry, preserving the worktree and its test-title clarification. Added the three already-approved commands to canonical slop-2 verify and the already-required build command to pending slop-3 verify. The restarted engine executes these independently; its current code also derives scoped QA commands from ticket verify. No new wrapper, permanent test or broad tool permission was added. Root npm ci and direct underline proof exited 0 at the slop-2 source, but its first independent build overlapped the retry installer and failed on missing node_modules/@sveltejs/kit/package.json. That run is invalidated as a verification attempt, not classified as a source regression. Keep root-build.log as the record; rely on the subsequent serialized engine build for a valid result.

## Applied to pending DX: explicit optional and negative preflight proofs

Independent configuration review found that the running engine caches its initial qa.smoke and pending dx-1 had verify:[], so its new optional browser path lacked a guaranteed independent execution. Added the exact optional gate command and the reviewed plan-directory verify-gate-preflight.mjs artifact to the canonical ticket verify list. The default global gate and optional success path are distinct; the artifact tests missing PowerShell/Chromium early exits with owned temporary fixtures and process-group cleanup. Syntax/structure are checked now; actual probe results remain pending DX implementation. No broad bash -c permission or product wrapper was introduced.

## Final DX verification requirement

After all engine work has finished, run the final combined gate with root local node_modules absent so the actual new script proves its npm ci bootstrap, not only an already-installed checkout. Keep all heavy verification serial and do not run installation or builds in an active implementer worktree. DX source review must check that bootstrap failures and each step’s exit code propagate correctly through the step helper, including Bash errexit behavior when functions run as if conditions. The explicit missing-PowerShell/Chromium probes cover early failure; their lack-of-typecheck claim also needs source-order review, as the probe note states.

## Closed: slop-2 operator note and runtime metadata preservation

Slop-2 merged as 7b9b01e, done commit ac69311, source 1ac92ae. QA test-verified with a remaining operator note; the engine already independently ran npm ci, the build and the direct underline proof successfully. Root reran the exact bare underline command after merge and confirmed the relevant source/package files match 1ac92ae. Linked all proof in root evidence and corrected the two-line stale diff statistic. No user action remains. The restarted engine preserved all four implementer deferred entries automatically, confirming the current on-disk deferred-copy fix works. The explicit Underline registration issue is resolved; its dependency declaration stays as planned. Build-gate and Bun-lock deferrals remain assigned to dx-1 and tests-3.

## Pending DX closure of retired Disclosure example

Independent review approved slop-3’s exact eight-file/506-line deletion and found one stale adopter citation in docs/design-system.md:403. Added removal of only MyWorkGroup from that adoption list to pending dx-1 AC5 and its predicate. Root confirmed ProjectsClientGroup.svelte:40,243 and WorkspaceHeader.svelte:13,194 still import and render Disclosure, so the design rule and those two examples remain accurate. This is one documentation file (eleven implementation files total for dx-1), no new criterion or product behavior change.

## Dismissed: slop-3 historical sorting clause

The slop-3 reviewer’s low/consider claim about docs/product-domain.md:797 is dismissed after context review. The clause says the preview may reorder only loaded rows, a permission/constraint rather than an obligation to keep a sort control. Lines 736–741 supersede the five-lane layout; lines 727 and 634–638 record approved removal of those Home regions/subscriptions; the approved August 14 amendment at 330–340 makes With you the only operational Home subscription. Retained MyWorkLaneSort.component.test.ts:25–45 explicitly requires the assigned-only subscription and no sort control; CurrentMyWorkView retains its frozen accountability tabs. Independent audit_slop review reached the same conclusion. No new product-domain amendment, implementation, or deferred obligation is warranted by this deletion.

## Corrected: parameterized project-access baseline count

Tests-1 retains 83 pure cases, prompting reconciliation with the 116-case original Bun run. The pending tests-2 pin had incorrectly called projectReviewAccess six passes: those are its standalone cases, plus four test.each actor rows. Root ran the unchanged file directly (project-access-pin-count.log), exit 0, 10 pass/0 fail/44 assertions. Corrected the pending ticket to ten. The total reconciles: 84 original pure cases, 22 proposal cases, 10 access cases =116. No test behavior or product code changed.

## Corrected pending DX: supported Node versions

Root inspected installed package engines: Vite 8.1.5 requires ^20.19.0 || >=22.12.0, Vitest 4.1.10 requires ^20.0.0 || ^22.0.0 || >=24.0.0, and vite-plugin-svelte 7.2.0 requires ^20.19 || ^22.12 || >=24. The original planned major >=22 preflight would accept unsupported early 22.x and 23.x. Corrected pending dx-1 AC1 to 22.x >=22.12 or >=24, retaining Node 24 as the documentation and CI default. No package versions, project engine declaration, dependency or new abstraction changed. Final runtime proof uses Node 24; source review must confirm the numeric branch matches these installed constraints.

## TESTS2-REVIEW: migration preservation and scheduled-job isolation

Independent review found three lost positive reader-role query cases, a live-turn fixture using real timers around a scheduled streaming action, and a fragment-only ordered prose assertion. Run 20260905-072238-8-tickets was stopped before acceptance. The existing engine-created ticket worktree receives a bounded factory-implement fix, then the remaining four tickets will resume through normal engine review and QA. Canonical tests-2 scope now explicitly includes the harmless temporary-exclusion cleanup already paired with file deletion; fresh open-PR query returned []. Details: root-tests2-review.md. Status: OPEN.

## FINAL-PROOF-ISOLATION: preserve the existing dev server

Read-only process inventory found an existing root Vite server on port 3001 (PID 63213) using the root node_modules. Final cold-bootstrap proof must not remove or replace its dependencies. Instead, use an owned disposable local clone under .audit/final-sweep at the exact final integration SHA, with a detached checkout, no product edits, no copied .env.local, explicit public placeholder URLs, and no initial node_modules. The real gate then bootstraps dependencies and git-based test discovery still sees every tracked file. This is isolated verification only; all implementation remains in factory-created ticket worktrees. Check source cleanliness afterward and report the exact revision and evidence path.

Correction from independent DX review: place the disposable verification clone outside the live repository in an owned unique OS temporary directory, then copy its evidence into .audit/final-sweep. A clone nested under .audit could resolve dependencies upward from root and would fall inside the existing Vite watcher. Require actual npm-ci bootstrap output and creation of local node_modules; retain the clone until proof is reviewed. No source edits or private environment copies. This supersedes the nested-checkout location above.

## DX-PROOF-HARDENING

Independent review added a third actual-gate audit probe: an owned npx shim rejects unexpected invocations and injects exit37 only for the existing Convex tsc command; the wrapper must preserve37, name step2 and start no later step. Syntax and 21 structural checks passed; actual execution awaits dx-1. Final cold default verification uses an absent browser cache, records actual dependency bootstrap, and optional verification requires component counts. Node boundaries are source-reviewed unless separately executed. Before the real cold bootstrap in the owned external clone, root will also exercise a controlled npm-ci failure and verify it stops preflight with that code; this checks the known Bash errexit-in-conditional pitfall without touching live root dependencies.

TESTS2-REVIEW correction source is now c755e003c7027135c9adf5ac3e67c617ddc7cce5, root source review approved and full gate/predicates green. Run20260905-085105-4-tickets (PID78635) resumes the four remaining tickets serially. The correction agent handed off clean and no longer writes the worktree. Factory review/QA are pending; root-tests2-review.md records exact proof and review limits.

TESTS2-REVIEW closed at merge14e80a0: source c755e00, review1 approve, QA1 done/test-verified. The resumed factory review caught stale Coverage line pointers; its audit-only fix reran the gate and corrected them. Root integrated evidence distinguishes32physical mapping rows from34expanded old cases, preserves historical pointer provenance, and records the optional deletion-survivor assertion improvement. No production source changed in this ticket. Eight of eleven tickets done; tests3 active.

## Hosted-runner prerequisite verification

On2026-09-05, the official [runner image table](https://github.com/actions/runner-images#available-images) maps ubuntu-latest to Ubuntu24.04, whose [software manifest](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#powershell-tools) lists PowerShell7.6.5 in image20260823.283.1. The proposed CI job can invoke pwsh without adding an install step. This is published-environment evidence; no remote CI job was run.

Tests-3 integrated at292e145 (sourcead9952f), review approve and QA done/test-verified. Root evidence corrects two minor imprecisions and records QA’s three skipped commands. Final owned external clone must prove actual cold bootstrap, default/no-browser discovery, and a tracked scripts/zz.orphan.test.ts failure with cleanup. Two nonblocking portability limits remain in ticket deferred metadata. Nine of eleven tickets are done; ui-1 active.

## UI independent review delivery

Factory session.mjs:53-58 supports a root-owned .factory/skills/factory-review.md project extension, including hand-written input. Root created a temporary uncommitted hook pointing only the UI review at root-ui-review.md, carrying actual independent observations without editing another worktree, changing permissions, or stopping the engine. It is strictly scoped to ui-1 and must be removed after UI review/QA completes. The normal reviewer independently triages the observations. Planning commits include only tickets/plans, so this hook is not staged.

## UI integrated and temporary hook removed

UI source85efbce merged as acf55d9, done1336bef. Review0 approved; QA0 independently reproduced the same eight baseline failures, restored the clean head, and ran the full unit gate (140files/1516tests, uploader50+18), focused43 browser cases, and full51files/292cases successfully. Root inspected all four before/after screenshots: mobile390 grows41x32 to44x44; desktop1280 remains121.67x32 with byte-identical screenshots (SHA256 dc469843e16b32c1bcfe8aa723693eb01ff0a234e66d4c3f5d524831fe72eaa9). This is component-harness evidence, ladder4, not a routed/authenticated app journey. Root removed the UI-only temporary review hook after checking its unchanged SHA256; the now-empty .factory/skills directory was removed. No permanent review override remains.

Review0's three nonblocking test-hardening gaps are preserved in the UI ticket: actual Settings activation/drawer close, dialog-control width as well as height, and explicit viewport restoration. Evidence corrections: AC5's ladder5 claim is superseded by ladder4; workspaceRoutes post-edit preserved gate-case ranges are66-72 and108-118, not62-68 and104-114. The unrelated escalated ticket and its source content remain untouched.

## DX draft preflight-order review input

At09:57UTC root and audit_dx independently found the draft's npm-ci bootstrap before preflight. That breaks cold-checkout named/missing-tool behavior; moving it into the conditional step function must explicitly propagate its exit status. The current installed-dependency probes cannot alone establish cold-tool ordering. Root saved root-dx-review.md and a temporary DX-only factory-review extension using the supported project hook. SHA256283be94c8116e1723ce7f5a2c9c4fafcb59d4538f8ae9060f0786f3343efbf94. The normal reviewer must independently check the final head, and root must remove this unchanged hook after DX review/QA. A README configuration-copy ordering concern is included as a documentation consideration. No active worktree edit or engine interruption occurred.

## Final gate capture review and interruption proof

Root prepared capture-final-proof.py to run the actual gate twice in the final owned external clone, recording exact revision, exit, timing, raw logs, expected step order and observed counts. Independent audit_dx review found missing SIGTERM handling and a missing final HEAD check. Root corrected both, added full git-status checks and controlled Bash startup/color/CI environment, and refused optimized Python assertions. Audit_dx then ran one explicitly synthetic controller probe, with a TERM-resistant gate in its own temporary git fixture: SIGTERM ended capture in1.596seconds with exit1, interruptedSignalSIGTERM and passedfalse; SIGKILL removed the gate process group. Fixture cleaned; no app test, dependency install or build was run. Evidence: .audit/code-quality-sweep/capture-controller-proof/controller-proof.json. This establishes controller cleanup only; actual final application gate proof remains pending.

## DX review1 caught a false environment-reader finding

Review1 rejected one remaining issue: the implementer claimed ingest.ts reads process.env.n and therefore omitted BRAIN_CONTEXTUAL from env.example. Root verified actual source atconvex/ai/brain/ingest.ts:13 reads process.env.BRAIN_CONTEXTUAL, and docs/the-brain.md:134 documents the flag. The implementation event at09:56:53 used `rg -rn`: ripgrep treats this as replacement argument n, so its displayed result rewrote the matched variable name. Root reproduced both commands against the actual file in .audit/code-quality-sweep/ripgrep-replacement-reproduction.json. This is an audit command error, not a Convex runtime bug. Fix2 restores the comment and removes the false deferred entry; the normal review caught what the bounded cross-model trail review did not. No runtime change is required.

## DX fix3 wait-path correction

The optional gate completed at11:08UTC with51files/292cases and EXIT=0 in the worktree's .audit/dx-1-one-verify-entry/gate-component-fix3.log. The following bare-filename wait ran from the worktree root, looking for gate-component-fix3.log there forever. Root verified the completed real log and process ancestry, then terminated only that owned waiting process group95100 (parent80912); the actual gate was finished. No source, dependencies, worktree ownership, engine or user process was changed. Use absolute artifact paths and bounded waits; an unbounded grep loop can hide a completed check.

## DX accepted and temporary hook removed

Recorded 2026-09-05T11:34:13.091006+00:00. DX review-3 and QA-3 passed at source125c6cd; engine merged5583a25 and finished at11:27:55Z. QA independently reran the default gate, optional component gate and preflight probes. All11 sweep tickets are done. Root verified the temporary DX-only review hook SHA256 before removing it; no active worktree was edited. Final combined proof follows in an external disposable clone.

## Root audit-clock closure

Recorded 2026-09-05T11:35:33.048135+00:00. Independent GPT-5.5 final DX review found that decisions.tsv row28 retained the manual10:49:00Z timestamp. The engine append event is events.jsonl:751 at2026-09-05T10:41:25.842Z. The appended correction records the historical row as10:41:25Z. Fix3 had already corrected rows29-38 and retracted row16's317-package claim in favor of the actual455-package install. Source and runtime evidence are unchanged.

## Final combined isolated proof

Recorded 2026-09-05T11:40:07.784967+00:00. Verified immutable revision `7af741428d4d67a94cec7556b8a5b74eb2152efa` in an external OS-temp clone with no ancestor/local dependencies and no copied `.env.local`. The cold default gate exited 0 in 91.861 seconds, installed 455 packages, and passed all 8 steps: 140 files / 1,516 tests, 191 discovered files, production build, and 50 PowerShell plus 18 Bash cases, with an absent browser cache. The optional full gate exited 0 in 112.763 seconds, passing all 9 steps including 51 files / 292 components. Both left source and HEAD unchanged. Toolchain: macOS arm64, Node 24.19.0, npm 11.17.0, PowerShell 7.6.5.

Cold missing Node/npm/PowerShell each exits 1 before install; injected npm ci preserves 38 and names preflight. With dependencies installed, missing PowerShell/Chromium each exits 1; injected Convex typecheck preserves 37 at step 2. Browserless discovery finds 191 files; an owned staged orphan fails with exit 1 by name. After fixture/index cleanup the guard returns 0 / 191 and source is clean. Root therefore closes tests-3's restricted QA paths without weakening the guard. Exact commands, raw logs, source hashes and exits are under `.audit/final-sweep/banhall-sweep-final-znn0f7pu/`, indexed by `manifest.json`.

Root source reconciliation confirms all three measured production files equal their respective benchmarked versions. Final dependency delta: five direct dependencies and 146 lockfile entries removed, zero added lockfile entries, and zero surviving version/resolution/integrity changes. The baseline-to-verified diff excluding factory/audit/retired Bun lockfile is 73 files, +2,323 / -5,153; also excluding the npm lockfile gives 72 files, +2,318 / -3,104. These totals include test coverage and setup/docs additions; 17 unused files account for 1,316 deletion-only lines. Subsequent root edits are audit/planning/ticket metadata only. No remote CI, deployment, shared backend or authenticated E2E execution is claimed.

## Final review and cleanup

Recorded 2026-09-05T11:44:01.345112+00:00. GPT-5.5 final combined artifact review passed with no remaining actionable flag or hidden blocker; scope and limits are in final-trail-review.md. Root verified all21 manifested file hashes, the disposable clone's clean source and exact HEAD, then removed only the owned external temporary container. Raw evidence remains under `.audit/final-sweep/banhall-sweep-final-znn0f7pu/`; cleanup.json records the removed path. The temporary DX review hook is absent. Final closeout changes are planning/audit/ticket metadata only.
