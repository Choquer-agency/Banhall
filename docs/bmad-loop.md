# Native BMAD story loop

Use `bmad-help` to identify the current story or epic, and `bmad-loop` to run it.
The installed engine verified for this project is version 0.11.1. It owns
story selection, isolated worktrees, session hooks, verification, retries,
review, and local merge-back. Each coding session invokes `bmad-build-auto`.

Implementation, independent review, and deferred-work triage use Codex
`gpt-6-astra` with `model_reasoning_effort="medium"`. The policy has
`[review].trigger = "always"` and `[scm].max_parallel = 1`. Later stories in a
queue inherit the completed changes from earlier stories. The custom
`scripts/loop-parallel.py` launcher and `scripts/loop.sh` retry/push wrapper have
been removed. Use the native commands below for run creation and recovery.
Provider failures require the same status and preservation checks as other
interruptions; no repository wrapper automatically re-arms a run or pushes its
branch.

## Configure a checkout

The project needs a physical local `_bmad/` installation, the installed skills,
Codex, uv, and a supported terminal multiplexer. Keep those installs and the
machine-specific `.bmad-loop/policy.toml` out of product commits.

For a newly configured checkout, use the installed `bmad-loop-setup` skill and
native initialization. For the verified engine version:

```bash
uv tool install "bmad-loop[tui] @ git+https://github.com/bmad-code-org/bmad-loop.git@v0.11.1"
bmad-loop init --cli codex
```

A minimal policy example is
[`bmad-loop-policy.example.toml`](bmad-loop-policy.example.toml). Copy it to
`.bmad-loop/policy.toml` only when configuring a new project; preserve existing
local limits and settings when updating an established run. The example's
unattended Codex permission flag is intended for an already authorized local
build environment. `gates.mode = "none"` reflects the user's authorization to
complete this repair run. Story-level `spec_checkpoint` and `done_checkpoint`
settings still control their native checkpoints; preserve them for work that
requires human approval.

Native isolation provisions the skill/adapter files and registers hooks for
the specific worktree. Do not point `_bmad/` at another checkout with a symlink.
Inspect the native event log to confirm real SessionStart and Stop delivery.
If trust blocks a session, use Codex's normal workspace/hook trust UI for that
exact path, then confirm a subsequent genuine event reaches the native run.
Registration alone is not proof of hook delivery.

The tracked project extension
[`.bmad-loop/plugins/npm-bootstrap/plugin.toml`](../.bmad-loop/plugins/npm-bootstrap/plugin.toml)
installs each worker's dependencies from that worker's lockfile using
`npm ci --include=dev`. Native 0.11.1 loads declarative plugins directly from the
project folder; this extension has no Python module and needs no Python trust
enablement. Keep the same manifest in every independently configured native
project, including the pipeline lane and learn-chat queue.

The blocking `pre_worktree_setup` hook runs after native provisioning mounts the
worker and before its coding session. It first requires a local regular
`package.json` and either `package-lock.json` or `npm-shrinkwrap.json`, so npm
cannot search an ancestor project for installation inputs. It explicitly runs that worker's
`./node_modules/.bin/svelte-kit sync`, TypeScript, and Vitest version probes.
The explicit sync is required because package.json's prepare script tolerates
sync errors. A nonzero exit vetoes setup; `fail_closed = true` also vetoes timeout
or transport failure, with a bounded 20-minute readiness budget (1200 seconds).
The native engine records a defer
outcome and must not start coding for that unit. `post_worktree_setup` is
observe-only in this engine version and cannot enforce readiness.

Remove only `node_modules` from existing `scm.worktree_seed` lists, preserving
all other seeds and policy. Do not seed dependencies: native 0.11.1's copier
follows npm executable symlinks and can flatten `.bin` entrypoints into broken
regular files. Each worker needs a physical local installation and generated
Svelte files; the hook rejects symlinked `node_modules` or `.svelte-kit` before
installation and repeats the ownership checks after installation and sync.
It verifies all three executable targets resolve inside the worker's
`node_modules`, and the generated `tsconfig.json` resolves inside its
`.svelte-kit`. Never share either directory between active workers.

For readiness evidence, inspect the native journal for `plugins-active` whose
plugin list includes `npm-bootstrap`, then a successful `plugin-hook` for
`npm-bootstrap` at `pre_worktree_setup` with `rc: 0`, before the unit's `session-start`. In the
worker, rerun the explicit local TypeScript/Vitest probes and verify their
resolved executable targets stay inside that worker's `node_modules`. A
folder's existence, ancestor-resolved commands, or hook registration alone does
not prove successful installation. The full story gate still runs afterward.
The isolated registry probe records `plugin-loaded` with `mode: "declarative"`
because it passes a journal to the registry. The live engine builds its registry
without that journal, so use `plugins-active` for runtime activation evidence.

