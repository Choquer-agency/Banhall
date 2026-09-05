---
title: 'Native BMAD dependency bootstrap'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: 'c7075572f14e51433b524026db55d5520eddde03'
review_loop_iteration: 0
context: ['docs/bmad-loop.md']
---

<frozen-after-approval reason="user authorized repair of failed native loops and verification">

## Intent

**Problem:** A fresh native worker can inherit dependencies through ancestor resolution or receive broken executable files when 0.11.1 copies node_modules seeds. The copier follows npm executable symlinks, causing TypeScript and Vitest entrypoints to resolve sibling modules from the wrong directory. This prevents otherwise valid stories from passing their required gate and wastes recovery attempts.

**Approach:** Use BMAD's native declarative worktree setup hook to install the pinned npm dependencies and generate the worker's own Svelte configuration before a coding session starts. Retire the node_modules seed recommendation. Keep the native engine responsible for lifecycle, retries and completion.

## Boundaries & Constraints

**Always:** Use the installed native plugin loader and enforcing lifecycle stage. Each worker owns a physical installation, runs npm ci with development dependencies, and uses its own lockfile. A setup failure must prevent coding. Preserve Astra medium across all roles, native independent review, verification commands, existing evidence, and all prior implementation. Existing active workers may finish after a local npm ci repair; configuration changes take effect through native restart at a safe item boundary.

**Ask First:** New dependency versions, product behavior, deployment credentials or shipping scope beyond the user's existing authorization.

**Never:** Patch the installed engine, fabricate session hooks or done markers, share dependency trees between active workers, run the retired fan-out collector, or claim successful provisioning solely because a directory exists.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Fresh worker | Lockfile and no local dependencies | npm ci installs locally, Svelte sync completes, native session starts afterward | Setup failure prevents coding |
| Broken copied executables | Flattened .bin entries | npm ci replaces installation with valid entrypoints | Do not fall back to ancestor dependencies |
| Missing lockfile / install failure | npm ci exits nonzero | Blocking native hook vetoes the unit | Native journal retains failure and run does not claim done |
| Timeout / interpreter failure | Hook cannot complete | fail_closed veto applies | Native deferred outcome remains truthful |
| Existing active item | Engine has old registry snapshot | Finish current item, stop gracefully, resume with new policy | Never mutate its live index or state |

</frozen-after-approval>

## Code Map

- `.bmad-loop/plugins/npm-bootstrap/plugin.toml`: native declarative project extension; no Python module or custom controller.
- `docs/bmad-loop-policy.example.toml`: remove node_modules from seed list.
- `docs/bmad-loop.md`: setup and recovery instructions, installation readiness evidence.
- Installed `install.py:_copy_traversable` uses shutil.copy2 following file symlinks; observed regular .bin/tsc in newly provisioned learn-chat worker4.
- Installed `worktree_flow.py` provisions and swaps workspace before `_gate_unit`; `engine.py` enforces pre_worktree_setup veto. post_worktree_setup is observe-only and must not host a blocking readiness check.
- Installed `plugins/bus.py` runs the command in ctx.worktree, records hook rc and applies fail_closed transport errors. Declarative plugins load from the project folder without enabling Python trust.

## Tasks & Acceptance

**Execution:**
- [x] Add the native declarative plugin using pre_worktree_setup and bounded fail-closed install plus Svelte sync.
- [x] Correct the policy example and guide; install the same project plugin in the held pipeline lane and future learn-chat queue; remove dependency seeds only, preserving all other policy.
- [x] Verify actual native setup precedes session start and local executable entrypoints work. Exercise a real failing install through the native hook bus and inspect its veto.
- [x] Complete independent review and preserve exact artifacts and revision provenance.

**Acceptance Criteria:**
- Given the paused pipeline run, when it resumes with the plugin, then native setup succeeds before its Astra session and the local TypeScript/Vitest executables resolve without ancestor dependencies.
- Given an installation error or timeout, when the native readiness hook runs, then the engine's enforcing gate prevents coding and leaves a truthful unresolved outcome.
- Given subsequent learn-chat stories, when a new worktree mounts, then the same native initialization applies automatically.

