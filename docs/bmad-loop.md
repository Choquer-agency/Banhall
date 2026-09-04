# Native BMAD story loop

Use `bmad-help` to identify the current story or epic, and `bmad-loop` to run it.
The installed engine verified for this project is version 0.11.1. It owns
story selection, isolated worktrees, session hooks, verification, retries,
review, and local merge-back. Each coding session invokes `bmad-build-auto`.

Implementation, independent review, and deferred-work triage use Codex
`gpt-6-astra` with `model_reasoning_effort="medium"`. The policy has
`[review].trigger = "always"` and `[scm].max_parallel = 1`. Later stories in a
queue inherit the completed changes from earlier stories. The custom
`loop-parallel.py` launcher has been retired.

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

Install the native project's dependencies with `npm ci` before starting its
queue. The policy's `worktree_seed = ["node_modules"]` copies that physical
installation into each worker through native provisioning. Keep the source
installation consistent with the lockfile on the intended recovery base; refresh
it after dependency changes. Each worker owns its dependencies and generated
build files. The existing verify script installs missing dependencies with
`npm ci`; do not share `node_modules` or `.svelte-kit` between active workers.

## Run and inspect an epic

First compare the epic's reconciliation note and acceptance criteria with the
current target code. The sprint-2 specs carry a 2026-09-01 reconciliation note;
verify their anchors again when running against a newer target. Completed
stories are evidence to retain, not instructions to reimplement.

Start from a clean branch intended to receive this epic. The engine pins that
target at run creation and makes the implementation worktree itself.

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
remaining obligation. A sweep can review an existing story against its original
ancestor baseline. Keep the failed run's historical status intact and link the
successful sweep evidence; do not relabel the old attempt as successful. Never hand-edit `state.json`, terminal result markers,
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

The native `scripts/loop-verify.sh` gate runs Convex TypeScript, Svelte checks,
unit tests, and the Windows/macOS uploader harnesses. `PUBLIC_CONVEX_URL` defaults
to a placeholder for typechecking. The unit suite limits worker concurrency so
independent worktrees do not each use the full host's worker pool.

Combine completed branches in an isolated integration checkout. Resolve all
conflicts while preserving each story's acceptance behavior, then run the full
combined gate. UI changes also require `npm run test:component`; these browser
tests are separate from `npm test`. Run a fresh `bmad-code-review` on the combined
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

After any sweep or review repair changes the tree, repeat the combined gate,
applicable component tests, and review on that resulting revision. Only the
final unchanged, verified revision is eligible for promotion.

After local verification and review pass, follow the user's shipping
authorization: commit the final tree, push the integration branch, wait for PR
CI and resolve its failures, then merge to `main`. Verify the resulting remote
main commit and CI. Never push partial attempts or reuse the retired collector.
