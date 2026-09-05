# Native QA ledger escalation recovery audit

Read-only inspection on 2026-09-04, GPT-6 Astra medium. No worker, target, ledger, installed engine, or native run state was mutated. This report is the only written artifact.

## Conclusion

Commit/preserve the unchanged native-produced ledger close if needed, but **do not resume using only the preserved worker/ref**. Native isolated sweep recovery deletes that worker and starts from the run's pinned `codex/bmad-completion` target. Both reviewed worker content and the spec resulting from native rearm must reach that pinned target before resume.

## Observed state

Project: `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion`; run `20260904-162523-6e72`; bundle `dw-blocking-qa-native-followup`.

- Actual native task phase is `escalated`, pause stage `escalation`, dev attempt 1 and review cycle 1. The run is not finished. Adapter, dev, review, and triage snapshots use gpt-6-astra with medium effort.
- Correct binding is `_bmad-output/implementation-artifacts/spec-dw-92-blocking-qa-native-followup.md`, inside the recorded worker. Baseline is `9da55bece5948da12129720dd2330a3032c985bf`.
- Worker HEAD inspected: `828cc5a`, preceded by `8330ad2` review evidence and `c94860f7e2bf37d863acc1446692fc622f236bc4` dev finalization. Its sole dirty tracked file is the deferred ledger.
- Dirty diff changes DW-92 from `status: open` to `status: done 2026-09-04`, adds the native bundle resolution and operation-specific resolution-undo line. All other ledger content is unchanged.
- Journal contains `sweep-bundle-closed` for DW-92 after accepted dev. State retains `bundle_closes_intended: [DW-92]`. This supports the origin of those exact dirty bytes; preserving them is not inventing a closure.
- Review terminal result is genuinely blocked on clean-copy finalization. Its recorded evidence reports 1,732 tests, both typechecks, 50 PowerShell and 18 Bash checks, focused 147 tests, four review layers. This audit did not rerun those tests or independently certify their raw logs. Neither the provisional ledger close nor this audit establishes final native acceptance.

## Supported sequence

1. Confirm native coding child and engine have stopped. Snapshot exact state/journal/ATTENTION, worker HEAD/diff, and needed ignored evidence; preserve a separate ref. Root already owns this preservation work.
2. As operator, stage and commit only the existing native-generated ledger bytes, retaining their resolution-undo field. Record their journal provenance. Do not change status text or fabricate another resolution. Preserve all existing reviewed commits and evidence.
3. Run the BMAD resolve skill against the actual escalation and native resolve with `--no-resume`. Document that the block was an operator-owned dirty ledger and that the exact native closure has been preserved. Do not request patch restoration or manually change phase/status/baseline.
4. Inspect the native rearm output. It normally clears stale terminal output, sets ready-for-dev and restamps baseline. Preserve these exact natively written flat-spec changes in a commit. **Merge/preserve the reviewed code, review evidence, unchanged native ledger close, and natively rearmed spec onto pinned `codex/bmad-completion` before invoking resume.** Preserve target changes and resolve conflicts by evidence; never replace its whole ledger blindly.
5. Check clean pinned target, correct flat spec, ancestry, and physical bootstrap dependencies/policy. Resume through native CLI. This is a fresh bundle drive, not an in-place review continuation. Require fresh genuine review/verification evidence and final native done/integration events before claiming QA acceptance.

The precise ordering of the first code-preservation merge relative to resolve can vary, but after resolve the rearmed spec must be committed on the pinned target. A worker-only commit or preservation ref does not meet that condition.

## Source support and hazards

Installed source root: `/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/`.

- `sweep.py:797–872`, `_recover_inflight_bundle`: in-place recovery exists only for COMMITTING or accepted DEV_VERIFY. The ordinary rearmed path calls `_discard_unit_for_restart` then sets pending.
- `engine.py:1360–1433`: discard removes mount/run branch and releases mount-owned baseline/spec fields. A fresh drive remeasures the new mount.
- `worktree_flow.py:1485–1500`: new unit mounts from `state.target_branch`.
- `runs.py:3654–3734`, `rearm_escalation`: native rearm owns phase, generation, frontmatter, and baseline changes; patch-restore is rejected with worktree isolation.
- `runs.py:4191–4249`: native rearm advances baseline and restamps the bound spec. Do not counteract this by manually restoring historical baseline values; retain original implementation baseline as review context.
- `runs.py:4461–4475`: explicit native warning states that isolated rearm writes land in a discarded tree and the corrected spec must be committed on the pinned target before resume.
- `sweep.py:1714–1747`: `_close_bundle_ledger_when_spec_status` records intended IDs and writes a native reopenable close. Such a close can already exist before final review completes, as in this run.

Avoid changing isolation just to enable patch restoration, faking DEV_VERIFY/COMMITTING, manually flipping a terminal marker, deleting resolution-undo provenance, or interpreting a done ledger row as final run acceptance. A restart may produce another native ledger mutation if review repairs reopen/reclose the bundle; inspect real ownership and retain normal native gate behavior rather than suppressing it.