## Run and inspect an epic

First compare the epic's reconciliation note and acceptance criteria with the
current target code. The sprint-2 specs carry a 2026-09-01 reconciliation note;
verify their anchors again when running against a newer target. Completed
stories are evidence to retain, not instructions to reimplement.

Start from a clean branch intended to receive this epic. The engine pins that
target at run creation and makes the implementation worktree itself.

Check for the legacy branch name before starting:

```bash
git show-ref --verify --quiet refs/heads/bmad-loop
```

Exit 0 means that exact branch exists and blocks creation of native
`bmad-loop/<run-id>` branches. Preserve any work that uses it and rename it to
an unused name before starting the run. Do not force-reset or delete it. Exit 1
means the conflicting branch is absent.

```bash
bmad-loop validate --spec _bmad-output/specs/spec-ai-engine-sprint-2-learn-chat
bmad-loop run --dry-run --spec _bmad-output/specs/spec-ai-engine-sprint-2-learn-chat
bmad-loop run --spec _bmad-output/specs/spec-ai-engine-sprint-2-learn-chat
bmad-loop status --json
bmad-loop tui
```

Use `--project /absolute/project/path` to inspect a run in another native project.
Independent existing lanes may finish in their own worktrees. Overlapping
stories should use one sequential native queue rather than an external fan-out
script.

A process exiting zero is not a completed story: a paused engine can also exit
zero. Check native `finished`, every task's `phase`, its `commit_sha`, the actual
Git commit, and the recorded verification results. `escalated`, `deferred`,
`awaiting-operator`, and stopped runs require the corresponding follow-up.
For full implementation completion require `finished: true` and every intended
task at `phase: "done"`, with its commit and passing gate evidence. A skipped or
deferred item does not count as implemented; resolve its remaining obligation
or record an explicit approved exclusion.
The source files are `_bmad-output/specs/<epic>/stories.yaml` and the generated
`stories/<id>-*.md`; native state, journals, feedback, and `ATTENTION` live under
`.bmad-loop/runs/<run-id>/`.

## Recover an interrupted attempt

The native registry is loaded once per runner. For an existing active item,
allow it to finish after a local `npm ci --include=dev` repair if necessary;
coordinate the repair while its coding process is not using the dependency
tree. Explicitly run local Svelte sync and binary probes after the repair.
Stop gracefully at a safe item boundary, install the manifest and remove only
dependency seeds in the owning project's policy, then resume natively so the
new registry applies. Never mutate an active worker's index or native state.
For setup failures, inspect the recorded `plugin-hook` nonzero exit or
`plugin-hook-error` and the native veto/deferred outcome before recovery. Do not
claim the unit completed or let it fall back to ancestor dependencies.
Native 0.11.1's timeout stops the hook subprocess but does not guarantee every
npm descendant has ended. After a timeout, inspect and finish stopping the old
installer before retrying or reusing that worker. The defer veto still prevents
coding; do not patch the engine or add a custom controller to bypass it.

Read native status, `ATTENTION`, session results, verification output, and Git
status first. Preserve the run branch plus all dirty tracked/untracked artifacts
before restarting. Confirm the former coding session has ended and avoid
concurrent changes to a worker's Git index. From the interrupted worktree, a
preservation example is:

```bash
git branch codex/preserve-RUN_ID HEAD
git rev-parse HEAD > ../RUN_ID.head.txt
git diff --binary > ../RUN_ID.unstaged.patch
git diff --cached --binary > ../RUN_ID.staged.patch
git ls-files --others --exclude-standard -z | tar -cf ../RUN_ID.untracked.tar --null -T -
```

Choose unique backup names. Inspect and securely copy any required ignored run
artifacts separately; the archive intentionally excludes ignored files. Keep
those backups outside the worktree that native restart will remove, and never
commit credentials or environment files as recovery artifacts. Read
`target_branch` in the run's `state.json` to identify the pinned target; the
worker's current `bmad-loop/<run-id>` branch is its temporary source.

In worktree mode, an unfinished session can restart by discarding its old unit
worktree and run branch, then rebuilding from the pinned target branch. Keeping
commits only on the temporary run branch does not make the next attempt reuse
them. Preserve a separate ref and patch first; to reuse the implementation,
commit the intended recovery base and corrected spec on the pinned target
before resuming. This is preparation for verification, not approval for main.

For an actual spec ambiguity, use native `resolve` and `bmad-loop-resolve` to
record the human's decision. For an already-understood operational failure,
native re-arm can be separated from restart:

```bash
bmad-loop resolve --project /absolute/project/path RUN_ID --no-interactive --no-resume
# Preserve the engine-rearmed spec and intended recovery base on the pinned target.
# Validate the corrected epic and confirm a clean, preserved recovery base first.
bmad-loop validate --project /absolute/project/path --spec _bmad-output/specs/EPIC_FOLDER
bmad-loop resume --project /absolute/project/path RUN_ID
```

For a stopped run without an escalation, preserve its work before `resume`;
`resolve` does not apply. In engine 0.11.1, `deferred` is terminal within that
run: `resume` skips it, and escalation resolution cannot re-arm it. Preserve the
implementation and use the native deferred-work sweep to prove and close the
remaining obligation. Preserve the original story contract and historical
implementation baseline as review context. For a story stored under a nested
`_bmad-output/specs/.../stories` directory, create a standard follow-up result
spec directly under `_bmad-output/implementation-artifacts` through
`bmad-build-auto`. Engine 0.11.1 permits ancestor baselines during sweep
verification, but its first-session artifact discovery is nonrecursive and
cannot discover the adopted nested story as the result. Keep the failed run's
historical status intact and link the successful sweep evidence; do not relabel
the old attempt as successful. Never hand-edit `state.json`, terminal result markers,
or story statuses to manufacture completion. Never synthesize session hook events; use native session recovery.

Preserve existing deferred-work entries exactly. An unchanged ledger append
made by the engine can be included in a bookkeeping commit if needed for a
clean review checkout; changing the entry's status or resolution belongs to the
native sweep. When combining branches, reconcile colliding DW IDs by their
origin, source spec, and content, preserving every distinct entry. Keep main's
existing IDs stable and assign unused IDs to distinct incoming entries that
collide. Record an old-branch/old-ID to new-ID mapping and update active ledger
references before invoking a sweep; historical immutable run snapshots retain
their original IDs.

## Verify, integrate, and ship

Run `bash scripts/loop-verify.sh` for the eight-step gate: prerequisite checks,
Convex TypeScript, Svelte checks, unit tests, test discovery, the production build,
and the Windows/macOS uploader harnesses. Use Node 24 (see `.nvmrc`), npm, Git and
PowerShell 7 (`pwsh`). Run `npm ci` inside each fresh checkout and after dependency
changes; the gate bootstraps empty `node_modules` but does not validate an existing
installation for freshness or ownership. Both `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` default
to public placeholders when unset. The unit suite limits worker concurrency so
independent worktrees do not each use the full host's worker pool.

Combine completed branches in an isolated integration checkout. Resolve all
conflicts while preserving each story's acceptance behavior, then run the full
combined gate. UI changes also require the browser component suite: install
Chromium once with `npx playwright install chromium` (on Linux use
`npx playwright install --with-deps chromium`), then run
`VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` to include the ninth step.
Optional preflight verifies an actual headless launch. Existing component tests
rewrite historical `.audit` screenshots: inspect the diffs and restore only
generated historical outputs that must remain unchanged, preserving unrelated work.
These browser tests are separate from `npm test`. Run a fresh `bmad-code-review` on the combined
change and fix actionable findings. Review runtime evidence and any limitations
against the story contracts.

Use the native deferred-work sweep to classify and repair recorded follow-ups:

```bash
bmad-loop sweep --dry-run
bmad-loop sweep --no-prompt
```

The sweep's `bmad-loop-sweep` skill verifies entries against current code and
leaves product decisions for the human. Do not treat every historical open
entry as proof of a current failure.

Keep the integration checkout fixed for the entire sweep, including while its
workers are isolated. Engine 0.11.1 also scans a project-root artifact fallback;
a concurrent merge can expose an unrelated spec there and bind it to the
active unit. If a run crashes with an outside-worktree spec binding, preserve
its work and use a fresh native sweep with standard follow-up artifacts.
`resume` retains that poisoned absolute binding; `resolve` applies only to a
real escalation. The [source audit and recovery evidence](../.audit/sweep-spec-recovery/report.md)
record the observed failure and supported recovery constraints.

After any sweep or review repair changes the tree, repeat the combined gate,
applicable component tests, and review on that resulting revision. Only the
final unchanged, verified revision is eligible for promotion.

For this recovery integration, also run the saved source check:

```bash
python3 .audit/native-entrypoint-retirement/verify.py
```

It rejects restored legacy launchers, literal basename references outside the
reviewed retirement guide, and changes to the reviewed gate, bootstrap hook or
guide. Inspect any failure before proceeding; do not refresh its hashes merely
to obtain a pass. Its receipt fingerprints the inspected source even when HEAD
has not changed yet. This static check cannot discover every dynamically
constructed command.

After local verification and review pass, follow the user's shipping
authorization: commit the final tree, push the integration branch, wait for PR
CI and resolve its failures, then merge to `main`. Verify the resulting remote
main commit and CI. Never push partial attempts or reuse the retired collector.