## Spec Change Log

## Verification

- Parse the plugin and policy with installed native parsers.
- Exercise a failure through the installed native hook bus; assert a defer veto.
- Inspect a real pipeline run journal for successful plugin-hook before session-start; execute local binary version probes.
- Native full story gate remains mandatory; final integrated product gate and browser component tests remain required separately.

## Planning evidence

Baseline before this repair: c7075572f14e51433b524026db55d5520eddde03. Root authorization covers this operational repair. Independent native lifecycle investigation confirmed post_worktree_setup cannot enforce a veto; the design selects pre_worktree_setup instead. No user policy decision is needed.

## Implementation handoff ownership

The implementation agent edits this integration worktree only. It builds the native plugin, documentation and negative hook-bus verification; root owns live pipeline/learn-chat policy updates and native runner control, then supplies actual lifecycle evidence. Do not start or stop live runners from the implementation handoff. Preserve root's other tracked changes.

## Implementation verification evidence

The live pipeline run `20260904-121631-a914` resumed at worker revision `0f5bd6b1c9161d2da7f4e828976177fe6f87003a`. Its native journal recorded `plugins-active`, then `npm-bootstrap` at `pre_worktree_setup` with rc 0, then the real Astra dev session. `.audit/native-dependency-bootstrap/live-pipeline-proof.json` preserves those events, manifest and lockfile digests, physical ownership assertions and successful local TypeScript/Vitest probes. Negative install, transport, symlink and isolated timeout cases pass through the installed native HookBus. The same manifest digest is installed in held chat-spend and learn-chat projects with dependency seeds removed. Native product gates remain required for each story.

## Review patch verification

Three independent Astra medium layers completed. No frozen-intent changes were required. The reviewed manifest digest is `20fb58d4717b0377b3cc47ee3fc7f5074b48e3f6943472dd39c7d521972c687a`; 14 native-hook fixtures and isolated timeout pass, including successful npm install followed by failed sync/tsc/vitest, parent-project protection and containment. Complete TypeScript-layout copy fails with the native copier while the symlink-preserving control passes. `review-triage.md` records each finding. `project-deployment-proof.json` verifies six project copies, seed removal, other policy preservation and Astra medium roles. `live-pipeline-provenance.json` plus the original journal snapshot provide replayable provenance for the pre-review live run. A fresh live worker using the final reviewed manifest remains to be observed before this operational repair is marked done.

## Final operational acceptance

The final reviewed manifest `20fb58d4717b0377b3cc47ee3fc7f5074b48e3f6943472dd39c7d521972c687a` passed in real chat-spend run `20260904-121647-f30f`: native blocking `pre_worktree_setup` returned0 before Astra dev session `11-dev-1-g2`. Worker package/config ownership and local TypeScript/Vitest probes passed. `live-reviewed-manifest-proof.json` records the exact source journal path and digest, full surrounding event slice, worker/lockfile revision, filesystem checks and command outputs; `chatspend-journal-snapshot.jsonl` preserves the source. All operational acceptance checks and independent review patches are complete. Product story completion and final integrated application/browser gates are separate obligations and remain tracked by their native runs. No canonical story/epic status was changed by this repair.

## Suggested Review Order

- Native enforcing hook validates local package ownership before installing dependencies.
  [plugin.toml:9](../../.bmad-loop/plugins/npm-bootstrap/plugin.toml#L9)

- Install, sync and verify executable/config containment before coding.
  [plugin.toml:57](../../.bmad-loop/plugins/npm-bootstrap/plugin.toml#L57)

- Document the native setup lifecycle and safe recovery boundaries.
  [bmad-loop.md:45](../../docs/bmad-loop.md#L45)

- Inspect real native ordering and final-manifest worker proof.
  [live-reviewed-manifest-proof.json:3](../../.audit/native-dependency-bootstrap/live-reviewed-manifest-proof.json#L3)

- Replay isolated real-transport success and failure cases.
  [verify-native-hook.py:1](../../.audit/native-dependency-bootstrap/verify-native-hook.py#L1)