## Critical follow-up: preserve the close separately from target integration

This section refines and supersedes the recommendation above to merge the unchanged native close onto the target.

**Rearm/resume does not reopen target DW-92.** Native `runs.rearm_escalation` changes task/spec recovery state, not deferred ledger status. `sweep._loop` (`sweep.py:584–590`) runs `_finish_inflight_bundles` before reading the current open set. That routine (`:644–684`) drives each persisted nonterminal bundle by its existing task key, independent of the ledger's open status. Thus a rearmed same-run bundle is not skipped merely because its row is already done. `verify.verify_dev_bundle` (`verify.py:3600–3648`) validates artifact/proof and claimed IDs, with no requirement that the row be open. Normal review requires it done.

However, publishing this provisional close onto the target is avoidable and weakens the intended failure behavior. The only bundle reopen path is `_reopen_ledger_after_defer` (`sweep.py:1746–1765`), using `mark_open_many` with the exact run/task operation ID. `Engine._defer` (`engine.py:6641–6663`) returns early for isolation; the reopen hook is reached only later by the in-place rollback path (`:6704`). Under isolation the design assumes an unsuccessful unit's unmerged close dies with that unit. If its close were merged to target early, another isolated failure could leave the target row done without final acceptance.

**Recommended exact preservation sequence, without manual ledger status edits:**

1. Preserve current reviewed history through `828cc5a` and snapshot the dirty native ledger as already done by root.
2. If a clean worker is needed for resolve, commit its exact unchanged native ledger bytes in a standalone preservation commit **L**. Retain L on a separate preservation ref. Do not merge L onto the target.
3. Use the normal BMAD resolve workflow and native `--no-resume`. Commit the resulting native rearm spec changes in a separate commit **R**. Verify R touches only the bound flat spec (plus separately reviewed recovery documentation if intentionally included), not the ledger or native state.
4. Merge the reviewed worker history only through **828cc5a** onto pinned `codex/bmad-completion`, preserving all target work. Then cherry-pick **R**, which carries the native spec changes without its ledger-only parent L. This is ordinary Git preservation, not hand-authoring state or reopening a row.
5. Verify the target ledger's DW-92 remains its existing open bytes and that no other ledger entry was changed by these recovery commits. The provisional close survives in L and backups; it is deliberately not published as target completion.
6. Resume the same native run. A fresh isolated worker gets the corrected committed spec and target's open row. Native accepted dev closes it again, with the same run/task operation identity. Only successful normal native integration carries that close to target.

Do not call the installed internal `mark_open_many` directly as an ad hoc recovery API. No such call is needed in the sequence above. Do not reset or rewrite the preserved ledger commit, and do not manually edit the row to open.

## Minimal clarification to prevent the dirty-ledger loop

A narrow project AGENTS note and matching active flat-spec clarification are appropriate operational corrections. They do not change product behavior or transfer ledger authorship from the native engine. The current flat spec says “Never: Edit the deferred-work ledger” at line 28; its acceptance condition at line 64 also says the ledger is unchanged. The latter is too broad once accepted dev legitimately changes that file before review. Clarify that the worker must not author ledger changes, while native changes may exist.

Suggested wording:

> The native BMAD orchestrator owns deferred-work ledger content and status. Do not author, revert, regenerate, or manually change ledger entries. During native finalization, you may stage and commit the exact unchanged ledger bytes written by the orchestrator, alongside your reviewed artifacts, when native journal/state or the invocation snapshot establishes their provenance. Confirm the working-tree bytes and staged blob match that snapshot and record the evidence. Do not stage unexplained ledger changes. Committing an existing native close does not itself establish final run acceptance.

For the flat spec, amend its future acceptance/preservation language to “no worker-authored ledger changes; preserve any native-owned ledger bytes unchanged,” and add the explicit permission above. Preserve historical claims and actual blocked result in audit history rather than retroactively editing past evidence. Native rearm remains responsible for active status/baseline/terminal-marker changes.

Add this project-specific note outside the managed AGENTS block so refresh does not remove it, and ensure it reaches the pinned target before new workers mount. It is a clarification of staging versus authorship, not permission to stage arbitrary dirt or an installed-engine patch. The worker should still run standard checks and produce real final evidence.

## Final baseline-ordering check

**The proposed nonancestor L baseline is not what native rearm writes for this run.** `runs.py:4151` assigns `repo = state.code_root`; its subsequent `rev_parse_head(repo)` at the baseline-advance block supplies the value written at `:4191`. `model.py:751` defines `code_root` as `repo_root` when present, falling back to `project`. The inspected state sets both to `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion`, not the isolated worker. Consequently committing ledger-only L in the worker does not make L the rearm baseline. R receives the integration checkout's current HEAD at resolve time. Provided the integration checkout stays on its pinned target and advances by ordinary merge/cherry-pick, that HEAD remains an ancestor of the fresh target. Inspect and record the actual native-stamped value rather than assuming it equals L.

