---
title: 'Make native BMAD operation reproducible and safe'
type: 'chore'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
baseline_commit: 2a407aa4dc470d7179c88d6b184a002529c5c3b2
context: []
---

<frozen-after-approval reason="user-authorized repair of failed BMAD loops, retaining native skills">

## Intent

**Problem:** The repository documents obsolete models and in-place execution. Its custom parallel launcher removes existing worktrees, uses process exit codes as completion evidence, and can collect partial work. These paths caused failed attempts and do not match the user's requested native BMAD workflow.

**Approach:** Retire the unused custom launcher and document the actual native run, preservation, verification, and integration procedure. Provide a small current policy example under a tracked documentation path. Preserve all native engine state and completed implementations.

## Boundaries & Constraints

**Always:** Use `bmad-help` for routing and native `bmad-loop` commands for lifecycle. Configure implementation, review, and triage as `gpt-6-astra` with medium reasoning. Use independent Git worktrees, `max_parallel = 1` within a queue, physical BMad installs, and independent dependencies/generated artifacts. Treat state plus commit and verification evidence as completion. Preserve both committed and uncommitted work before an interrupted isolated restart.

**Ask First:** Product-policy changes not already answered by approved story contracts; unavailable credentials or external operator actions that cannot be performed within existing authorization.

**Never:** Introduce a replacement supervisor or collector, hand-edit engine state/result markers, synthesize hook events, force-reset an active branch, share generated outputs across worktrees, or describe unverified work as finished. Main promotion remains contingent on all required verification and review passing. Historical preserved refs are not completion evidence by themselves.

</frozen-after-approval>

## Code Map

- `scripts/loop-parallel.py`: obsolete custom fan-out and collection entry point. Its worktree removal/branch reset and exit-code-only collection contradict native recovery requirements. No tracked application entry point depends on it.
- `docs/bmad-loop.md`: current guide still describes Claude model split, in-place isolation, shared dependencies, and manual Stop injection. Replace those stale instructions with observed native behavior.
- `docs/bmad-loop-policy.example.toml`: new minimal, tracked per-machine policy example; the old documented `.bmad-loop/policy.example.toml` is not tracked.
- `scripts/loop-verify.sh`: existing native verification gate. It installs missing dependencies and runs Convex typecheck, Svelte check, unit tests, and uploader harnesses. Preserve its checks.
- `.bmad-loop/policy.toml` and `.bmad-loop/runs/`: local native state, not source files for this change. Do not alter active engines through this documentation repair.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/loop-parallel.py`: remove the obsolete launcher; native commands are the only documented lifecycle entry point.
- [x] `docs/bmad-loop.md`: document Astra medium, isolated sequential queues, evidence checks, preservation before resume, and verified integration. Explain native worktree resume rebuilding from the pinned target, with `resolve --no-resume` allowing preparation first.
- [x] `docs/bmad-loop-policy.example.toml`: add minimal working adapter/review/SCM/verify configuration and reference it from the guide.

**Acceptance Criteria:**
- Given a new operator following the guide, when configuring a run, then all coding stages select Astra medium and the queue uses native worktree isolation.
- Given a stopped or escalated isolated attempt with useful changes, when following recovery guidance, then committed refs and dirty artifacts are preserved before any native restart and the pinned target contains the intended recovery base.
- Given a paused engine that exits zero, when checking completion, then the guide requires native task status, commit identity, and passing verification instead of accepting its exit code.
- Given independently completed lane branches, when integrating them, then merge conflicts, the combined gate, component tests for UI changes, independent review, and remote CI are completed before main promotion.

## Spec Change Log

## Verification

- Parse the policy with Python `tomllib` and native BMad `policy.load`.
- Compare documented flags with installed native CLI help and recovery warnings.
- Search tracked source for active references to the retired launcher and stale guide instructions.
- Run `git diff --check`. Product verification remains covered by the final combined-tree gate.

Verification evidence (2026-09-04): Python tomllib and native `bmad_loop.policy.load` parsed the example; resolved dev/review/triage each selected codex/gpt-6-astra/medium, with worktree isolation, serial dispatch, and always-review. Native CLI help and both operational rearm warnings verified the documented flags and pinned-target recovery behavior. No tracked caller of the retired launcher exists. `git diff --check` passed.


## Review Triage Log

Three independent BMAD layers completed. Edge and verification reviewers returned no findings. Patched the blind review's documentation gaps: pinned setup commands, real hook delivery, checkpoint explanation, reconciliation prerequisite, explicit completion phases, comprehensive preservation, target identification, pre-resume validation, post-sweep re-verification, DW ID mapping, reproducible evidence, and prohibition of synthetic hook events. No product-policy change or new deferral was required.

Reproduce policy verification from this checkout:

```bash
/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python - <<'PYCODE'
from pathlib import Path
from bmad_loop.policy import load
p = load(Path("docs/bmad-loop-policy.example.toml"))
for role in ("dev", "review", "triage"):
    a = p.adapter.resolved(role)
    assert a.name == "codex" and a.model == "gpt-6-astra"
    assert 'model_reasoning_effort="medium"' in a.extra_args
    print(role, a.name, a.model, "medium")
assert p.scm.isolation == "worktree" and p.scm.max_parallel == 1
assert p.review.enabled and p.review.trigger == "always"
PYCODE
```

Observed: each role printed `codex gpt-6-astra medium`; all assertions passed. Native `resolve --help`, `resume --help`, `validate --help`, and run recovery warnings establish the documented flags. Recovery backups are retained under the original checkout's `.bmad-loop/backups/completion-20260904/`; native journals record rearm and restart against preserved pinned targets. This is an operational audit, not a synthetic recovery test.

## Suggested Review Order

- Preserve implementation before native restart rebuilds the worktree.
  [bmad-loop.md:84](../../docs/bmad-loop.md#L84)

- Require final combined verification after all repair passes.
  [bmad-loop.md:140](../../docs/bmad-loop.md#L140)

- Keep every native coding stage on Astra medium.
  [bmad-loop-policy.example.toml:7](../../docs/bmad-loop-policy.example.toml#L7)


Native provisioning follow-up: configured `scm.worktree_seed = ["node_modules"]` so fresh workers receive an independent complete installation. The paused schema project now replaces its ancestor dependency symlink with a physical copy; the learn-chat queue will finish its current item, then resume under the updated native policy. No alternate supervisor or launcher was introduced. The guide requires a lockfile-consistent source installation.

## Deferred recovery clarification

Installed 0.11.1 source confirms `DEFERRED` is terminal on same-run resume and `rearm_escalation` requires `ESCALATED`. Native sweep verification explicitly accepts an original ancestor baseline for existing-story follow-up review. The guide now records that route; no engine state or terminal result was edited. Learn-chat story 3's repaired implementation was preserved after its stale-baseline deferral and remains subject to native sweep closure.