The actual ordering also contains no native pre-dispatch ancestry test of that spec frontmatter:

1. Isolated sweep restart discards the old mount and releases mount-owned baseline fields (`sweep.py:862`; `engine.py:1425–1433`).
2. A replacement worker mounts from pinned target (`worktree_flow.py:1491–1500`).
3. Fresh `_dev_phase` captures its own `task.baseline_commit` from the mounted current HEAD (`engine.py:2289`) and ledger digest. It binds/reads the actual spec bytes before launching (`:2347`, `:2390–2405`). These preflight checks concern path confinement, readability and snapshot ownership, not `baseline_revision` ancestry.
4. `_run_session` applies session hooks, then refreshes/validates snapshot ownership (`engine.py:5499–5560`). There is no spec-baseline ancestry gate in this native launch path.
5. BMAD `bmad-build-auto/step-01-clarify-and-route.md:21` routes an explicitly supplied ready-for-dev spec to step 03. `step-03-implement.md:20` captures **current HEAD** into `baseline_revision` before any implementation change. Normal sweep first dispatch supplies bundle intent rather than an explicit spec pointer (`sweep.py:1650–1655`), so do not claim this early-exit is guaranteed for that prompt. Its normal plan-to-implementation route still reaches step 03, which owns the fresh capture. Any intended spec reuse should be clearly documented in the bundle/spec content; do not manually force in-review to bypass step 03.
6. Only after the dev session returns completed does `_dev_phase` invoke `_verify_dev_artifacts` (`engine.py:2494`). Sweep delegates to `verify_dev_bundle`, which applies `_verify_shared_gates` with `allow_ancestor_baseline=True` (`verify.py:3625–3634`). This is where a remaining nonancestor/stale claimed baseline would fail, rather than before step 03.

Thus the safest existing sequence stands: keep L on a preservation ref, preserve reviewed source through 828cc5a onto target, use native resolve without resume, carry spec-only R without L, verify R's actual native-stamped baseline is an ancestor of final target, then native resume. Merging reviewed source before resolve makes the native baseline name that preserved target directly; merging afterward also preserves ancestry. If inspection unexpectedly shows a worker-only/nonancestor value, stop and investigate the actual state roots rather than hand-editing baseline or relying on a later workflow step to conceal it.

## Post-recovery operator verification

Bounded read-only verification after root performed recovery. No new defect found in the inspected preservation, rearm, mount, or bootstrap sequence. Native acceptance remains pending.

- Integration is clean at `86a43d9d500ceab34245744d223d4453eba7b667` on the pinned target. Reviewed `828cc5a`, entrypoint `19b7505`, and AGENTS note `89b4eeb50e40b38cc7acd42215ab4b9876e35cab` are ancestors. Ledger-only L `5c2765316db129c93127551b78068d1a1a37e55b` is not an ancestor.
- Target ledger SHA-256 is exactly `fb971a062155ae6673cc6f145640b64bcf2e6423812b9f830f00d8a58547af97`, preserving the pre-recovery open DW-92 bytes.
- R `172a05eca5e177bf409bc3f2abec43118b899eee` changes only the bound flat spec. Its resulting spec equals the target spec exactly. Diff contains the operational ownership clarification, native ready-for-dev/baseline reset, and removal of stale terminal output. Product contract remains unchanged. Actual native journal records baseline `89b4eeb50e40b38cc7acd42215ab4b9876e35cab`, confirming the predicted integration-root baseline source.
- Native journal sequence is genuine: `story-escalation-resolved` (restore false), `run-resume` (security/code-root/policy unchanged), `plugins-active`, `sweep-inflight-redrive` rearmed true, `resume-restart`, `worktree-opened`, blocking `npm-bootstrap` `pre_worktree_setup` rc 0, then Astra dev session `dw-blocking-qa-native-followup-dev-1-g1`.
- Fresh mounted HEAD is `86a43d9d500ceab34245744d223d4453eba7b667`. Mounted AGENTS and flat spec matched target bytes at inspection; the new ledger-finalization clarification is present. The mount was clean before the new agent began work.
- Latest state is `dev-running`, generation 1, with actual newly captured baseline `86a43d9d500ceab34245744d223d4453eba7b667`; paused reason/stage are cleared, finished false, crashed false.
- Live Codex process IDs 84957/84969 launch this exact bundle with gpt-6-astra and medium configuration. Journal independently records Astra for the new session. Parent/wrapper pair is one launch, not duplicate independent implementations.
- Final bootstrap manifest SHA-256 is `20fb58d4717b0377b3cc47ee3fc7f5074b48e3f6943472dd39c7d521972c687a`. Worker node_modules and .svelte-kit are physical roots, not symlinks. Resolved tsc, vitest, svelte-kit, and generated tsconfig all exist inside this worker. Successful blocking bootstrap precedes SessionStart.

This verifies recovery and initial live execution only. It does not certify a completed story, subsequent review, verification gates, or final native integration. Continue monitoring the actual task through those stages.
